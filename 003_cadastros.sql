-- =====================================================================
-- Evvo House Finance — Migration 003 — Cadastros (Etapa 2)
-- Contas, clientes, categorias com grupos padrão, pessoas da casa
-- e configuração do lar (nome e dízimo).
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------

-- Lar do usuário logado.
create or replace function public.meu_lar_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select lar_id from public.membros where user_id = auth.uid() limit 1;
$$;

-- Usuário logado é dono deste lar (e o lar está com acesso)?
create or replace function public.eh_dono(p_lar uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.tem_acesso(p_lar) and exists (
    select 1 from public.membros
    where lar_id = p_lar and user_id = auth.uid() and papel = 'dono'
  );
$$;

revoke all on function public.meu_lar_id()  from public, anon;
revoke all on function public.eh_dono(uuid) from public, anon;
grant execute on function public.meu_lar_id()  to authenticated;
grant execute on function public.eh_dono(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Onde o dinheiro está.
create table public.contas (
  id                 uuid primary key default gen_random_uuid(),
  lar_id             uuid not null references public.lares(id) on delete cascade,
  nome               text not null check (length(trim(nome)) > 0),
  natureza           text not null default 'PF' check (natureza in ('PF', 'PJ')),
  tipo               text not null default 'banco' check (tipo in ('banco', 'dinheiro')),
  saldo_inicial      numeric(12,2) not null default 0,
  data_saldo_inicial date not null default public.hoje_brt(),
  ativa              boolean not null default true,
  ordem              int not null default 0,
  criado_em          timestamptz not null default now()
);
create unique index contas_nome_unico on public.contas (lar_id, lower(trim(nome)));
create index contas_lar_idx on public.contas (lar_id);

-- Quem paga a renda da empresa.
create table public.clientes (
  id        uuid primary key default gen_random_uuid(),
  lar_id    uuid not null references public.lares(id) on delete cascade,
  nome      text not null check (length(trim(nome)) > 0),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index clientes_nome_unico on public.clientes (lar_id, lower(trim(nome)));
create index clientes_lar_idx on public.clientes (lar_id);

-- Categorias. O grupo decide o dízimo:
--   renda_empresa entra na base; despesa_empresa é deduzida; os demais ficam fora.
create table public.categorias (
  id        uuid primary key default gen_random_uuid(),
  lar_id    uuid not null references public.lares(id) on delete cascade,
  nome      text not null check (length(trim(nome)) > 0),
  tipo      text not null check (tipo in ('entrada', 'saida')),
  grupo     text not null check (grupo in ('renda_empresa', 'outras_rendas', 'despesa_casa', 'despesa_empresa', 'dizimo')),
  ativa     boolean not null default true,
  padrao    boolean not null default false,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  check (
    (tipo = 'entrada' and grupo in ('renda_empresa', 'outras_rendas')) or
    (tipo = 'saida'   and grupo in ('despesa_casa', 'despesa_empresa', 'dizimo'))
  )
);
create unique index categorias_nome_unico on public.categorias (lar_id, tipo, lower(trim(nome)));
create index categorias_lar_idx on public.categorias (lar_id);

-- ---------------------------------------------------------------------
-- RLS: qualquer membro com acesso ao lar lê e grava os cadastros do lar.
-- ---------------------------------------------------------------------
alter table public.contas     enable row level security;
alter table public.clientes   enable row level security;
alter table public.categorias enable row level security;

create policy contas_select on public.contas for select to authenticated using (public.tem_acesso(lar_id));
create policy contas_insert on public.contas for insert to authenticated with check (public.tem_acesso(lar_id));
create policy contas_update on public.contas for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy contas_delete on public.contas for delete to authenticated using (public.tem_acesso(lar_id));

create policy clientes_select on public.clientes for select to authenticated using (public.tem_acesso(lar_id));
create policy clientes_insert on public.clientes for insert to authenticated with check (public.tem_acesso(lar_id));
create policy clientes_update on public.clientes for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
create policy clientes_delete on public.clientes for delete to authenticated using (public.tem_acesso(lar_id));

create policy categorias_select on public.categorias for select to authenticated using (public.tem_acesso(lar_id));
create policy categorias_insert on public.categorias for insert to authenticated with check (public.tem_acesso(lar_id) and padrao = false);
create policy categorias_update on public.categorias for update to authenticated using (public.tem_acesso(lar_id)) with check (public.tem_acesso(lar_id));
-- Categorias padrão não são excluídas (podem ser desativadas).
create policy categorias_delete on public.categorias for delete to authenticated using (public.tem_acesso(lar_id) and padrao = false);

revoke all on public.contas, public.clientes, public.categorias from anon;

-- ---------------------------------------------------------------------
-- Categorias padrão de todo lar novo
-- ---------------------------------------------------------------------
create or replace function public._criar_categorias_padrao(p_lar uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.categorias (lar_id, nome, tipo, grupo, padrao, ordem)
  select p_lar, c.nome, c.tipo, c.grupo, true, c.ordem
  from (values
    ('Renda da empresa',             'entrada', 'renda_empresa',    10),
    ('Aluguel recebido',             'entrada', 'outras_rendas',    20),
    ('Outras rendas',                'entrada', 'outras_rendas',    21),
    ('Moradia',                      'saida',   'despesa_casa',     30),
    ('Contas da casa',               'saida',   'despesa_casa',     31),
    ('Cartão de crédito (fatura)',   'saida',   'despesa_casa',     32),
    ('Educação',                     'saida',   'despesa_casa',     33),
    ('Saúde',                        'saida',   'despesa_casa',     34),
    ('Mercado e alimentação',        'saida',   'despesa_casa',     35),
    ('Veículo e transporte',         'saida',   'despesa_casa',     36),
    ('Lazer e presentes',            'saida',   'despesa_casa',     37),
    ('Pix e dinheiro do dia a dia',  'saida',   'despesa_casa',     38),
    ('Outras despesas',              'saida',   'despesa_casa',     39),
    ('Impostos (DAS, INSS)',         'saida',   'despesa_empresa',  50),
    ('Contador',                     'saida',   'despesa_empresa',  51),
    ('Tarifas e juros bancários',    'saida',   'despesa_empresa',  52),
    ('Sistemas e telefone da empresa','saida',  'despesa_empresa',  53),
    ('Outras despesas da empresa',   'saida',   'despesa_empresa',  54),
    ('Dízimo',                       'saida',   'dizimo',           60),
    ('Ofertas',                      'saida',   'dizimo',           61)
  ) as c(nome, tipo, grupo, ordem)
  on conflict do nothing;
end;
$$;
revoke all on function public._criar_categorias_padrao(uuid) from public, anon, authenticated;

create or replace function public._trg_lar_novo()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._criar_categorias_padrao(new.id);
  return new;
end;
$$;
revoke all on function public._trg_lar_novo() from public, anon, authenticated;

create trigger lares_categorias_padrao
  after insert on public.lares
  for each row execute function public._trg_lar_novo();

-- Lares que já existem ganham as categorias padrão agora.
select public._criar_categorias_padrao(id) from public.lares;

-- ---------------------------------------------------------------------
-- O que o app recebe ao abrir (agora com nome da pessoa e dízimo)
-- ---------------------------------------------------------------------
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
        'id',                l.id,
        'nome',              l.nome,
        'plano',             l.plano,
        'situacao',          l.situacao,
        'acesso_ate',        l.acesso_ate,
        'papel',             m.papel,
        'meu_nome',          m.nome,
        'dizimo_ativo',      l.dizimo_ativo,
        'dizimo_percentual', l.dizimo_percentual,
        'tem_acesso',        public.tem_acesso(l.id)
      )
      from public.membros m
      join public.lares l on l.id = m.lar_id
      where m.user_id = auth.uid()
      limit 1
    )
  );
$$;

-- ---------------------------------------------------------------------
-- Pessoas da casa
-- ---------------------------------------------------------------------

-- Membros e convites pendentes do lar.
create or replace function public.listar_pessoas()
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then
    raise exception 'Sem acesso a este lar.' using errcode = '42501';
  end if;
  return json_build_object(
    'membros', coalesce((
      select json_agg(json_build_object(
               'user_id', m.user_id, 'nome', m.nome, 'email', u.email,
               'papel', m.papel, 'voce', m.user_id = auth.uid())
             order by (m.papel = 'dono') desc, m.criado_em)
      from public.membros m join auth.users u on u.id = m.user_id
      where m.lar_id = v_lar), '[]'::json),
    'convites', coalesce((
      select json_agg(json_build_object('id', c.id, 'email', c.email, 'nome', c.nome, 'criado_em', c.criado_em)
             order by c.criado_em)
      from public.convites c
      where c.lar_id = v_lar and c.aceito_em is null), '[]'::json)
  );
end;
$$;

-- O dono convida alguém para o lar. Se o e-mail já tem conta sem lar, liga na hora.
create or replace function public.convidar_membro(p_email text, p_nome text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_lar_existente text;
begin
  if v_lar is null or not public.eh_dono(v_lar) then
    raise exception 'Só o dono do lar pode convidar pessoas.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido.';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    select l.nome into v_lar_existente
    from public.membros m join public.lares l on l.id = m.lar_id
    where m.user_id = v_user;
    if v_lar_existente is not null then
      raise exception 'Este e-mail já participa do lar "%".', v_lar_existente;
    end if;
    insert into public.membros (lar_id, user_id, nome, papel)
    values (v_lar, v_user, nullif(trim(p_nome), ''), 'membro');
    return json_build_object('ligado', true);
  end if;

  if exists (select 1 from public.convites where email = v_email and aceito_em is null) then
    raise exception 'Já existe um convite pendente para este e-mail.';
  end if;

  insert into public.convites (lar_id, email, nome, papel, criado_por)
  values (v_lar, v_email, nullif(trim(p_nome), ''), 'membro', lower(auth.jwt() ->> 'email'));
  return json_build_object('ligado', false);
end;
$$;

-- O dono cancela um convite pendente.
create or replace function public.cancelar_convite(p_convite uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.eh_dono(v_lar) then
    raise exception 'Só o dono do lar pode cancelar convites.' using errcode = '42501';
  end if;
  delete from public.convites where id = p_convite and lar_id = v_lar and aceito_em is null;
end;
$$;

-- O dono remove um membro (nunca o dono).
create or replace function public.remover_membro(p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.eh_dono(v_lar) then
    raise exception 'Só o dono do lar pode remover pessoas.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode remover a si mesmo.';
  end if;
  delete from public.membros where lar_id = v_lar and user_id = p_user and papel = 'membro';
  if not found then raise exception 'Pessoa não encontrada neste lar.'; end if;
end;
$$;

-- Cada pessoa ajusta o próprio nome.
create or replace function public.atualizar_meu_nome(p_nome text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe seu nome.'; end if;
  update public.membros set nome = trim(p_nome) where user_id = auth.uid();
end;
$$;

-- O dono ajusta o nome do lar e o dízimo.
create or replace function public.salvar_config_lar(p_nome text, p_dizimo_ativo boolean, p_percentual numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.eh_dono(v_lar) then
    raise exception 'Só o dono do lar pode alterar estas configurações.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do lar.'; end if;
  if p_percentual is null or p_percentual < 0 or p_percentual > 100 then
    raise exception 'O percentual do dízimo deve ficar entre 0 e 100.';
  end if;
  update public.lares
  set nome = trim(p_nome), dizimo_ativo = coalesce(p_dizimo_ativo, true), dizimo_percentual = round(p_percentual, 2)
  where id = v_lar;
end;
$$;

revoke all on function public.listar_pessoas()                        from public, anon;
revoke all on function public.convidar_membro(text, text)             from public, anon;
revoke all on function public.cancelar_convite(uuid)                  from public, anon;
revoke all on function public.remover_membro(uuid)                    from public, anon;
revoke all on function public.atualizar_meu_nome(text)                from public, anon;
revoke all on function public.salvar_config_lar(text, boolean, numeric) from public, anon;
grant execute on function public.listar_pessoas()                        to authenticated;
grant execute on function public.convidar_membro(text, text)             to authenticated;
grant execute on function public.cancelar_convite(uuid)                  to authenticated;
grant execute on function public.remover_membro(uuid)                    to authenticated;
grant execute on function public.atualizar_meu_nome(text)                to authenticated;
grant execute on function public.salvar_config_lar(text, boolean, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- Painel Master: considerar só convites de responsável (dono),
-- para os convites de pessoas da casa não aparecerem como pendência do lar.
-- ---------------------------------------------------------------------
create or replace function public.master_listar_lares()
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public._exigir_super();
  return coalesce((
    select json_agg(x order by x.criado_em desc)
    from (
      select
        l.id, l.nome, l.plano, l.situacao, l.acesso_ate, l.criado_em,
        (select u.email from public.membros m join auth.users u on u.id = m.user_id
          where m.lar_id = l.id and m.papel = 'dono' order by m.criado_em limit 1) as dono_email,
        (select m.nome from public.membros m
          where m.lar_id = l.id and m.papel = 'dono' order by m.criado_em limit 1) as dono_nome,
        (select count(*) from public.membros m where m.lar_id = l.id) as qtd_membros,
        (select c.email from public.convites c
          where c.lar_id = l.id and c.aceito_em is null and c.papel = 'dono'
          order by c.criado_em desc limit 1) as convite_email,
        (select c.nome from public.convites c
          where c.lar_id = l.id and c.aceito_em is null and c.papel = 'dono'
          order by c.criado_em desc limit 1) as convite_nome,
        case
          when l.situacao = 'bloqueado' then 'bloqueado'
          when l.acesso_ate is not null and l.acesso_ate < public.hoje_brt() then 'vencido'
          else l.situacao
        end as estado,
        case when l.acesso_ate is null then null else l.acesso_ate - public.hoje_brt() end as dias_restantes
      from public.lares l
    ) x
  ), '[]'::json);
end;
$$;

create or replace function public.master_corrigir_convite(p_lar uuid, p_email text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  c public.convites;
  v_user uuid;
  v_lar_existente text;
begin
  perform public._exigir_super();
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido.';
  end if;

  select * into c from public.convites
  where lar_id = p_lar and aceito_em is null and papel = 'dono'
  order by criado_em desc limit 1;
  if not found then raise exception 'Este lar não tem convite pendente.'; end if;

  if exists (select 1 from public.convites where email = v_email and aceito_em is null and id <> c.id) then
    raise exception 'Já existe um convite pendente para este e-mail.';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    select l.nome into v_lar_existente
    from public.membros m join public.lares l on l.id = m.lar_id
    where m.user_id = v_user;
    if v_lar_existente is not null then
      raise exception 'Este e-mail já participa do lar "%".', v_lar_existente;
    end if;
    insert into public.membros (lar_id, user_id, nome, papel) values (p_lar, v_user, c.nome, c.papel);
    update public.convites set email = v_email, aceito_em = now(), aceito_por = v_user where id = c.id;
    perform public._registrar(p_lar, 'Corrigiu o convite', format('%s → %s (já tinha conta: ligado na hora)', c.email, v_email));
    return json_build_object('ligado', true);
  end if;

  update public.convites set email = v_email where id = c.id;
  perform public._registrar(p_lar, 'Corrigiu o convite', format('%s → %s', c.email, v_email));
  return json_build_object('ligado', false);
end;
$$;

notify pgrst, 'reload schema';
