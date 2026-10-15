-- =====================================================================
-- Evvo House Finance — Migration 004 — Lançamentos (Etapa 3)
-- Entradas, despesas, pagamentos, transferências e saldo calculado das contas.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 003.
--
-- Regra do saldo: o saldo inicial da conta é o saldo no FIM do dia de corte.
-- Contam no saldo só os movimentos com data DEPOIS desse dia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Renda lançada. conta_id vazio = o dinheiro ficou com o cliente (a receber).
create table public.entradas (
  id            uuid primary key default gen_random_uuid(),
  lar_id        uuid not null references public.lares(id) on delete cascade,
  data          date not null,
  competencia   date not null,
  valor         numeric(12,2) not null check (valor > 0),
  descricao     text,
  categoria_id  uuid not null constraint entradas_categoria_fkey references public.categorias(id),
  cliente_id    uuid constraint entradas_cliente_fkey references public.clientes(id),
  conta_id      uuid constraint entradas_conta_fkey references public.contas(id),
  criado_por    uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (conta_id is not null or cliente_id is not null)
);
create index entradas_lar_comp_idx on public.entradas (lar_id, competencia);
create index entradas_conta_idx on public.entradas (conta_id);
create index entradas_cliente_idx on public.entradas (cliente_id);

-- Contas a pagar e gastos. Na Etapa 3 toda saída é lançada já paga.
create table public.despesas (
  id            uuid primary key default gen_random_uuid(),
  lar_id        uuid not null references public.lares(id) on delete cascade,
  descricao     text not null check (length(trim(descricao)) > 0),
  categoria_id  uuid not null constraint despesas_categoria_fkey references public.categorias(id),
  competencia   date not null,
  vencimento    date not null,
  valor         numeric(12,2) not null check (valor > 0),
  origem        text not null default 'avulsa' check (origem in ('avulsa', 'fixa', 'dizimo')),
  criado_por    uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index despesas_lar_comp_idx on public.despesas (lar_id, competencia);

-- Cada parte que pagou uma despesa: de uma conta OU do saldo de um cliente (Etapa 5).
create table public.pagamentos (
  id          uuid primary key default gen_random_uuid(),
  lar_id      uuid not null references public.lares(id) on delete cascade,
  despesa_id  uuid not null constraint pagamentos_despesa_fkey references public.despesas(id) on delete cascade,
  data        date not null,
  valor       numeric(12,2) not null check (valor > 0),
  conta_id    uuid constraint pagamentos_conta_fkey references public.contas(id),
  cliente_id  uuid constraint pagamentos_cliente_fkey references public.clientes(id),
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now(),
  check ((conta_id is not null) <> (cliente_id is not null))
);
create index pagamentos_despesa_idx on public.pagamentos (despesa_id);
create index pagamentos_conta_idx on public.pagamentos (conta_id);

-- Dinheiro que mudou de conta. Não é renda nem despesa.
create table public.transferencias (
  id            uuid primary key default gen_random_uuid(),
  lar_id        uuid not null references public.lares(id) on delete cascade,
  data          date not null,
  valor         numeric(12,2) not null check (valor > 0),
  conta_origem  uuid not null constraint transferencias_origem_fkey references public.contas(id),
  conta_destino uuid not null constraint transferencias_destino_fkey references public.contas(id),
  descricao     text,
  criado_por    uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (conta_origem <> conta_destino)
);
create index transferencias_lar_data_idx on public.transferencias (lar_id, data);

-- ---------------------------------------------------------------------
-- Conferência: tudo que um lançamento aponta precisa ser do mesmo lar
-- ---------------------------------------------------------------------
create or replace function public._checar_entrada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.categorias where id = new.categoria_id and lar_id = new.lar_id and tipo = 'entrada') then
    raise exception 'Categoria inválida para entrada.';
  end if;
  if new.cliente_id is not null and not exists (select 1 from public.clientes where id = new.cliente_id and lar_id = new.lar_id) then
    raise exception 'Cliente inválido.';
  end if;
  if new.conta_id is not null and not exists (select 1 from public.contas where id = new.conta_id and lar_id = new.lar_id) then
    raise exception 'Conta inválida.';
  end if;
  new.competencia := date_trunc('month', coalesce(new.competencia, new.data))::date;
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger entradas_checar before insert or update on public.entradas
  for each row execute function public._checar_entrada();

create or replace function public._checar_despesa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.categorias where id = new.categoria_id and lar_id = new.lar_id and tipo = 'saida') then
    raise exception 'Categoria inválida para saída.';
  end if;
  new.competencia := date_trunc('month', coalesce(new.competencia, new.vencimento))::date;
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger despesas_checar before insert or update on public.despesas
  for each row execute function public._checar_despesa();

