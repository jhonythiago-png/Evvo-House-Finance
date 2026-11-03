-- =====================================================================
-- Evvo House Finance — Migration 015 — Despesa da empresa paga no cartão
-- Igual à planilha antiga: a despesa da empresa passada no cartão é lançada
-- só para ABATER DO DÍZIMO. Ela não entra nas saídas nem pede de onde saiu o
-- dinheiro, porque a fatura do cartão é lançada inteira depois.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 014.
-- =====================================================================

create table public.dizimo_deducoes (
  id            uuid primary key default gen_random_uuid(),
  lar_id        uuid not null references public.lares(id) on delete cascade,
  data          date not null,
  competencia   date not null,
  descricao     text not null check (length(trim(descricao)) > 0),
  valor         numeric(12,2) not null check (valor > 0),
  categoria_id  uuid not null constraint deducoes_categoria_fkey references public.categorias(id),
  criado_por    uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now()
);
create index dizimo_deducoes_lar_comp_idx on public.dizimo_deducoes (lar_id, competencia);

-- Só categorias do grupo Despesas da Empresa, do mesmo lar.
create or replace function public._checar_deducao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.categorias
                 where id = new.categoria_id and lar_id = new.lar_id and grupo = 'despesa_empresa') then
    raise exception 'Escolha uma categoria do grupo Despesas da Empresa.';
  end if;
  new.competencia := date_trunc('month', coalesce(new.competencia, new.data))::date;
  return new;
end;
$$;
revoke all on function public._checar_deducao() from public, anon, authenticated;

create trigger deducoes_checar   before insert or update on public.dizimo_deducoes for each row execute function public._checar_deducao();
create trigger deducoes_autor    before insert or update on public.dizimo_deducoes for each row execute function public._autor();
create trigger deducoes_lar_fixo before update           on public.dizimo_deducoes for each row execute function public._lar_fixo();
create trigger deducoes_travar   before insert or update or delete on public.dizimo_deducoes for each row execute function public._travar_mes();
create trigger deducoes_dizimo   after insert or update or delete on public.dizimo_deducoes for each row execute function public._trg_dizimo();

alter table public.dizimo_deducoes enable row level security;
create policy deducoes_select on public.dizimo_deducoes for select to authenticated using (lar_id = (select public.meu_lar_com_acesso()));
create policy deducoes_insert on public.dizimo_deducoes for insert to authenticated with check (lar_id = (select public.meu_lar_com_acesso()));
create policy deducoes_update on public.dizimo_deducoes for update to authenticated using (lar_id = (select public.meu_lar_com_acesso())) with check (lar_id = (select public.meu_lar_com_acesso()));
create policy deducoes_delete on public.dizimo_deducoes for delete to authenticated using (lar_id = (select public.meu_lar_com_acesso()));
revoke all on public.dizimo_deducoes from anon;

-- O mês fechado também trava estas deduções.
create or replace function public._travar_mes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_campo text := case when tg_table_name in ('entradas', 'despesas', 'dizimo_deducoes') then 'competencia' else 'data' end;
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

-- O cálculo do dízimo passa a somar as deduções às Despesas da Empresa.
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
    select
      coalesce((select sum(x.valor)
                from public.despesas x join public.categorias c on c.id = x.categoria_id
                where x.lar_id = p_lar and x.competencia = date_trunc('month', p_mes)::date and c.grupo = 'despesa_empresa'), 0)
      -- Despesas da empresa pagas no cartão: só abatem do dízimo (a fatura entra inteira nas saídas).
      + coalesce((select sum(z.valor) from public.dizimo_deducoes z
                  where z.lar_id = p_lar and z.competencia = date_trunc('month', p_mes)::date), 0) as v
  )
  select r.v, d.v, r.v - d.v, l.dizimo_percentual,
         case when l.dizimo_ativo then round(greatest(r.v - d.v, 0) * l.dizimo_percentual / 100, 2) else 0 end,
         l.dizimo_ativo
  from l, r, d;
$$;
revoke all on function public._calc_dizimo(uuid, date) from public, anon, authenticated;

notify pgrst, 'reload schema';
