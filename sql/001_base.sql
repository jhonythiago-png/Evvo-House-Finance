-- =====================================================================
-- Evvo House Finance — Migration 001 — Base (Etapa 0)
-- Lares (clientes do SaaS), membros, super admins, funções de acesso e RLS.
-- Rode UMA vez no SQL Editor do Supabase. Nunca edite depois de aplicada:
-- correções vão em uma nova migration (002, 003...).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Cada lar é um cliente do SaaS (uma família).
create table public.lares (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (length(trim(nome)) > 0),
  plano             text not null default 'teste'
                    check (plano in ('teste', 'familia', 'familia_empresa', 'master')),
  situacao          text not null default 'teste'
                    check (situacao in ('ativo', 'teste', 'bloqueado')),
  acesso_ate        date,                       -- vazio = sem vencimento
  dizimo_ativo      boolean not null default true,
  dizimo_percentual numeric(5,2) not null default 10
                    check (dizimo_percentual >= 0 and dizimo_percentual <= 100),
  criado_em         timestamptz not null default now()
);

-- Pessoas que usam o lar. Nesta versão, cada usuário pertence a um lar só.
create table public.membros (
  lar_id    uuid not null references public.lares(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  nome      text,
  papel     text not null default 'membro' check (papel in ('dono', 'membro')),
  criado_em timestamptz not null default now(),
  primary key (lar_id, user_id)
);
create unique index membros_um_lar_por_usuario on public.membros (user_id);

-- Quem acessa o Painel Master (identificado pelo e-mail do login).
create table public.super_admins (
  email     text primary key check (email = lower(email)),
  criado_em timestamptz not null default now()
);

insert into public.super_admins (email) values ('jhonythiago@gmail.com');

-- ---------------------------------------------------------------------
-- Funções de acesso (usadas pelas políticas RLS e pelo app)
-- ---------------------------------------------------------------------

-- Usuário logado é super admin?
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.super_admins s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Usuário logado é membro deste lar?
create or replace function public.is_membro(p_lar uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros m
    where m.lar_id = p_lar and m.user_id = auth.uid()
  );
$$;

-- Usuário logado pode ler e gravar os dados financeiros deste lar?
-- Exige ser membro, lar não bloqueado e acesso dentro do prazo (horário de Brasília).
-- O super admin NÃO ganha acesso aos dados financeiros dos lares: ele só administra acessos.
create or replace function public.tem_acesso(p_lar uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lares l
    join public.membros m on m.lar_id = l.id
    where l.id = p_lar
      and m.user_id = auth.uid()
      and l.situacao <> 'bloqueado'
      and (l.acesso_ate is null
           or l.acesso_ate >= (now() at time zone 'America/Sao_Paulo')::date)
  );
$$;

-- Tudo que o app precisa saber ao abrir: quem é, se é super admin e o lar dele.
create or replace function public.meu_lar()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'email',    auth.jwt() ->> 'email',
    'eh_super', public.is_super_admin(),
    'lar', (
      select json_build_object(
        'id',         l.id,
        'nome',       l.nome,
        'plano',      l.plano,
        'situacao',   l.situacao,
        'acesso_ate', l.acesso_ate,
        'papel',      m.papel,
        'tem_acesso', public.tem_acesso(l.id)
      )
      from public.membros m
      join public.lares l on l.id = m.lar_id
      where m.user_id = auth.uid()
      limit 1
    )
  );
$$;

revoke all on function public.is_super_admin()  from public, anon;
revoke all on function public.is_membro(uuid)   from public, anon;
revoke all on function public.tem_acesso(uuid)  from public, anon;
revoke all on function public.meu_lar()         from public, anon;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_membro(uuid)  to authenticated;
grant execute on function public.tem_acesso(uuid) to authenticated;
grant execute on function public.meu_lar()        to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.lares        enable row level security;
alter table public.membros      enable row level security;
alter table public.super_admins enable row level security;

-- lares: o membro vê o próprio lar; só super admin cria, altera e exclui.
create policy lares_select on public.lares
  for select to authenticated
  using (public.is_membro(id) or public.is_super_admin());

create policy lares_insert on public.lares
  for insert to authenticated
  with check (public.is_super_admin());

create policy lares_update on public.lares
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy lares_delete on public.lares
  for delete to authenticated
  using (public.is_super_admin());

-- membros: cada um vê os membros do próprio lar; só super admin altera (convites do dono chegam na Etapa 2).
create policy membros_select on public.membros
  for select to authenticated
  using (user_id = auth.uid() or public.is_membro(lar_id) or public.is_super_admin());

create policy membros_insert on public.membros
  for insert to authenticated
  with check (public.is_super_admin());

create policy membros_update on public.membros
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy membros_delete on public.membros
  for delete to authenticated
  using (public.is_super_admin());

-- super_admins: cada um só consegue ver a si mesmo; ninguém grava pela API.
create policy super_admins_select on public.super_admins
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Visitante sem login não acessa nada.
revoke all on public.lares, public.membros, public.super_admins from anon;