create or replace function public._checar_pagamento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.despesas where id = new.despesa_id and lar_id = new.lar_id) then
    raise exception 'Despesa inválida.';
  end if;
  if new.conta_id is not null and not exists (select 1 from public.contas where id = new.conta_id and lar_id = new.lar_id) then
    raise exception 'Conta inválida.';
  end if;
  if new.cliente_id is not null and not exists (select 1 from public.clientes where id = new.cliente_id and lar_id = new.lar_id) then
    raise exception 'Cliente inválido.';
  end if;
  return new;
end;
$$;
create trigger pagamentos_checar before insert or update on public.pagamentos
  for each row execute function public._checar_pagamento();

create or replace function public._checar_transferencia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.contas where id in (new.conta_origem, new.conta_destino) and lar_id = new.lar_id) <> 2 then
    raise exception 'Conta inválida.';
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger transferencias_checar before insert or update on public.transferencias
  for each row execute function public._checar_transferencia();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.entradas       enable row level security;
alter table public.despesas       enable row level security;
alter table public.pagamentos     enable row level security;
alter table public.transferencias enable row level security;

create policy entradas_select on public.entradas for select to authenticated using (public.tem_acesso(lar_id));
create policy entradas_insert on public.entradas for insert to authenticated with check (public.tem_acesso(lar_id));
create policy entradas_update on public.entradas for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy entradas_delete on public.entradas for delete to authenticated using (public.tem_acesso(lar_id));

create policy despesas_select on public.despesas for select to authenticated using (public.tem_acesso(lar_id));
create policy despesas_insert on public.despesas for insert to authenticated with check (public.tem_acesso(lar_id));
create policy despesas_update on public.despesas for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy despesas_delete on public.despesas for delete to authenticated using (public.tem_acesso(lar_id));

create policy pagamentos_select on public.pagamentos for select to authenticated using (public.tem_acesso(lar_id));
create policy pagamentos_insert on public.pagamentos for insert to authenticated with check (public.tem_acesso(lar_id));
create policy pagamentos_update on public.pagamentos for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy pagamentos_delete on public.pagamentos for delete to authenticated using (public.tem_acesso(lar_id));

create policy transferencias_select on public.transferencias for select to authenticated using (public.tem_acesso(lar_id));
create policy transferencias_insert on public.transferencias for insert to authenticated with check (public.tem_acesso(lar_id));
create policy transferencias_update on public.transferencias for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy transferencias_delete on public.transferencias for delete to authenticated using (public.tem_acesso(lar_id));

revoke all on public.entradas, public.despesas, public.pagamentos, public.transferencias from anon;

-- ---------------------------------------------------------------------
-- Saída rápida: cria (ou edita) a despesa e os pagamentos juntos.
-- p_pagamentos = [{"conta_id": "...", "valor": 100.50}, ...] — a soma precisa fechar com p_valor.
-- ---------------------------------------------------------------------
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
  if v_lar is null or not public.tem_acesso(v_lar) then
    raise exception 'Sem acesso a este lar.';
  end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if p_data is null then raise exception 'Informe a data.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;

  select count(*), coalesce(sum((x->>'valor')::numeric), 0)
  into v_qtd, v_soma
  from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) x;

  if v_qtd = 0 then raise exception 'Informe de qual conta saiu o dinheiro.'; end if;
  if round(v_soma, 2) <> round(p_valor, 2) then
    raise exception 'A soma das contas (%) precisa ser igual ao valor (%).',
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

  insert into public.pagamentos (lar_id, despesa_id, data, valor, conta_id)
  select v_lar, v_id, p_data, round((x->>'valor')::numeric, 2), (x->>'conta_id')::uuid
  from jsonb_array_elements(p_pagamentos) x
  where (x->>'valor')::numeric > 0;

  return v_id;
end;
$$;
revoke all on function public.salvar_saida(uuid, text, uuid, date, date, numeric, jsonb) from public, anon;
grant execute on function public.salvar_saida(uuid, text, uuid, date, date, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Saldo calculado de cada conta (respeita a RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.v_saldo_contas
with (security_invoker = true)
as
select
  c.id, c.lar_id, c.nome, c.natureza, c.tipo, c.ativa, c.ordem,
  c.saldo_inicial, c.data_saldo_inicial,
  c.saldo_inicial
    + coalesce((select sum(e.valor) from public.entradas e
                where e.conta_id = c.id and e.data > c.data_saldo_inicial), 0)
    + coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_destino = c.id and t.data > c.data_saldo_inicial), 0)
    - coalesce((select sum(t.valor) from public.transferencias t
                where t.conta_origem = c.id and t.data > c.data_saldo_inicial), 0)
    - coalesce((select sum(p.valor) from public.pagamentos p
                where p.conta_id = c.id and p.data > c.data_saldo_inicial), 0)
  as saldo_atual
from public.contas c;

revoke all on public.v_saldo_contas from anon;
grant select on public.v_saldo_contas to authenticated;

notify pgrst, 'reload schema';
