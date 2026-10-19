-- =====================================================================
-- Evvo House Finance — Migration 014 — Avisos incluem as contas vencidas
-- Além do que vence hoje e amanhã, a mensagem passa a trazer as contas que
-- já venceram e ainda não foram pagas (dos últimos 60 dias, em meses abertos).
-- Assim o lembrete continua chegando, inclusive em fim de semana, enquanto
-- houver conta atrasada.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 013.
-- =====================================================================

create or replace function public._mensagem_avisos(p_lar uuid, p_dia date, p_periodo text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_vencidas text;
  v_qtd_venc int;
  v_hoje text;
  v_amanha text;
  v_total numeric;
  v_msg text;
begin
  -- Vencidas e não pagas (até 60 dias para trás, só de meses abertos).
  select string_agg(format('• %s — %s (venceu %s%s)', d.descricao, public._brl(d.falta),
                           to_char(d.vencimento, 'DD/MM'),
                           case when d.status = 'parcial' then ', parcial' else '' end),
                    E'\n' order by d.vencimento, d.descricao),
         count(*)
  into v_vencidas, v_qtd_venc
  from public.v_despesas d
  where d.lar_id = p_lar
    and d.status <> 'pago'
    and d.vencimento < p_dia
    and d.vencimento >= p_dia - 60
    and not exists (select 1 from public.meses_fechados f where f.lar_id = d.lar_id and f.competencia = d.competencia);

  select string_agg(format('• %s — %s%s', d.descricao, public._brl(d.falta),
                           case when d.status = 'parcial' then ' (parcial)' else '' end), E'\n' order by d.descricao)
  into v_hoje
  from public.v_despesas d
  where d.lar_id = p_lar and d.vencimento = p_dia and d.status <> 'pago';

  select string_agg(format('• %s — %s%s', d.descricao, public._brl(d.falta),
                           case when d.status = 'parcial' then ' (parcial)' else '' end), E'\n' order by d.descricao)
  into v_amanha
  from public.v_despesas d
  where d.lar_id = p_lar and d.vencimento = p_dia + 1 and d.status <> 'pago';

  if v_vencidas is null and v_hoje is null and v_amanha is null then return null; end if;

  select coalesce(sum(d.falta), 0) into v_total
  from public.v_despesas d
  where d.lar_id = p_lar
    and d.status <> 'pago'
    and (
      d.vencimento in (p_dia, p_dia + 1)
      or (d.vencimento < p_dia and d.vencimento >= p_dia - 60
          and not exists (select 1 from public.meses_fechados f where f.lar_id = d.lar_id and f.competencia = d.competencia))
    );

  v_msg := '🏠 *Evvo House Finance*' || E'\n' ||
           case
             when p_periodo = 'teste' then 'Mensagem de teste'
             when p_periodo = 'manha' then 'Lembrete da manhã'
             when p_periodo = 'tarde' then 'Lembrete da tarde'
             else 'Lembrete das ' || p_periodo
           end;
  if v_vencidas is not null then
    v_msg := v_msg || E'\n\n' || '🔴 *Vencidas e ainda não pagas*' ||
             case when v_qtd_venc > 1 then ' (' || v_qtd_venc || ')' else '' end || ':' || E'\n' || v_vencidas;
  end if;
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
revoke all on function public._mensagem_avisos(uuid, date, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
