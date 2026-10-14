-- =====================================================================
-- Evvo House Finance — Migration 006 — Saldo com cliente e dízimo (Etapa 5)
-- Recebimentos de cliente, saldo com cada cliente, pagar contas com o saldo
-- do cliente (com trava) e dízimo calculado automaticamente todo mês.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 005.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Recebimentos: o cliente repassou (Pix/depósito) o que ainda era seu.
-- Só muda o dinheiro de lugar: não é renda nova nem entra no dízimo.
-- ---------------------------------------------------------------------
create table public.recebimentos (
  id          uuid primary key default gen_random_uuid(),
  lar_id      uuid not null references public.lares(id) on delete cascade,
  cliente_id  uuid not null constraint recebimentos_cliente_fkey references public.clientes(id),
  conta_id    uuid not null constraint recebimentos_conta_fkey references public.contas(id),
  data        date not null,
  valor       numeric(12,2) not null check (valor > 0),
  descricao   text,
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index recebimentos_lar_idx on public.recebimentos (lar_id, data);
create index recebimentos_cliente_idx on public.recebimentos (cliente_id);

create or replace function public._checar_recebimento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.clientes where id = new.cliente_id and lar_id = new.lar_id) then
    raise exception 'Cliente inválido.';
  end if;
  if not exists (select 1 from public.contas where id = new.conta_id and lar_id = new.lar_id) then
    raise exception 'Conta inválida.';
  end if;
  return new;
end;
$$;
create trigger recebimentos_checar before insert or update on public.recebimentos
  for each row execute function public._checar_recebimento();

alter table public.recebimentos enable row level security;
create policy recebimentos_select on public.recebimentos for select to authenticated using (public.tem_acesso(lar_id));
create policy recebimentos_insert on public.recebimentos for insert to authenticated with check (public.tem_acesso(lar_id));
create policy recebimentos_update on public.recebimentos for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy recebimentos_delete on public.recebimentos for delete to authenticated using (public.tem_acesso(lar_id));
revoke all on public.recebimentos from anon;

-- ---------------------------------------------------------------------
-- Saldo das contas agora inclui os recebimentos de cliente.
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
  as saldo_atual
from public.contas c;

-- ---------------------------------------------------------------------
-- Saldo com cada cliente = renda que ficou com ele − contas suas que ele pagou − o que ele já repassou.
-- ---------------------------------------------------------------------
create view public.v_saldo_clientes
with (security_invoker = true)
as
select x.*, x.lancado - x.usado - x.recebido as saldo
from (
  select
    cl.id, cl.lar_id, cl.nome, cl.ativo,
    coalesce((select sum(e.valor) from public.entradas e where e.cliente_id = cl.id and e.conta_id is null), 0) as lancado,
    coalesce((select sum(p.valor) from public.pagamentos p where p.cliente_id = cl.id), 0) as usado,
    coalesce((select sum(r.valor) from public.recebimentos r where r.cliente_id = cl.id), 0) as recebido
  from public.clientes cl
) x;
revoke all on public.v_saldo_clientes from anon;
grant select on public.v_saldo_clientes to authenticated;

create or replace function public.saldo_cliente(p_cliente uuid)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce((select saldo from public.v_saldo_clientes where id = p_cliente), 0);
$$;

