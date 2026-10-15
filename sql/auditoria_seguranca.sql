-- =====================================================================
-- Evvo House Finance — Auditoria de segurança (só leitura, pode rodar quando quiser)
-- Mostra um relatório em texto. O esperado é tudo "OK".
-- =====================================================================
with
tabelas as (
  select c.oid, c.relname, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
politicas as (
  select tablename, count(*) as qtd from pg_policies where schemaname = 'public' group by tablename
),
funcoes as (
  select p.oid, p.proname, p.prosecdef as definer,
         pg_get_function_identity_arguments(p.oid) as args,
         coalesce(array_to_string(p.proconfig, ','), '') as config,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         t.typname as retorno
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where n.nspname = 'public'
),
views as (
  select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as opcoes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
),
linhas as (
  -- Tabelas sem RLS
  select 1 as ordem, 'ERRO  tabela sem RLS: ' || relname as linha from tabelas where not rls
  union all
  -- Tabelas com RLS mas sem nenhuma política (ninguém acessa: aceitável só se for de propósito)
  select 2, 'AVISO tabela com RLS e sem política: ' || t.relname
  from tabelas t left join politicas p on p.tablename = t.relname
  where t.rls and coalesce(p.qtd, 0) = 0
  union all
  -- Visitante sem login com acesso a tabela ou view
  select 3, 'ERRO  visitante (anon) com acesso a: ' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v')
    and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
  union all
  -- Visitante sem login podendo chamar função
  select 4, 'ERRO  visitante (anon) pode chamar: ' || proname || '(' || args || ')'
  from funcoes where anon_exec and retorno <> 'trigger'
  union all
  -- SECURITY DEFINER sem search_path fixo
  select 5, 'ERRO  função privilegiada sem search_path: ' || proname || '(' || args || ')'
  from funcoes where definer and config not like '%search_path%'
  union all
  -- Views que ignoram a RLS de quem consulta
  select 6, 'ERRO  view sem security_invoker: ' || relname
  from views where opcoes not like '%security_invoker=true%'
)
select coalesce(string_agg(linha, E'\n' order by ordem, linha),
                'OK — todas as tabelas com RLS, nada acessível sem login, funções privilegiadas protegidas e views respeitando a RLS.')
       || E'\n\n' ||
       (select format('Resumo: %s tabelas (%s com RLS) · %s políticas · %s funções (%s privilegiadas) · %s views',
                      count(*), count(*) filter (where rls),
                      (select count(*) from pg_policies where schemaname = 'public'),
                      (select count(*) from funcoes), (select count(*) from funcoes where definer),
                      (select count(*) from views))
        from tabelas)
from linhas;
