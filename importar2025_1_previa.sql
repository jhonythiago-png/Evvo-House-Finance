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
),
de_para(planilha, app, criar) as (values
    ('Acocimentos', 'Açocimentos', false),
    ('Assoline', 'Assoline', false),
    ('Belem', 'Belém', false),
    ('Cejatel', 'Cematel', false),
    ('Engecal', 'Engecal', false),
    ('Frete', 'Freteiro (Roberto)', false),
    ('Iran', 'Cermati (Iran)', false),
    ('Iran/ CERMATI', 'Cermati (Iran)', false),
    ('Isotec', 'Isotec', false),
    ('Lucas', 'Lucas', false),
    ('Madeira', 'Madeira', true),
    ('Pedra', 'Pedra / Duralfoil', true),
    ('Pedra / Duralfoil', 'Pedra / Duralfoil', true),
    ('Programas e mentorias', 'Programas e Mentorias', false),
    ('Zingoti', 'Zingoti', false)
),
cats(nome) as (values
    ('Cartão de crédito (fatura)'),
    ('Contador'),
    ('Contas da casa'),
    ('Educação'),
    ('Impostos (DAS, INSS)'),
    ('Moradia'),
    ('Outras despesas'),
    ('Pix e dinheiro do dia a dia'),
    ('Saúde'),
    ('Sistemas e telefone da empresa'),
    ('Tarifas e juros bancários'),
    ('Terrenos e Iptu'),
    ('Veículo e transporte')
)
select string_agg(linha, E'\n' order by ordem, linha) from (
  select 1 as ordem, format('CLIENTE   %s → %s', d.planilha,
         coalesce((select c.nome from public.clientes c, lar where c.lar_id = lar.lar_id and lower(trim(c.nome)) = lower(trim(d.app))),
                  case when d.criar then 'SERÁ CRIADO como "' || d.app || '"' else 'NÃO ENCONTRADO: "' || d.app || '" (a importação vai parar)' end)) as linha
  from de_para d
  union all
  select 2, format('CATEGORIA %s → %s', k.nome,
         case when exists (select 1 from public.categorias c, lar where c.lar_id = lar.lar_id and c.tipo = 'saida' and lower(trim(c.nome)) = lower(trim(k.nome)))
              then 'ok' else 'NÃO ENCONTRADA: vai usar "Outras despesas"' end)
  from cats k
  union all
  select 3, 'CATEGORIA Restituição de imposto (entrada) → ' ||
         case when exists (select 1 from public.categorias c, lar where c.lar_id = lar.lar_id and c.tipo = 'entrada' and lower(trim(c.nome)) = 'restituição de imposto')
              then 'ok' else 'SERÁ CRIADA no grupo Renda Empresa' end
  union all
  select 4, 'IMPORTAÇÃO 2025 ' || case when exists (select 1 from public.entradas e, lar where e.lar_id = lar.lar_id and e.competencia between '2025-01-01' and '2025-12-01')
                                  then 'JÁ FEITA ANTES (o arquivo 2 vai recusar)' else 'ainda não feita' end
) x;
