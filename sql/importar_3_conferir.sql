-- =====================================================================
-- Evvo House Finance — Importação do histórico (Etapa 8)
-- Janeiro a setembro de 2026, das planilhas Fluxo Financeiro.
-- NÃO é migration: é um script de uma vez só, para o lar Família Beraldo.
--
-- Correções já aplicadas em relação às planilhas:
--   * "Saldo mês anterior" e "Ajuste de Caixa" NÃO entram como renda.
--   * Saídas Pix e Dinheiro de agosto (R$ 586,00) entram como saída.
--   * O dízimo de cada mês é calculado pelo app; o valor que você pagou
--     na planilha entra como pagamento. Se foi pago a menos, a diferença aparece.
--
-- Os lançamentos ficam na conta "Histórico da planilha" (desativada), com datas
-- até 30/09/2026: por isso NÃO mexem no saldo atual das suas contas.
-- Entradas sem data na planilha ficam no último dia do mês; saídas, no dia do vencimento.
--
-- São 3 arquivos, cada um rodado sozinho numa query limpa:
--   importar_1_previa.sql     — mostra o que vai acontecer (não grava nada)
--   importar_2_importar.sql   — grava tudo de uma vez (se der erro, nada é gravado)
--   importar_3_conferir.sql   — mostra o resultado mês a mês para comparar com a planilha
-- Se a prévia mostrar um cliente "SERÁ CRIADO" que já existe no app com outro nome,
-- ajuste o nome da direita na lista DE → PARA nos arquivos 1 e 2.
-- =====================================================================


-- =====================================================================
-- ARQUIVO 3 — CONFERÊNCIA DO RESULTADO (compare com a planilha)
-- =====================================================================
with lar as (
  select m.lar_id from public.membros m join auth.users u on u.id = m.user_id
  where u.email = 'jhonythiago@gmail.com' and m.papel = 'dono' limit 1
)
select string_agg(format('%s | entradas %s | saídas %s | dízimo calculado %s | dízimo pago %s%s',
         to_char(d.comp, 'MM/YYYY'),
         to_char(coalesce(e.v, 0), 'FM999G990D00'),
         to_char(coalesce(s.v, 0), 'FM999G990D00'),
         to_char(coalesce(z.valor, 0), 'FM999G990D00'),
         to_char(coalesce(z.pago, 0), 'FM999G990D00'),
         case when coalesce(z.falta, 0) > 0.005 then ' | FALTOU ' || to_char(z.falta, 'FM999G990D00') else '' end),
       E'\n' order by d.comp)
from lar,
     generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month') as d(comp)
left join lateral (select sum(valor) v from public.entradas where lar_id = (select lar_id from lar) and competencia = d.comp) e on true
left join lateral (select sum(valor) v from public.despesas where lar_id = (select lar_id from lar) and competencia = d.comp) s on true
left join lateral (select valor, pago, falta from public.v_despesas where lar_id = (select lar_id from lar) and competencia = d.comp and origem = 'dizimo' limit 1) z on true;
