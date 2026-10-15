-- =====================================================================
-- Evvo House Finance — Migration 007 — Conferência e fechamento (Etapa 6)
-- Conferir o saldo de cada conta com o banco, registrar ajustes
-- (fora da renda e do dízimo) e fechar/reabrir o mês.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 006.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conferências e ajustes
-- ---------------------------------------------------------------------

-- Registro de cada conferência feita (o que foi informado e o que o app calculava).
create table public.conferencias (
  id               uuid primary key default gen_random_uuid(),
  lar_id           uuid not null references public.lares(id) on delete cascade,
  data             date not null,
  itens            jsonb not null default '[]'::jsonb,
  total_diferenca  numeric(12,2) not null default 0,
  motivo           text,
  criado_por       uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now()
);
create index conferencias_lar_idx on public.conferencias (lar_id, data);

-- Ajuste: a diferença entre o saldo real do banco e o calculado pelo app.
-- Corrige o saldo da conta, mas não é renda, nem despesa, nem entra no dízimo.
create table public.ajustes (
  id               uuid primary key default gen_random_uuid(),
  lar_id           uuid not null references public.lares(id) on delete cascade,
  conta_id         uuid not null constraint ajustes_conta_fkey references public.contas(id),
  conferencia_id   uuid references public.conferencias(id) on delete cascade,
  data             date not null,
  saldo_calculado  numeric(12,2) not null,
  saldo_informado  numeric(12,2) not null,
  diferenca        numeric(12,2) not null check (diferenca <> 0),
  motivo           text,
  criado_por       uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now()
);
create index ajustes_lar_idx on public.ajustes (lar_id, data);
create index ajustes_conta_idx on public.ajustes (conta_id);

-- Meses fechados.
create table public.meses_fechados (
  lar_id       uuid not null references public.lares(id) on delete cascade,
  competencia  date not null,
  fechado_em   timestamptz not null default now(),
  fechado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (lar_id, competencia)
);

alter table public.conferencias   enable row level security;
alter table public.ajustes        enable row level security;
alter table public.meses_fechados enable row level security;

create policy conferencias_select on public.conferencias for select to authenticated using (public.tem_acesso(lar_id));
create policy conferencias_delete on public.conferencias for delete to authenticated using (public.tem_acesso(lar_id));
create policy ajustes_select on public.ajustes for select to authenticated using (public.tem_acesso(lar_id));
create policy ajustes_delete on public.ajustes for delete to authenticated using (public.tem_acesso(lar_id));
create policy fechados_select on public.meses_fechados for select to authenticated using (public.tem_acesso(lar_id));
-- Gravações de conferência, ajuste e fechamento passam pelas funções abaixo.
revoke all on public.conferencias, public.ajustes, public.meses_fechados from anon;

-- ---------------------------------------------------------------------
-- Saldo das contas agora inclui os ajustes.
-- ---------------------------------------------------------------------
create or replace view public.v_saldo_contas
with (security_invoker = true)
as
select
  c.id, c.lar_id, c.nome, c.natureza, c.tipo, c.ativa, c.ordem,
  c.saldo_inicial, c.data_saldo_inicial,
  c.saldo_inicial
    + coalesce((select sum(e.valor) from public.entradas e
                where e.conta_id = c.id and e.data > c.data_saldo_inicial), 0)
    + coalesce((select sum(r.valor) from public.recebimentos r
                where r.conta_id = c.id and r.data > c.data_saldo_inicial), 0)
    + coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_destino = c.id and t.data > c.data_saldo_inicial), 0)
    - coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_origem = c.id and t.data > c.data_saldo_inicial), 0)
    - coalesce((select sum(p.valor) from public.pagamentos p
                where p.conta_id = c.id and p.data > c.data_saldo_inicial), 0)
    + coalesce((select sum(a.diferenca) from public.ajustes a
                where a.conta_id = c.id and a.data > c.data_saldo_inicial), 0)
  as saldo_atual
from public.contas c;