-- Confere se cada cliente usado nas linhas tem saldo suficiente. Trava por cliente para evitar uso em dobro.
create or replace function public._checar_saldo_clientes(p_linhas jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare r record; v_saldo numeric; v_nome text;
begin
  for r in
    select (x->>'cliente_id')::uuid as cliente_id, sum((x->>'valor')::numeric) as total
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x
    where x->>'cliente_id' is not null
    group by 1
  loop
    if not exists (select 1 from public.clientes where id = r.cliente_id and lar_id = public.meu_lar_id()) then
      raise exception 'Cliente inválido.';
    end if;
    perform pg_advisory_xact_lock(hashtext(r.cliente_id::text));
    v_saldo := public.saldo_cliente(r.cliente_id);
    if round(r.total, 2) > round(v_saldo, 2) then
      select nome into v_nome from public.clientes where id = r.cliente_id;
      raise exception 'O saldo com % é R$ % e não cobre R$ %.',
        coalesce(v_nome, 'o cliente'), to_char(v_saldo, 'FM999G999G990D00'), to_char(r.total, 'FM999G999G990D00');
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Receber o restante do cliente numa conta.
-- ---------------------------------------------------------------------
create or replace function public.receber_de_cliente(
  p_cliente uuid, p_conta uuid, p_data date, p_valor numeric, p_descricao text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_saldo numeric;
  v_id uuid;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor recebido.'; end if;
  if p_data is null then raise exception 'Informe a data.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_cliente::text));
  v_saldo := public.saldo_cliente(p_cliente);
  if round(p_valor, 2) > round(v_saldo, 2) then
    raise exception 'O saldo com o cliente é R$ %. Não dá para receber mais do que isso.', to_char(v_saldo, 'FM999G999G990D00');
  end if;
  insert into public.recebimentos (lar_id, cliente_id, conta_id, data, valor, descricao)
  values (v_lar, p_cliente, p_conta, p_data, round(p_valor, 2), nullif(trim(coalesce(p_descricao, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Pagamentos de contas: agora cada parte pode vir de uma conta OU do saldo de um cliente.
-- p_linhas = [{"conta_id": "..."} ou {"cliente_id": "..."}, "valor": 100.00]
-- ---------------------------------------------------------------------
create or replace function public.registrar_pagamentos(p_despesa uuid, p_data date, p_linhas jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  d public.despesas;
  v_pago numeric;
  v_novo numeric;
  v_qtd int;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_data is null then raise exception 'Informe a data do pagamento.'; end if;

  select * into d from public.despesas where id = p_despesa and lar_id = v_lar;
  if not found then raise exception 'Conta não encontrada.'; end if;

  select count(*), coalesce(sum((x->>'valor')::numeric), 0)
  into v_qtd, v_novo
  from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x;
  if v_qtd = 0 or v_novo <= 0 then raise exception 'Informe quanto foi pago e de onde.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_linhas) x
    where coalesce((x->>'valor')::numeric, 0) <= 0
       or ((x->>'conta_id') is null) = ((x->>'cliente_id') is null)
  ) then
    raise exception 'Cada parte precisa de valor e de uma conta ou um cliente.';
  end if;

  select coalesce(sum(valor), 0) into v_pago from public.pagamentos where despesa_id = p_despesa;
  if round(v_pago + v_novo, 2) > round(d.valor, 2) then
    raise exception 'Passou do valor da conta. Falta pagar só R$ %.', to_char(d.valor - v_pago, 'FM999G999G990D00');
  end if;

  perform public._checar_saldo_clientes(p_linhas);

  insert into public.pagamentos (lar_id, despesa_id, data, valor, conta_id, cliente_id)
  select v_lar, p_despesa, p_data, round((x->>'valor')::numeric, 2),
         (x->>'conta_id')::uuid, (x->>'cliente_id')::uuid
  from jsonb_array_elements(p_linhas) x;
end;
$$;

-- Saída rápida: também aceita partes pagas com o saldo do cliente.
create or replace function public.salvar_saida(
  p_id uuid, p_descricao text, p_categoria uuid, p_data date,
  p_competencia date, p_valor numeric, p_pagamentos jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_id uuid := p_id;
  v_soma numeric;
  v_qtd int;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if p_data is null then raise exception 'Informe a data.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;

  select count(*), coalesce(sum((x->>'valor')::numeric), 0)
  into v_qtd, v_soma
  from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) x;

  if v_qtd = 0 then raise exception 'Informe de onde saiu o dinheiro.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_pagamentos) x
    where coalesce((x->>'valor')::numeric, 0) <= 0
       or ((x->>'conta_id') is null) = ((x->>'cliente_id') is null)
  ) then
    raise exception 'Cada parte precisa de valor e de uma conta ou um cliente.';
  end if;
  if round(v_soma, 2) <> round(p_valor, 2) then
    raise exception 'A soma das partes (%) precisa ser igual ao valor (%).',
      to_char(v_soma, 'FM999G999G990D00'), to_char(p_valor, 'FM999G999G990D00');
  end if;

  if v_id is null then
    insert into public.despesas (lar_id, descricao, categoria_id, competencia, vencimento, valor, origem)
    values (v_lar, trim(p_descricao), p_categoria, coalesce(p_competencia, p_data), p_data, round(p_valor, 2), 'avulsa')
    returning id into v_id;
  else
    update public.despesas
    set descricao = trim(p_descricao), categoria_id = p_categoria,
        competencia = coalesce(p_competencia, p_data), vencimento = p_data, valor = round(p_valor, 2)
    where id = v_id and lar_id = v_lar;
    if not found then raise exception 'Lançamento não encontrado.'; end if;
    delete from public.pagamentos where despesa_id = v_id;
  end if;

  perform public._checar_saldo_clientes(p_pagamentos);

  insert into public.pagamentos (lar_id, despesa_id, data, valor, conta_id, cliente_id)
  select v_lar, v_id, p_data, round((x->>'valor')::numeric, 2), (x->>'conta_id')::uuid, (x->>'cliente_id')::uuid
  from jsonb_array_elements(p_pagamentos) x;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Dízimo
-- ---------------------------------------------------------------------

-- Cálculo do mês: percentual × máx(0; Renda Empresa − Despesas da Empresa), pela competência.
create or replace function public._calc_dizimo(p_lar uuid, p_mes date)
returns table (renda numeric, despesas_empresa numeric, base numeric, percentual numeric, valor numeric, ativo boolean)
language sql stable security definer
set search_path = public
as $$
  with l as (select dizimo_ativo, dizimo_percentual from public.lares where id = p_lar),
  r as (
    select coalesce(sum(e.valor), 0) as v
    from public.entradas e join public.categorias c on c.id = e.categoria_id
    where e.lar_id = p_lar and e.competencia = date_trunc('month', p_mes)::date and c.grupo = 'renda_empresa'
  ),
  d as (
    select coalesce(sum(x.valor), 0) as v
    from public.despesas x join public.categorias c on c.id = x.categoria_id
    where x.lar_id = p_lar and x.competencia = date_trunc('month', p_mes)::date and c.grupo = 'despesa_empresa'
  )
  select r.v, d.v, r.v - d.v, l.dizimo_percentual,
         case when l.dizimo_ativo then round(greatest(r.v - d.v, 0) * l.dizimo_percentual / 100, 2) else 0 end,
         l.dizimo_ativo
  from l, r, d;
$$;
revoke all on function public._calc_dizimo(uuid, date) from public, anon, authenticated;

-- Mantém a conta "Dízimo" do mês com o valor calculado.
-- Se já foi pago e a base subiu, a diferença aparece como "falta pagar".
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

-- Recalcula a cada lançamento de entrada ou despesa.
create or replace function public._trg_dizimo()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_table_name = 'despesas' then
    if (tg_op <> 'INSERT' and old.origem = 'dizimo') or (tg_op <> 'DELETE' and new.origem = 'dizimo') then
      return null;
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public._sync_dizimo(old.lar_id, old.competencia);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.competencia is distinct from old.competencia) then
    perform public._sync_dizimo(new.lar_id, new.competencia);
  end if;
  return null;
end;
$$;
revoke all on function public._trg_dizimo() from public, anon, authenticated;

create trigger entradas_dizimo after insert or update or delete on public.entradas
  for each row execute function public._trg_dizimo();
create trigger despesas_dizimo after insert or update or delete on public.despesas
  for each row execute function public._trg_dizimo();

-- Usado pelo app ao abrir o mês (e depois de mudar o percentual do dízimo).
create or replace function public.sincronizar_dizimo(p_mes date)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  perform public._sync_dizimo(v_lar, p_mes);
end;
$$;

-- Resumo do dízimo do mês para o Início.
create or replace function public.dizimo_mes(p_mes date)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  c record;
  d record;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  select * into c from public._calc_dizimo(v_lar, p_mes);
  select id, valor, pago, falta, status, vencimento into d
  from public.v_despesas
  where lar_id = v_lar and origem = 'dizimo' and competencia = date_trunc('month', p_mes)::date
  limit 1;
  return json_build_object(
    'ativo', c.ativo, 'percentual', c.percentual,
    'renda', c.renda, 'despesas_empresa', c.despesas_empresa, 'base', c.base, 'valor', c.valor,
    'despesa', case when d.id is null then null else json_build_object(
      'id', d.id, 'valor', d.valor, 'pago', d.pago, 'falta', d.falta, 'status', d.status, 'vencimento', d.vencimento) end
  );
end;
$$;

-- O valor do dízimo não é editado à mão (só o vencimento).
create or replace function public.editar_conta(
  p_id uuid, p_descricao text, p_categoria uuid, p_valor numeric, p_vencimento date, p_proximos boolean
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  d public.despesas;
  v_pago numeric;
  v_dia int;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_vencimento is null then raise exception 'Informe o vencimento.'; end if;

  select * into d from public.despesas where id = p_id and lar_id = v_lar;
  if not found then raise exception 'Conta não encontrada.'; end if;

  if d.origem = 'dizimo' then
    update public.despesas set vencimento = p_vencimento where id = p_id;
    return;
  end if;

  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;

  select coalesce(sum(valor), 0) into v_pago from public.pagamentos where despesa_id = p_id;
  if p_valor < v_pago - 0.005 then
    raise exception 'Já foram pagos R$ %. Desfaça um pagamento antes de diminuir o valor.', to_char(v_pago, 'FM999G999G990D00');
  end if;

  update public.despesas
  set descricao = trim(p_descricao), categoria_id = p_categoria, valor = round(p_valor, 2), vencimento = p_vencimento
  where id = p_id;

  if coalesce(p_proximos, false) and d.despesa_fixa_id is not null then
    v_dia := extract(day from p_vencimento)::int;

    update public.despesas_fixas
    set valor_padrao = round(p_valor, 2), dia_vencimento = v_dia, descricao = trim(p_descricao), categoria_id = p_categoria
    where id = d.despesa_fixa_id;

    update public.despesas x
    set valor = round(p_valor, 2), descricao = trim(p_descricao), categoria_id = p_categoria,
        vencimento = make_date(extract(year from x.competencia)::int, extract(month from x.competencia)::int,
                               least(v_dia, extract(day from (x.competencia + interval '1 month' - interval '1 day'))::int))
    where x.despesa_fixa_id = d.despesa_fixa_id
      and x.competencia > d.competencia
      and not exists (select 1 from public.pagamentos p where p.despesa_id = x.id);
  end if;
end;
$$;

revoke all on function public.saldo_cliente(uuid)                                     from public, anon;
revoke all on function public._checar_saldo_clientes(jsonb)                           from public, anon;
grant execute on function public._checar_saldo_clientes(jsonb)                        to authenticated;
revoke all on function public.receber_de_cliente(uuid, uuid, date, numeric, text)     from public, anon;
revoke all on function public.sincronizar_dizimo(date)                                from public, anon;
revoke all on function public.dizimo_mes(date)                                        from public, anon;
grant execute on function public.saldo_cliente(uuid)                                  to authenticated;
grant execute on function public.receber_de_cliente(uuid, uuid, date, numeric, text)  to authenticated;
grant execute on function public.sincronizar_dizimo(date)                             to authenticated;
grant execute on function public.dizimo_mes(date)                                     to authenticated;

-- Calcula o dízimo dos meses que já têm lançamentos.
select public._sync_dizimo(m.lar_id, m.competencia)
from (
  select distinct lar_id, competencia from public.entradas
  union
  select distinct lar_id, competencia from public.despesas
) m;

notify pgrst, 'reload schema';
