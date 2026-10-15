-- =====================================================================
-- Evvo House Finance — Migration 002 — Painel Master (Etapa 1)
-- Convites por e-mail, registro de atividades e funções do painel.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 001.
-- =====================================================================

-- Data de hoje no horário de Brasília (usada nos vencimentos).
create or replace function public.hoje_brt()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Convite: o master cadastra o e-mail do responsável; quando essa pessoa
-- cria a conta e entra no app, ela é ligada ao lar automaticamente.
create table public.convites (
  id          uuid primary key default gen_random_uuid(),
  lar_id      uuid not null references public.lares(id) on delete cascade,
  email       text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  nome        text,
  papel       text not null default 'dono' check (papel in ('dono', 'membro')),
  criado_em   timestamptz not null default now(),
  criado_por  text,
  aceito_em   timestamptz,
  aceito_por  uuid references auth.users(id) on delete set null
);
create unique index convites_um_pendente_por_email on public.convites (email) where aceito_em is null;

-- Tudo que acontece no painel fica registrado.
create table public.atividades_master (
  id          bigint generated always as identity primary key,
  criado_em   timestamptz not null default now(),
  autor_email text not null,
  lar_id      uuid references public.lares(id) on delete set null,
  lar_nome    text,
  acao        text not null,
  detalhe     text
);
create index atividades_master_data_idx on public.atividades_master (criado_em desc);

alter table public.convites          enable row level security;
alter table public.atividades_master enable row level security;

-- Só leitura direta para super admin; toda gravação passa pelas funções abaixo.
create policy convites_select on public.convites
  for select to authenticated using (public.is_super_admin());
create policy atividades_select on public.atividades_master
  for select to authenticated using (public.is_super_admin());

revoke all on public.convites, public.atividades_master from anon;

-- ---------------------------------------------------------------------
-- Funções internas (não chamáveis pelo app)
-- ---------------------------------------------------------------------

create or replace function public._exigir_super()
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso restrito ao Painel Master.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._registrar(p_lar uuid, p_acao text, p_detalhe text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.atividades_master (autor_email, lar_id, lar_nome, acao, detalhe)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), p_lar,
          (select nome from public.lares where id = p_lar), p_acao, p_detalhe);
end;
$$;

revoke all on function public._exigir_super() from public, anon, authenticated;
revoke all on function public._registrar(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções do Painel Master
-- ---------------------------------------------------------------------

-- Lista de lares com responsável, convite pendente e estado calculado.
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
          where c.lar_id = l.id and c.aceito_em is null order by c.criado_em desc limit 1) as convite_email,
        (select c.nome from public.convites c
          where c.lar_id = l.id and c.aceito_em is null order by c.criado_em desc limit 1) as convite_nome,
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

-- Cria um lar e convida o responsável. Se o e-mail já tem conta (sem lar), liga na hora.
create or replace function public.master_criar_lar(
  p_nome text, p_email text, p_nome_resp text, p_plano text, p_dias int
)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_lar_existente text;
  v_lar uuid;
  v_ate date;
  v_ligado boolean := false;
