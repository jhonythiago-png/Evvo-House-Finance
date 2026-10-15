-- =====================================================================
-- Evvo House Finance — Migration 005 — Despesas fixas e pagamentos (Etapa 4)
-- Despesas fixas que geram as contas de cada mês, contas a pagar avulsas
-- (como faturas de cartão), pagamentos em partes e status de cada conta.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 004.
-- =====================================================================

-- Origem da despesa:
--   avulsa = saída rápida (já paga na hora)    conta = conta a pagar lançada (ex.: fatura)
--   fixa   = gerada por uma despesa fixa       dizimo = calculada (Etapa 5)
alter table public.despesas drop constraint if exists despesas_origem_check;
alter table public.despesas add constraint despesas_origem_check
  check (origem in ('avulsa', 'conta', 'fixa', 'dizimo'));

-- ---------------------------------------------------------------------
-- Despesas fixas
-- ---------------------------------------------------------------------
create table public.despesas_fixas (
  id              uuid primary key default gen_random_uuid(),
  lar_id          uuid not null references public.lares(id) on delete cascade,
  descricao       text not null check (length(trim(descricao)) > 0),
  categoria_id    uuid not null constraint fixas_categoria_fkey references public.categorias(id),
  valor_padrao    numeric(12,2) not null check (valor_padrao > 0),
  dia_vencimento  int not null check (dia_vencimento between 1 and 31),
  variavel        boolean not null default false,
  ativa           boolean not null default true,
  inicio          date not null default date_trunc('month', public.hoje_brt())::date,
  criado_por      uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em       timestamptz not null default now()
);
create index despesas_fixas_lar_idx on public.despesas_fixas (lar_id);

alter table public.despesas
  add column despesa_fixa_id uuid constraint despesas_fixa_fkey references public.despesas_fixas(id) on delete set null;
create unique index despesas_fixa_mes on public.despesas (despesa_fixa_id, competencia) where despesa_fixa_id is not null;

-- Meses em que uma fixa foi excluída de propósito (para não gerar de novo).
create table public.despesas_fixas_puladas (
  lar_id          uuid not null references public.lares(id) on delete cascade,
  despesa_fixa_id uuid not null references public.despesas_fixas(id) on delete cascade,
  competencia     date not null,
  primary key (despesa_fixa_id, competencia)
);

create or replace function public._checar_fixa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.categorias where id = new.categoria_id and lar_id = new.lar_id and tipo = 'saida') then
    raise exception 'Categoria inválida para despesa.';
  end if;
  new.inicio := date_trunc('month', new.inicio)::date;
  return new;
end;
$$;
create trigger despesas_fixas_checar before insert or update on public.despesas_fixas
  for each row execute function public._checar_fixa();

-- Ao excluir a conta de um mês gerada por fixa, marca o mês como pulado.
create or replace function public._pular_fixa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.despesa_fixa_id is not null
     and exists (select 1 from public.despesas_fixas where id = old.despesa_fixa_id) then
    insert into public.despesas_fixas_puladas (lar_id, despesa_fixa_id, competencia)
    values (old.lar_id, old.despesa_fixa_id, old.competencia)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
create trigger despesas_pular_fixa after delete on public.despesas
  for each row execute function public._pular_fixa();

alter table public.despesas_fixas         enable row level security;
alter table public.despesas_fixas_puladas enable row level security;

create policy fixas_select on public.despesas_fixas for select to authenticated using (public.tem_acesso(lar_id));
create policy fixas_insert on public.despesas_fixas for insert to authenticated with check (public.tem_acesso(lar_id));
create policy fixas_update on public.despesas_fixas for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy fixas_delete on public.despesas_fixas for delete to authenticated using (public.tem_acesso(lar_id));

create policy puladas_select on public.despesas_fixas_puladas for select to authenticated using (public.tem_acesso(lar_id));
create policy puladas_insert on public.despesas_fixas_puladas for insert to authenticated with check (public.tem_acesso(lar_id));
create policy puladas_delete on public.despesas_fixas_puladas for delete to authenticated using (public.tem_acesso(lar_id));

