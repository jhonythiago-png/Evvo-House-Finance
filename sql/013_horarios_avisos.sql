-- =====================================================================
-- Evvo House Finance — Migration 013 — Horários dos avisos configuráveis
-- Cada lar escolhe de 1 a 3 horários (de 15 em 15 minutos) para receber os
-- lembretes no WhatsApp. Padrão: 10:00 e 16:00.
-- O agendador passa a rodar a cada 15 minutos e envia para quem marcou aquele horário.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 012.
-- =====================================================================

create table public.avisos_config (
  lar_id     uuid primary key references public.lares(id) on delete cascade,
  horarios   text[] not null default array['10:00', '16:00'],
  atualizado_em timestamptz not null default now(),
  check (cardinality(horarios) between 1 and 3)
);

alter table public.avisos_config enable row level security;
create policy avisos_config_select on public.avisos_config
  for select to authenticated using (lar_id = (select public.meu_lar_com_acesso()));
revoke all on public.avisos_config from anon, authenticated;
grant select on public.avisos_config to authenticated;

-- O registro de envio passa a guardar o horário ("10:00") em vez de manhã/tarde.
alter table public.avisos_log drop constraint if exists avisos_log_periodo_check;
alter table public.avisos_log add constraint avisos_log_periodo_check
  check (periodo in ('manha', 'tarde', 'teste') or periodo ~ '^[0-2][0-9]:[0-5][0-9]$');