begin
  perform public._exigir_super();

  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome do lar.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail do responsável inválido.';
  end if;
  if p_plano not in ('teste', 'familia', 'familia_empresa', 'master') then
    raise exception 'Plano inválido.';
  end if;
  if p_plano = 'teste' and coalesce(p_dias, 0) <= 0 then
    raise exception 'O teste grátis precisa de dias de acesso.';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    select l.nome into v_lar_existente
    from public.membros m join public.lares l on l.id = m.lar_id
    where m.user_id = v_user;
    if v_lar_existente is not null then
      raise exception 'Este e-mail já participa do lar "%".', v_lar_existente;
    end if;
  end if;

  if exists (select 1 from public.convites where email = v_email and aceito_em is null) then
    raise exception 'Já existe um convite pendente para este e-mail.';
  end if;

  v_ate := case when p_plano = 'master' or coalesce(p_dias, 0) <= 0 then null
                else public.hoje_brt() + p_dias end;

  insert into public.lares (nome, plano, situacao, acesso_ate)
  values (trim(p_nome), p_plano, case when p_plano = 'teste' then 'teste' else 'ativo' end, v_ate)
  returning id into v_lar;

  if v_user is not null then
    insert into public.membros (lar_id, user_id, nome, papel)
    values (v_lar, v_user, nullif(trim(p_nome_resp), ''), 'dono');
    v_ligado := true;
  else
    insert into public.convites (lar_id, email, nome, papel, criado_por)
    values (v_lar, v_email, nullif(trim(p_nome_resp), ''), 'dono', lower(auth.jwt() ->> 'email'));
  end if;

  perform public._registrar(v_lar, 'Criou o lar',
    format('Plano %s, responsável %s%s', p_plano, v_email,
           case when v_ligado then ' (já tinha conta: ligado na hora)' else ' (convite pendente)' end));

  return json_build_object('lar_id', v_lar, 'ligado', v_ligado);
end;
$$;