revoke all on public.despesas_fixas, public.despesas_fixas_puladas from anon;

-- ---------------------------------------------------------------------
-- Gera as contas do mês a partir das despesas fixas ativas.
-- Pode ser chamada várias vezes: não duplica.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Edita uma conta do mês. Se for de despesa fixa e p_proximos = true,
-- muda também o valor padrão e as contas já geradas dos meses seguintes que ainda não foram pagas.
-- ---------------------------------------------------------------------
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
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if p_vencimento is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;

  select * into d from public.despesas where id = p_id and lar_id = v_lar;
  if not found then raise exception 'Conta não encontrada.'; end if;

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

-- ---------------------------------------------------------------------
-- Registra pagamentos (pode ser parcial). p_linhas = [{"conta_id": "...", "valor": 100.00}, ...]
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
  if v_qtd = 0 or v_novo <= 0 then raise exception 'Informe quanto foi pago e de qual conta.'; end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) x where coalesce((x->>'valor')::numeric, 0) <= 0 or x->>'conta_id' is null) then
    raise exception 'Cada parte precisa de conta e valor maior que zero.';
  end if;

  select coalesce(sum(valor), 0) into v_pago from public.pagamentos where despesa_id = p_despesa;
  if round(v_pago + v_novo, 2) > round(d.valor, 2) then
    raise exception 'Passou do valor da conta. Falta pagar só R$ %.', to_char(d.valor - v_pago, 'FM999G999G990D00');
  end if;

  insert into public.pagamentos (lar_id, despesa_id, data, valor, conta_id)
  select v_lar, p_despesa, p_data, round((x->>'valor')::numeric, 2), (x->>'conta_id')::uuid
  from jsonb_array_elements(p_linhas) x;
end;
$$;

-- Desfaz todos os pagamentos de uma conta (ela volta para "a pagar").
create or replace function public.desfazer_pagamentos(p_despesa uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  delete from public.pagamentos where despesa_id = p_despesa and lar_id = v_lar;
end;
$$;

revoke all on function public.gerar_despesas_mes(date)                               from public, anon;
revoke all on function public.editar_conta(uuid, text, uuid, numeric, date, boolean) from public, anon;
revoke all on function public.registrar_pagamentos(uuid, date, jsonb)                from public, anon;
revoke all on function public.desfazer_pagamentos(uuid)                              from public, anon;
grant execute on function public.gerar_despesas_mes(date)                               to authenticated;
grant execute on function public.editar_conta(uuid, text, uuid, numeric, date, boolean) to authenticated;
grant execute on function public.registrar_pagamentos(uuid, date, jsonb)                to authenticated;
grant execute on function public.desfazer_pagamentos(uuid)                              to authenticated;

-- ---------------------------------------------------------------------
-- Contas com o quanto já foi pago, o que falta e o status.
-- ---------------------------------------------------------------------
create view public.v_despesas
with (security_invoker = true)
as
select
  d.id, d.lar_id, d.descricao, d.categoria_id, d.competencia, d.vencimento, d.valor, d.origem,
  d.despesa_fixa_id, d.criado_por, d.criado_em,
  c.nome  as categoria_nome,
  c.grupo as categoria_grupo,
  coalesce(f.variavel, false) as variavel,
  coalesce(p.pago, 0) as pago,
  d.valor - coalesce(p.pago, 0) as falta,
  case
    when coalesce(p.pago, 0) >= d.valor - 0.005 then 'pago'
    when coalesce(p.pago, 0) > 0 then 'parcial'
    else 'aberta'
  end as status,
  (coalesce(p.pago, 0) < d.valor - 0.005 and d.vencimento < public.hoje_brt()) as atrasada
from public.despesas d
join public.categorias c on c.id = d.categoria_id
left join public.despesas_fixas f on f.id = d.despesa_fixa_id
left join (select despesa_id, sum(valor) as pago from public.pagamentos group by despesa_id) p on p.despesa_id = d.id;

revoke all on public.v_despesas from anon;
grant select on public.v_despesas to authenticated;

notify pgrst, 'reload schema';
