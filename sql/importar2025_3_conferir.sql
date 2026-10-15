-- =====================================================================
-- Evvo House Finance — Importação do histórico de 2025
-- Janeiro a dezembro de 2025, das planilhas Fluxo Financeiro.
-- NÃO é migration: script de uma vez só, para o lar Família Beraldo.
--
-- Correções e decisões aplicadas:
--   * "Saldo mês anterior" e "Ajuste de Caixa" NÃO entram como renda.
--   * Janeiro e fevereiro (modelo antigo): a aba DINHEIRO entra como Pix e dinheiro
--     (inclui os repasses "pagamento isotec" e "Belem mês restante"); "academia Duda"
--     digitada como texto (90 ,00) passa a ser somada.
--   * "Dinheiro sumiu / Ajuste de caixa" (R$ 613,46) entra só em janeiro.
--   * "Imposto de Renda Restituição 2025" entra na categoria "Restituição de imposto",
--     do grupo Renda Empresa (entra na base do dízimo). A categoria é criada se não existir.
--   * Clientes vão para os seus cadastros; só "Madeira" e "Pedra / Duralfoil" são criados.
--   * O dízimo de cada mês fica igual ao valor pago na planilha, como Pago.
--   * Lançamentos na conta "Histórico da planilha": NÃO mexem nos saldos atuais.
--   * Os 12 meses de 2025 ficam fechados.
--
-- São 3 arquivos, cada um rodado sozinho numa query limpa:
--   importar2025_1_previa.sql    — mostra o que vai acontecer (não grava nada)
--   importar2025_2_importar.sql  — grava tudo de uma vez (se der erro, nada é gravado)
--   importar2025_3_conferir.sql  — resultado mês a mês
-- =====================================================================

with lar as (
  select m.lar_id from public.membros m join auth.users u on u.id = m.user_id
  where u.email = 'jhonythiago@gmail.com' and m.papel = 'dono' limit 1
)
select string_agg(format('%s | entradas %s | saídas %s | resultado %s | dízimo %s (%s)%s',
         to_char(d.comp, 'MM/YYYY'),
         to_char(coalesce(e.v, 0), 'FM999G990D00'),
         to_char(coalesce(s.v, 0), 'FM999G990D00'),
         to_char(coalesce(e.v, 0) - coalesce(s.v, 0), 'FM999G990D00'),
         to_char(coalesce(z.valor, 0), 'FM999G990D00'),
         coalesce(z.status, '-'),
         case when f.competencia is not null then ' | fechado' else '' end),
       E'\n' order by d.comp)
from lar,
     generate_series('2025-01-01'::date, '2025-12-01'::date, interval '1 month') as d(comp)
left join lateral (select sum(valor) v from public.entradas where lar_id = (select lar_id from lar) and competencia = d.comp) e on true
left join lateral (select sum(valor) v from public.despesas where lar_id = (select lar_id from lar) and competencia = d.comp) s on true
left join lateral (select valor, status from public.v_despesas where lar_id = (select lar_id from lar) and competencia = d.comp and origem = 'dizimo' limit 1) z on true
left join public.meses_fechados f on f.lar_id = (select lar_id from lar) and f.competencia = d.comp;