-- Bloqueia o lar (o app para de abrir para os membros na hora).
create or replace function public.master_bloquear(p_lar uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare l public.lares;
begin
  perform public._exigir_super();
  select * into l from public.lares where id = p_lar;
  if not found then raise exception 'Lar não encontrado.'; end if;
  if l.plano = 'master' then raise exception 'O lar master não pode ser bloqueado.'; end if;
  if l.situacao = 'bloqueado' then return; end if;

  update public.lares set situacao = 'bloqueado' where id = p_lar;
  perform public._registrar(p_lar, 'Bloqueou', nullif(trim(coalesce(p_motivo, '')), ''));
end;
$$;

-- Libera o lar. Se o acesso estava vencido, ganha p_dias a partir de hoje.
create or replace function public.master_liberar(p_lar uuid, p_dias int default 30)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l public.lares;
  v_ate date;
begin
  perform public._exigir_super();
  select * into l from public.lares where id = p_lar;
  if not found then raise exception 'Lar não encontrado.'; end if;

  v_ate := l.acesso_ate;
  if v_ate is not null and v_ate < public.hoje_brt() then
    v_ate := public.hoje_brt() + greatest(coalesce(p_dias, 30), 1);
  end if;

  update public.lares
  set situacao = case when plano = 'teste' then 'teste' else 'ativo' end,
      acesso_ate = v_ate
  where id = p_lar;

  perform public._registrar(p_lar, 'Liberou',
    case when v_ate is distinct from l.acesso_ate
         then format('Acesso renovado até %s', to_char(v_ate, 'DD/MM/YYYY')) end);
end;
$$;

-- Estende o acesso em p_dias (conta a partir de hoje se já estava vencido).
create or replace function public.master_estender(p_lar uuid, p_dias int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l public.lares;
  v_ate date;
begin
  perform public._exigir_super();
  if p_dias is null or p_dias < 1 or p_dias > 3650 then
    raise exception 'Informe de 1 a 3650 dias.';
  end if;
  select * into l from public.lares where id = p_lar;
  if not found then raise exception 'Lar não encontrado.'; end if;
  if l.acesso_ate is null then raise exception 'Este lar não tem vencimento.'; end if;

  v_ate := greatest(l.acesso_ate, public.hoje_brt()) + p_dias;
  update public.lares set acesso_ate = v_ate where id = p_lar;
  perform public._registrar(p_lar, 'Estendeu o acesso',
    format('+%s dias, até %s', p_dias, to_char(v_ate, 'DD/MM/YYYY')));
end;
$$;

-- Troca o plano do lar.
create or replace function public.master_alterar_plano(p_lar uuid, p_plano text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l public.lares;
  v_ate date;
begin
  perform public._exigir_super();
  if p_plano not in ('teste', 'familia', 'familia_empresa', 'master') then
    raise exception 'Plano inválido.';
  end if;
  select * into l from public.lares where id = p_lar;
  if not found then raise exception 'Lar não encontrado.'; end if;
  if l.plano = p_plano then return; end if;

  v_ate := case
             when p_plano = 'master' then null
             when l.acesso_ate is null then public.hoje_brt() + 30
             else l.acesso_ate
           end;

  update public.lares
  set plano = p_plano,
      acesso_ate = v_ate,
      situacao = case when situacao = 'bloqueado' then 'bloqueado'
                      when p_plano = 'teste' then 'teste' else 'ativo' end
  where id = p_lar;

  perform public._registrar(p_lar, 'Trocou o plano', format('%s → %s', l.plano, p_plano));
end;
$$;

-- Corrige o e-mail de um convite pendente (ex.: digitado errado).
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
  where lar_id = p_lar and aceito_em is null
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

-- Últimas atividades do painel.
create or replace function public.master_atividades(p_limite int default 50)
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public._exigir_super();
  return coalesce((
    select json_agg(a order by a.criado_em desc)
    from (
      select criado_em, autor_email, lar_nome, acao, detalhe
      from public.atividades_master
      order by criado_em desc
      limit least(greatest(coalesce(p_limite, 50), 1), 500)
    ) a
  ), '[]'::json);
end;
$$;

-- ---------------------------------------------------------------------
-- Usada pelo app ao abrir: liga a conta ao lar se existir convite para o e-mail.
-- ---------------------------------------------------------------------
create or replace function public.aceitar_convites()
returns boolean
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.convites;
begin
  if auth.uid() is null or v_email = '' then return false; end if;
  if exists (select 1 from public.membros where user_id = auth.uid()) then return false; end if;

  select * into c from public.convites
  where email = v_email and aceito_em is null
  order by criado_em desc limit 1;
  if not found then return false; end if;

  insert into public.membros (lar_id, user_id, nome, papel) values (c.lar_id, auth.uid(), c.nome, c.papel);
  update public.convites set aceito_em = now(), aceito_por = auth.uid() where id = c.id;

  insert into public.atividades_master (autor_email, lar_id, lar_nome, acao, detalhe)
  values (v_email, c.lar_id, (select nome from public.lares where id = c.lar_id),
          'Aceitou o convite', 'Conta criada e ligada ao lar');
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.master_listar_lares()                       from public, anon;
revoke all on function public.master_criar_lar(text, text, text, text, int) from public, anon;
revoke all on function public.master_bloquear(uuid, text)                 from public, anon;
revoke all on function public.master_liberar(uuid, int)                   from public, anon;
revoke all on function public.master_estender(uuid, int)                  from public, anon;
revoke all on function public.master_alterar_plano(uuid, text)            from public, anon;
revoke all on function public.master_corrigir_convite(uuid, text)         from public, anon;
revoke all on function public.master_atividades(int)                      from public, anon;
revoke all on function public.aceitar_convites()                          from public, anon;

grant execute on function public.master_listar_lares()                       to authenticated;
grant execute on function public.master_criar_lar(text, text, text, text, int) to authenticated;
grant execute on function public.master_bloquear(uuid, text)                 to authenticated;
grant execute on function public.master_liberar(uuid, int)                   to authenticated;
grant execute on function public.master_estender(uuid, int)                  to authenticated;
grant execute on function public.master_alterar_plano(uuid, text)            to authenticated;
grant execute on function public.master_corrigir_convite(uuid, text)         to authenticated;
grant execute on function public.master_atividades(int)                      to authenticated;
grant execute on function public.aceitar_convites()                          to authenticated;

-- Registro inicial
insert into public.atividades_master (autor_email, acao, detalhe)
values ('sistema', 'Painel Master instalado', 'Migration 002 aplicada');

notify pgrst, 'reload schema';