-- Saldo de uma conta no FIM de um dia (para conferir com o extrato daquele dia).
create or replace function public.saldo_conta_em(p_conta uuid, p_data date)
returns numeric
language sql stable
set search_path = public
as $$
  select c.saldo_inicial
    + coalesce((select sum(e.valor) from public.entradas e
                where e.conta_id = c.id and e.data > c.data_saldo_inicial and e.data <= p_data), 0)
    + coalesce((select sum(r.valor) from public.recebimentos r
                where r.conta_id = c.id and r.data > c.data_saldo_inicial and r.data <= p_data), 0)
    + coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_destino = c.id and t.data > c.data_saldo_inicial and t.data <= p_data), 0)
    - coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_origem = c.id and t.data > c.data_saldo_inicial and t.data <= p_data), 0)
    - coalesce((select sum(p.valor) from public.pagamentos p
                where p.conta_id = c.id and p.data > c.data_saldo_inicial and p.data <= p_data), 0)
    + coalesce((select sum(a.diferenca) from public.ajustes a
                where a.conta_id = c.id and a.data > c.data_saldo_inicial and a.data <= p_data), 0)
  from public.contas c
  where c.id = p_conta;
$$;

-- Lista das contas ativas com o saldo calculado no fim do dia p_data.
create or replace function public.saldos_em(p_data date)
returns json
language plpgsql stable
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', c.id, 'nome', c.nome, 'natureza', c.natureza,
      'data_saldo_inicial', c.data_saldo_inicial,
      'saldo', public.saldo_conta_em(c.id, p_data)
    ) order by c.ordem, c.nome)
    from public.contas c
    where c.lar_id = v_lar and c.ativa
  ), '[]'::json);
end;
$$;

-- ---------------------------------------------------------------------
-- Mês fechado: nada desse mês pode ser criado, alterado ou apagado.
-- ---------------------------------------------------------------------
create or replace function public.mes_fechado(p_lar uuid, p_data date)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meses_fechados
    where lar_id = p_lar and competencia = date_trunc('month', p_data)::date
  );
$$;
revoke all on function public.mes_fechado(uuid, date) from public, anon;
grant execute on function public.mes_fechado(uuid, date) to authenticated;

create or replace function public._travar_mes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_campo text := case when tg_table_name in ('entradas', 'despesas') then 'competencia' else 'data' end;
  v_datas date[] := '{}';
  v_lar uuid;
  d date;
begin
  -- Desligar uma despesa fixa excluída (despesa_fixa_id vira vazio) não altera o mês.
  if tg_op = 'UPDATE' and tg_table_name = 'despesas'
     and (to_jsonb(new) - 'despesa_fixa_id' - 'atualizado_em') = (to_jsonb(old) - 'despesa_fixa_id' - 'atualizado_em') then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_lar := old.lar_id;
    v_datas := v_datas || (to_jsonb(old) ->> v_campo)::date;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_lar := new.lar_id;
    v_datas := v_datas || (to_jsonb(new) ->> v_campo)::date;
  end if;
  foreach d in array v_datas loop
    if d is not null and public.mes_fechado(v_lar, d) then
      raise exception 'O mês %/% está fechado. Para alterar, reabra o mês em Mais › Conferência e fechamento.',
        lpad(extract(month from d)::text, 2, '0'), extract(year from d);
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger entradas_travar       before insert or update or delete on public.entradas       for each row execute function public._travar_mes();
create trigger despesas_travar       before insert or update or delete on public.despesas       for each row execute function public._travar_mes();
create trigger pagamentos_travar     before insert or update or delete on public.pagamentos     for each row execute function public._travar_mes();
create trigger transferencias_travar before insert or update or delete on public.transferencias for each row execute function public._travar_mes();
create trigger recebimentos_travar   before insert or update or delete on public.recebimentos   for each row execute function public._travar_mes();
create trigger ajustes_travar        before insert or update or delete on public.ajustes        for each row execute function public._travar_mes();

