-- =====================================================================
-- Evvo House Finance — Migration 008 — Relatórios (Etapa 7)
-- Consultas prontas para os gráficos, a impressão e a exportação.
-- Só leitura: não cria tabelas nem altera dados.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 007.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ano: totais de cada mês + ranking de categorias e clientes do ano.
-- ---------------------------------------------------------------------
create or replace function public.relatorio_ano(p_ano int)
returns json
language plpgsql stable
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_ini date := make_date(p_ano, 1, 1);
  v_fim date := make_date(p_ano, 12, 1);
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;

  return json_build_object(
    'ano', p_ano,
    'meses', (
      select json_agg(json_build_object(
        'mes', to_char(m.m, 'YYYY-MM'),
        'entradas', coalesce(e.total, 0),
        'renda_empresa', coalesce(e.renda_empresa, 0),
        'outras_rendas', coalesce(e.outras, 0),
        'saidas', coalesce(d.total, 0),
        'despesa_casa', coalesce(d.casa, 0),
        'despesa_empresa', coalesce(d.empresa, 0),
        'dizimo', coalesce(d.dizimo, 0),
        'resultado', coalesce(e.total, 0) - coalesce(d.total, 0),
        'fechado', exists (select 1 from public.meses_fechados f where f.lar_id = v_lar and f.competencia = m.m)
      ) order by m.m)
      from generate_series(v_ini, v_fim, interval '1 month') as m(m)
      left join (
        select x.competencia,
               sum(x.valor) as total,
               sum(x.valor) filter (where c.grupo = 'renda_empresa') as renda_empresa,
               sum(x.valor) filter (where c.grupo = 'outras_rendas') as outras
        from public.entradas x join public.categorias c on c.id = x.categoria_id
        where x.lar_id = v_lar and x.competencia between v_ini and v_fim
        group by x.competencia
      ) e on e.competencia = m.m
      left join (
        select x.competencia,
               sum(x.valor) as total,
               sum(x.valor) filter (where c.grupo = 'despesa_casa') as casa,
               sum(x.valor) filter (where c.grupo = 'despesa_empresa') as empresa,
               sum(x.valor) filter (where c.grupo = 'dizimo') as dizimo
        from public.despesas x join public.categorias c on c.id = x.categoria_id
        where x.lar_id = v_lar and x.competencia between v_ini and v_fim
        group by x.competencia
      ) d on d.competencia = m.m
    ),
    'categorias', coalesce((
      select json_agg(json_build_object('nome', t.nome, 'grupo', t.grupo, 'tipo', t.tipo, 'total', t.total) order by t.total desc)
      from (
        select c.nome, c.grupo, c.tipo, sum(v.valor) as total
        from (
          select categoria_id, valor from public.entradas where lar_id = v_lar and competencia between v_ini and v_fim
          union all
          select categoria_id, valor from public.despesas where lar_id = v_lar and competencia between v_ini and v_fim
        ) v join public.categorias c on c.id = v.categoria_id
        group by c.nome, c.grupo, c.tipo
      ) t
    ), '[]'::json),
    'clientes', coalesce((
      select json_agg(json_build_object('nome', t.nome, 'total', t.total) order by t.total desc)
      from (
        select k.nome, sum(e.valor) as total
        from public.entradas e join public.clientes k on k.id = e.cliente_id
        where e.lar_id = v_lar and e.competencia between v_ini and v_fim
        group by k.nome
      ) t
    ), '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Mês: totais, categorias, clientes e a lista completa de movimentos
-- (para imprimir e exportar para Excel).
-- ---------------------------------------------------------------------
create or replace function public.relatorio_mes(p_mes date)
returns json
language plpgsql stable
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_mes date := date_trunc('month', p_mes)::date;
  v_prox date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;

  return json_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'categorias', coalesce((
      select json_agg(json_build_object('nome', t.nome, 'grupo', t.grupo, 'tipo', t.tipo, 'total', t.total) order by t.tipo, t.total desc)
      from (
        select c.nome, c.grupo, c.tipo, sum(v.valor) as total
        from (
          select categoria_id, valor from public.entradas where lar_id = v_lar and competencia = v_mes
          union all
          select categoria_id, valor from public.despesas where lar_id = v_lar and competencia = v_mes
        ) v join public.categorias c on c.id = v.categoria_id
        group by c.nome, c.grupo, c.tipo
      ) t
    ), '[]'::json),
    'clientes', coalesce((
      select json_agg(json_build_object('nome', t.nome, 'total', t.total, 'com_cliente', t.com_cliente) order by t.total desc)
      from (
        select k.nome, sum(e.valor) as total, sum(e.valor) filter (where e.conta_id is null) as com_cliente
        from public.entradas e join public.clientes k on k.id = e.cliente_id
        where e.lar_id = v_lar and e.competencia = v_mes
        group by k.nome
      ) t
    ), '[]'::json),
    'movimentos', coalesce((
      select json_agg(m order by m.data, m.tipo, m.descricao)
      from (
        -- Entradas
        select e.data, 'Entrada' as tipo,
               coalesce(k.nome, e.descricao, c.nome) as descricao,
               c.nome as categoria, c.grupo,
               coalesce(ct.nome, 'Ficou com o cliente') as conta,
               e.valor as valor, null::text as situacao, mb.nome as quem
        from public.entradas e
        join public.categorias c on c.id = e.categoria_id
        left join public.clientes k on k.id = e.cliente_id
        left join public.contas ct on ct.id = e.conta_id
        left join public.membros mb on mb.user_id = e.criado_por and mb.lar_id = e.lar_id
        where e.lar_id = v_lar and e.competencia = v_mes
        union all
        -- Saídas e contas do mês
        select d.vencimento, 'Saída',
               d.descricao, d.categoria_nome, d.categoria_grupo,
               coalesce((
                 select string_agg(coalesce(ct.nome, 'saldo ' || k.nome), ' + ')
                 from public.pagamentos p
                 left join public.contas ct on ct.id = p.conta_id
                 left join public.clientes k on k.id = p.cliente_id
                 where p.despesa_id = d.id
               ), '-'),
               -d.valor,
               case d.status when 'pago' then 'Pago' when 'parcial' then 'Parcial' else 'A pagar' end,
               mb.nome
        from public.v_despesas d
        left join public.membros mb on mb.user_id = d.criado_por and mb.lar_id = d.lar_id
        where d.lar_id = v_lar and d.competencia = v_mes
        union all
        -- Transferências
        select t.data, 'Transferência', coalesce(t.descricao, 'Transferência'), null, null,
               o.nome || ' → ' || de.nome, t.valor, null, mb.nome
        from public.transferencias t
        join public.contas o on o.id = t.conta_origem
        join public.contas de on de.id = t.conta_destino
        left join public.membros mb on mb.user_id = t.criado_por and mb.lar_id = t.lar_id
        where t.lar_id = v_lar and t.data >= v_mes and t.data < v_prox
        union all
        -- Recebimentos de cliente
        select r.data, 'Recebimento', k.nome || ' repassou', null, null, ct.nome, r.valor, null, mb.nome
        from public.recebimentos r
        join public.clientes k on k.id = r.cliente_id
        join public.contas ct on ct.id = r.conta_id
        left join public.membros mb on mb.user_id = r.criado_por and mb.lar_id = r.lar_id
        where r.lar_id = v_lar and r.data >= v_mes and r.data < v_prox
        union all
        -- Ajustes de conferência
        select a.data, 'Ajuste', coalesce(a.motivo, 'Ajuste de conferência'), null, null, ct.nome, a.diferenca, null, mb.nome
        from public.ajustes a
        join public.contas ct on ct.id = a.conta_id
        left join public.membros mb on mb.user_id = a.criado_por and mb.lar_id = a.lar_id
        where a.lar_id = v_lar and a.data >= v_mes and a.data < v_prox
      ) m
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.relatorio_ano(int)  from public, anon;
revoke all on function public.relatorio_mes(date) from public, anon;
grant execute on function public.relatorio_ano(int)  to authenticated;
grant execute on function public.relatorio_mes(date) to authenticated;

notify pgrst, 'reload schema';