-- Horários do lar (ou o padrão, se nunca configurou).
create or replace function public._horarios_lar(p_lar uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((select horarios from public.avisos_config where lar_id = p_lar), array['10:00', '16:00']);
$$;
revoke all on function public._horarios_lar(uuid) from public, anon, authenticated;

-- Mensagem: o título mostra o horário do lembrete.
create or replace function public._mensagem_avisos(p_lar uuid, p_dia date, p_periodo text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_hoje text;
  v_amanha text;
  v_total numeric;
  v_msg text;
begin
  select string_agg(format('• %s — %s%s', d.descricao, public._brl(d.falta),
                           case when d.status = 'parcial' then ' (parcial)' else '' end), E'\n' order by d.descricao),
         sum(d.falta)
  into v_hoje, v_total
  from public.v_despesas d
  where d.lar_id = p_lar and d.vencimento = p_dia and d.status <> 'pago';

  select string_agg(format('• %s — %s%s', d.descricao, public._brl(d.falta),
                           case when d.status = 'parcial' then ' (parcial)' else '' end), E'\n' order by d.descricao)
  into v_amanha
  from public.v_despesas d
  where d.lar_id = p_lar and d.vencimento = p_dia + 1 and d.status <> 'pago';

  if v_hoje is null and v_amanha is null then return null; end if;

  select coalesce(v_total, 0) + coalesce(sum(d.falta), 0) into v_total
  from public.v_despesas d
  where d.lar_id = p_lar and d.vencimento = p_dia + 1 and d.status <> 'pago';

  v_msg := '🏠 *Evvo House Finance*' || E'\n' ||
           case
             when p_periodo = 'teste' then 'Mensagem de teste'
             when p_periodo = 'manha' then 'Lembrete da manhã'
             when p_periodo = 'tarde' then 'Lembrete da tarde'
             else 'Lembrete das ' || p_periodo
           end;
  if v_hoje is not null then
    v_msg := v_msg || E'\n\n' || '⚠️ *Vencem HOJE* (' || to_char(p_dia, 'DD/MM') || '):' || E'\n' || v_hoje;
  end if;
  if v_amanha is not null then
    v_msg := v_msg || E'\n\n' || '📅 *Vencem AMANHÃ* (' || to_char(p_dia + 1, 'DD/MM') || '):' || E'\n' || v_amanha;
  end if;
  v_msg := v_msg || E'\n\n' || 'Total: *' || public._brl(v_total) || '*' || E'\n' ||
           'Depois de pagar, marque como pago no app para os lembretes pararem.';
  return v_msg;
end;
$$;

-- Chamada pelo agendador a cada 15 minutos.
create or replace function public.enviar_avisos_agendados()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_dia date := v_agora::date;
  -- Arredonda para baixo no quarto de hora (ex.: 10:07 → 10:00).
  v_hora text := to_char(date_trunc('hour', v_agora) + (floor(extract(minute from v_agora) / 15) * interval '15 minutes'), 'HH24:MI');
  r record;
  v_msg text;
  v_log bigint;
  v_qtd int := 0;
begin
  for r in
    select d.*
    from public.avisos_destinatarios d
    join public.lares l on l.id = d.lar_id
    where d.ativo
      and l.situacao <> 'bloqueado'
      and (l.acesso_ate is null or l.acesso_ate >= v_dia)
      and v_hora = any(public._horarios_lar(d.lar_id))
  loop
    v_msg := public._mensagem_avisos(r.lar_id, v_dia, v_hora);
    continue when v_msg is null;

    v_log := null;
    insert into public.avisos_log (lar_id, destinatario_id, dia, periodo, mensagem)
    values (r.lar_id, r.id, v_dia, v_hora, v_msg)
    on conflict do nothing
    returning id into v_log;
    continue when v_log is null;

    update public.avisos_log set request_id = public._enviar_whatsapp(r.telefone, r.apikey, v_msg) where id = v_log;
    v_qtd := v_qtd + 1;
    perform pg_sleep(2);
  end loop;
  return v_qtd;
end;
$$;
revoke all on function public.enviar_avisos_agendados() from public, anon, authenticated;

-- Horários do meu lar (para o app).
create or replace function public.horarios_avisos()
returns text[]
language plpgsql stable security definer
set search_path = public
as $$
declare v_lar uuid := public.meu_lar_id();
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  return public._horarios_lar(v_lar);
end;
$$;

-- O dono salva de 1 a 3 horários, de 15 em 15 minutos.
create or replace function public.salvar_horarios_avisos(p_horarios text[])
returns text[]
language plpgsql security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_lista text[];
  h text;
begin
  if v_lar is null or not public.eh_dono(v_lar) then
    raise exception 'Só o dono do lar configura os avisos.' using errcode = '42501';
  end if;
  select array_agg(distinct x order by x) into v_lista
  from unnest(coalesce(p_horarios, '{}')) x where coalesce(trim(x), '') <> '';
  if v_lista is null or cardinality(v_lista) = 0 then raise exception 'Escolha pelo menos um horário.'; end if;
  if cardinality(v_lista) > 3 then raise exception 'No máximo 3 horários por dia.'; end if;
  foreach h in array v_lista loop
    if h !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$' then
      raise exception 'Horário inválido: %. Use de 15 em 15 minutos, como 10:00 ou 16:30.', h;
    end if;
  end loop;

  insert into public.avisos_config (lar_id, horarios, atualizado_em)
  values (v_lar, v_lista, now())
  on conflict (lar_id) do update set horarios = excluded.horarios, atualizado_em = now();
  return v_lista;
end;
$$;

-- Prévia: usa o próximo horário configurado no título.
create or replace function public.previa_aviso_whatsapp()
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_agora text := to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI');
  v_prox text;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  select coalesce(min(h) filter (where h >= v_agora), min(h)) into v_prox
  from unnest(public._horarios_lar(v_lar)) h;
  return public._mensagem_avisos(v_lar, public.hoje_brt(), coalesce(v_prox, '10:00'));
end;
$$;

revoke all on function public.horarios_avisos()               from public, anon;
revoke all on function public.salvar_horarios_avisos(text[])  from public, anon;
grant execute on function public.horarios_avisos()              to authenticated;
grant execute on function public.salvar_horarios_avisos(text[]) to authenticated;

-- Troca os dois agendamentos fixos por um a cada 15 minutos.
select cron.unschedule(jobname) from cron.job where jobname in ('evvo-house-avisos-manha', 'evvo-house-avisos-tarde');
select cron.schedule('evvo-house-avisos', '*/15 * * * *', $$select public.enviar_avisos_agendados()$$);
drop function if exists public.enviar_avisos_vencimento(text);

notify pgrst, 'reload schema';