-- Gerar contas fixas e sincronizar o dízimo não mexem em mês fechado.
create or replace function public.gerar_despesas_mes(p_mes date)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_mes date := date_trunc('month', p_mes)::date;
  v_ultimo int := extract(day from (date_trunc('month', p_mes) + interval '1 month' - interval '1 day'))::int;
  v_qtd int;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then
    raise exception 'Sem acesso a este lar.';
  end if;
  if public.mes_fechado(v_lar, v_mes) then return 0; end if;

  insert into public.despesas (lar_id, descricao, categoria_id, competencia, vencimento, valor, origem, despesa_fixa_id)
  select f.lar_id, f.descricao, f.categoria_id, v_mes,
         make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, least(f.dia_vencimento, v_ultimo)),
         f.valor_padrao, 'fixa', f.id
  from public.despesas_fixas f
  where f.lar_id = v_lar
    and f.ativa
    and f.inicio <= v_mes
    and not exists (select 1 from public.despesas d where d.despesa_fixa_id = f.id and d.competencia = v_mes)
    and not exists (select 1 from public.despesas_fixas_puladas p where p.despesa_fixa_id = f.id and p.competencia = v_mes)
  on conflict do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

create or replace function public._sync_dizimo(p_lar uuid, p_mes date)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_mes date := date_trunc('month', p_mes)::date;
  c record;
  d public.despesas;
  v_pago numeric := 0;
  v_cat uuid;
  v_alvo numeric;
begin
  if p_lar is null or p_mes is null then return; end if;
  if public.mes_fechado(p_lar, v_mes) then return; end if;
  select * into c from public._calc_dizimo(p_lar, v_mes);
  if c is null then return; end if;

  select * into d from public.despesas where lar_id = p_lar and origem = 'dizimo' and competencia = v_mes limit 1;

  if found then
    select coalesce(sum(valor), 0) into v_pago from public.pagamentos where despesa_id = d.id;
    if c.valor <= 0 and v_pago = 0 then
      delete from public.despesas where id = d.id;
      return;
    end if;
    v_alvo := greatest(c.valor, v_pago);
    if v_alvo > 0 and d.valor <> v_alvo then
      update public.despesas set valor = v_alvo where id = d.id;
    end if;
  elsif c.valor > 0 then
    select id into v_cat from public.categorias
    where lar_id = p_lar and grupo = 'dizimo' and tipo = 'saida'
    order by (lower(nome) like 'd%zimo%') desc, ativa desc, padrao desc, ordem
    limit 1;
    if v_cat is null then return; end if;
    insert into public.despesas (lar_id, descricao, categoria_id, competencia, vencimento, valor, origem)
    values (p_lar, 'Dízimo', v_cat, v_mes, (v_mes + interval '1 month' - interval '1 day')::date, c.valor, 'dizimo');
  end if;
