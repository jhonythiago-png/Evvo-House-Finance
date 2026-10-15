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
-- ARQUIVO 1 — PRÉVIA (não grava nada)
-- =====================================================================
with lar as (
  select m.lar_id from public.membros m join auth.users u on u.id = m.user_id
  where u.email = 'jhonythiago@gmail.com' and m.papel = 'dono' limit 1
),
de_para(planilha, app) as (values
    ('Acocimentos', 'Acocimentos'),
    ('Assoline', 'Assoline'),
    ('Belem', 'Belem'),
    ('Cejatel', 'Cejatel'),
    ('Cematel', 'Cematel'),
    ('Engecal', 'Engecal'),
    ('Frete', 'Frete'),
    ('Iran/ CERMATI', 'Iran/ CERMATI'),
    ('Isotec', 'Isotec'),
    ('Lucas', 'Lucas'),
    ('Midi Mesa Propietaria', 'Midi Mesa Propietaria'),
    ('Programas e mentorias', 'Programas e mentorias'),
    ('Sistema Evvo Food', 'Sistema Evvo Food'),
    ('Sistema Evvo Saas', 'Sistema Evvo Saas'),
    ('Zingoti', 'Zingoti')
),
cats(nome, tipo) as (values
    ('Aluguel recebido', 'entrada'),
    ('Cartão de crédito (fatura)', 'saida'),
    ('Contador', 'saida'),
    ('Contas da casa', 'saida'),
    ('Dízimo', 'saida'),
    ('Educação', 'saida'),
    ('Impostos (DAS, INSS)', 'saida'),
    ('Moradia', 'saida'),
    ('Outras despesas', 'saida'),
    ('Outras rendas', 'entrada'),
    ('Pix e dinheiro do dia a dia', 'saida'),
    ('Renda da empresa', 'entrada'),
    ('Saúde', 'saida'),
    ('Sistemas e telefone da empresa', 'saida'),
    ('Tarifas e juros bancários', 'saida'),
    ('Terrenos e Iptu', 'saida')
)
select string_agg(linha, E'\n' order by ordem, linha) from (
  select 1 as ordem, format('CLIENTE   %s → %s', d.planilha,
         coalesce((select c.nome from public.clientes c, lar where c.lar_id = lar.lar_id and lower(trim(c.nome)) = lower(trim(d.app))),
                  'SERÁ CRIADO como "' || d.app || '"')) as linha
  from de_para d
  union all
  select 2, format('CATEGORIA %s (%s) → %s', k.nome, k.tipo,
         case when exists (select 1 from public.categorias c, lar where c.lar_id = lar.lar_id and c.tipo = k.tipo and lower(trim(c.nome)) = lower(trim(k.nome)))
              then 'ok' else 'NÃO ENCONTRADA: vai usar ' || case when k.tipo = 'entrada' then '"Outras rendas"' else '"Outras despesas"' end end)
  from cats k
  union all
  select 3, 'IMPORTAÇÃO ' || case when exists (select 1 from public.contas c, lar where c.lar_id = lar.lar_id and c.nome = 'Histórico da planilha')
                                  then 'JÁ FEITA ANTES (o passo 3 vai recusar)' else 'ainda não feita' end
) x;


