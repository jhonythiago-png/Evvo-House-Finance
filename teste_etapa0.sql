-- =====================================================================
-- Evvo House Finance — Teste da Etapa 0 (não é migration)
-- Cria lares de teste e vincula as contas, já que o Painel Master só chega na Etapa 1.
-- Antes de rodar: crie e confirme as duas contas pelo app.
-- Troque EMAIL_TESTE pelo e-mail da segunda conta de teste.
-- Rode cada bloco separado no SQL Editor.
-- =====================================================================

-- BLOCO 1 — Seu lar (Família Beraldo) ligado ao seu login
with novo as (
  insert into public.lares (nome, plano, situacao)
  values ('Família Beraldo', 'master', 'ativo')
  returning id
)
insert into public.membros (lar_id, user_id, nome, papel)
select novo.id, u.id, 'Jhony Beraldo', 'dono'
from novo, auth.users u
where u.email = 'jhonythiago@gmail.com';

-- BLOCO 2 — Lar de teste para a segunda conta
with novo as (
  insert into public.lares (nome, plano, situacao, acesso_ate)
  values ('Lar Teste', 'teste', 'teste', current_date + 7)
  returning id
)
insert into public.membros (lar_id, user_id, nome, papel)
select novo.id, u.id, 'Teste', 'dono'
from novo, auth.users u
where u.email = 'EMAIL_TESTE';

-- BLOCO 3 — Conferir quem está em qual lar
select string_agg(
         format('%s | %s | %s | %s | acesso até %s',
                l.nome, u.email, m.papel, l.situacao, coalesce(l.acesso_ate::text, 'sem vencimento')),
         E'\n' order by l.nome)
from public.membros m
join public.lares l on l.id = m.lar_id
join auth.users u on u.id = m.user_id;

-- BLOCO 4 — Teste de bloqueio (a conta de teste deve ver "Acesso bloqueado" ao reabrir o app)
update public.lares set situacao = 'bloqueado' where nome = 'Lar Teste';

-- BLOCO 5 — Teste de vencimento (deve continuar bloqueado mesmo com situação "teste")
update public.lares set situacao = 'teste', acesso_ate = current_date - 1 where nome = 'Lar Teste';

-- BLOCO 6 — Liberar de novo
update public.lares set situacao = 'teste', acesso_ate = current_date + 7 where nome = 'Lar Teste';

-- BLOCO 7 — Limpeza ao terminar os testes (apaga só o lar de teste; a conta de login continua existindo)
delete from public.lares where nome = 'Lar Teste';