end;
$$;
revoke all on function public._sync_dizimo(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Registrar conferência. p_itens = [{"conta_id": "...", "saldo_informado": 1234.56}, ...]
-- Contas sem diferença ficam só no registro; com diferença ganham um ajuste.
-- ---------------------------------------------------------------------
create or replace function public.registrar_conferencia(p_data date, p_itens jsonb, p_motivo text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_conf uuid;
  r record;
  v_calc numeric;
  v_dif numeric;
  v_itens jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_qtd int := 0;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_data is null then raise exception 'Informe a data da conferência.'; end if;
  if p_data > public.hoje_brt() then raise exception 'A data da conferência não pode ser no futuro.'; end if;
  if public.mes_fechado(v_lar, p_data) then
    raise exception 'O mês desta data está fechado. Reabra antes de conferir.';
  end if;

  insert into public.conferencias (lar_id, data, motivo, criado_por)
  values (v_lar, p_data, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid())
  returning id into v_conf;

  for r in
    select (x->>'conta_id')::uuid as conta_id, round((x->>'saldo_informado')::numeric, 2) as informado
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
    where x->>'saldo_informado' is not null
  loop
    if not exists (select 1 from public.contas where id = r.conta_id and lar_id = v_lar) then
      raise exception 'Conta inválida.';
    end if;
    if exists (select 1 from public.contas where id = r.conta_id and data_saldo_inicial >= p_data) then
      raise exception 'A data da conferência precisa ser depois do saldo inicial de cada conta.';
    end if;
    v_calc := round(public.saldo_conta_em(r.conta_id, p_data), 2);
    v_dif := r.informado - v_calc;
    v_itens := v_itens || jsonb_build_object('conta_id', r.conta_id, 'calculado', v_calc, 'informado', r.informado, 'diferenca', v_dif);
    if abs(v_dif) >= 0.005 then
      insert into public.ajustes (lar_id, conta_id, conferencia_id, data, saldo_calculado, saldo_informado, diferenca, motivo, criado_por)
      values (v_lar, r.conta_id, v_conf, p_data, v_calc, r.informado, v_dif, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());
      v_total := v_total + v_dif;
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  if jsonb_array_length(v_itens) = 0 then raise exception 'Informe o saldo real de pelo menos uma conta.'; end if;

  update public.conferencias set itens = v_itens, total_diferenca = v_total where id = v_conf;
  return json_build_object('conferencia_id', v_conf, 'ajustes', v_qtd, 'total_diferenca', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- Fechar e reabrir o mês
-- ---------------------------------------------------------------------
create or replace function public.fechar_mes(p_mes date)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_mes date := date_trunc('month', p_mes)::date;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if v_mes > date_trunc('month', public.hoje_brt())::date then
    raise exception 'Não dá para fechar um mês que ainda não começou.';
  end if;
  -- Deixa o dízimo do mês calculado antes de travar.
  perform public._sync_dizimo(v_lar, v_mes);
  insert into public.meses_fechados (lar_id, competencia, fechado_por)
  values (v_lar, v_mes, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.reabrir_mes(p_mes date)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  delete from public.meses_fechados where lar_id = v_lar and competencia = date_trunc('month', p_mes)::date;
  perform public._sync_dizimo(v_lar, p_mes);
end;
$$;

-- Situação do mês para a tela de conferência.
create or replace function public.situacao_mes(p_mes date)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_mes date := date_trunc('month', p_mes)::date;
  f record;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  select m.fechado_em, mb.nome into f
  from public.meses_fechados m
  left join public.membros mb on mb.user_id = m.fechado_por and mb.lar_id = m.lar_id
  where m.lar_id = v_lar and m.competencia = v_mes;
  return json_build_object(
    'fechado', f.fechado_em is not null,
    'fechado_em', f.fechado_em,
    'fechado_por', f.nome,
    'contas_abertas', (select count(*) from public.v_despesas
                       where lar_id = v_lar and competencia = v_mes and status <> 'pago' and origem <> 'avulsa'),
    'valor_aberto', (select coalesce(sum(falta), 0) from public.v_despesas
                     where lar_id = v_lar and competencia = v_mes and status <> 'pago' and origem <> 'avulsa'),
    'ultima_conferencia', (select max(data) from public.conferencias
                           where lar_id = v_lar and data >= v_mes and data < v_mes + interval '1 month')
  );
end;
$$;

revoke all on function public.saldo_conta_em(uuid, date)                  from public, anon;
revoke all on function public.saldos_em(date)                             from public, anon;
revoke all on function public.registrar_conferencia(date, jsonb, text)    from public, anon;
revoke all on function public.fechar_mes(date)                            from public, anon;
revoke all on function public.reabrir_mes(date)                           from public, anon;
revoke all on function public.situacao_mes(date)                          from public, anon;
grant execute on function public.saldo_conta_em(uuid, date)               to authenticated;
grant execute on function public.saldos_em(date)                          to authenticated;
grant execute on function public.registrar_conferencia(date, jsonb, text) to authenticated;
grant execute on function public.fechar_mes(date)                         to authenticated;
grant execute on function public.reabrir_mes(date)                        to authenticated;
grant execute on function public.situacao_mes(date)                       to authenticated;

notify pgrst, 'reload schema';
