-- =====================================================================
-- Evvo House Finance — Migration 009 — Reforço de segurança
-- Fecha brechas que só existiam para quem chamasse a API "por fora" do app.
-- Rode UMA vez no SQL Editor, numa query limpa, depois da 008.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Visitante sem login (anon) não acessa NADA do banco.
--    O login usa a API de autenticação, que não depende destas permissões.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- Funções internas não podem ser chamadas pelo app, só pelo próprio banco.
revoke execute on function public._exigir_super()                 from authenticated;
revoke execute on function public._registrar(uuid, text, text)    from authenticated;
revoke execute on function public._calc_dizimo(uuid, date)        from authenticated;
revoke execute on function public._sync_dizimo(uuid, date)        from authenticated;
revoke execute on function public._criar_categorias_padrao(uuid)  from authenticated;

-- ---------------------------------------------------------------------
-- 2. "Quem lançou" não pode ser falsificado.
--    Na criação, criado_por é sempre o usuário logado; depois não muda.
-- ---------------------------------------------------------------------
create or replace function public._autor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.criado_por := auth.uid();
    end if;
  else
    new.criado_por := old.criado_por;
  end if;
  return new;
end;
$$;

create trigger entradas_autor       before insert or update on public.entradas       for each row execute function public._autor();
create trigger despesas_autor       before insert or update on public.despesas       for each row execute function public._autor();
create trigger pagamentos_autor     before insert or update on public.pagamentos     for each row execute function public._autor();
create trigger transferencias_autor before insert or update on public.transferencias for each row execute function public._autor();
create trigger recebimentos_autor   before insert or update on public.recebimentos   for each row execute function public._autor();
create trigger fixas_autor          before insert or update on public.despesas_fixas for each row execute function public._autor();

-- O lar de um registro nunca muda depois de criado.
create or replace function public._lar_fixo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lar_id is distinct from old.lar_id then
    raise exception 'Não é permitido mudar o lar de um registro.';
  end if;
  return new;
end;
$$;

create trigger contas_lar_fixo          before update on public.contas          for each row execute function public._lar_fixo();
create trigger clientes_lar_fixo        before update on public.clientes        for each row execute function public._lar_fixo();
create trigger categorias_lar_fixo      before update on public.categorias      for each row execute function public._lar_fixo();
create trigger entradas_lar_fixo        before update on public.entradas        for each row execute function public._lar_fixo();
create trigger despesas_lar_fixo        before update on public.despesas        for each row execute function public._lar_fixo();
create trigger pagamentos_lar_fixo      before update on public.pagamentos      for each row execute function public._lar_fixo();
create trigger transferencias_lar_fixo  before update on public.transferencias  for each row execute function public._lar_fixo();
create trigger recebimentos_lar_fixo    before update on public.recebimentos    for each row execute function public._lar_fixo();
create trigger fixas_lar_fixo           before update on public.despesas_fixas  for each row execute function public._lar_fixo();

-- ---------------------------------------------------------------------
-- 3. Regras de dinheiro valem mesmo para quem gravar direto na tabela.
-- ---------------------------------------------------------------------

-- Pagamentos nunca passam do valor da conta; parte de cliente nunca passa do saldo dele.
create or replace function public._regras_pagamento()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_valor numeric;
  v_pago numeric;
  v_saldo numeric;
begin
  select valor into v_valor from public.despesas where id = new.despesa_id;
  select coalesce(sum(valor), 0) into v_pago from public.pagamentos
  where despesa_id = new.despesa_id and (tg_op = 'INSERT' or id <> new.id);
  if round(v_pago + new.valor, 2) > round(v_valor, 2) then
    raise exception 'O total pago passaria do valor da conta.';
  end if;

  if new.cliente_id is not null then
    perform pg_advisory_xact_lock(hashtext(new.cliente_id::text));
    v_saldo := public.saldo_cliente(new.cliente_id);
    if tg_op = 'UPDATE' and old.cliente_id = new.cliente_id then
      v_saldo := v_saldo + old.valor;
    end if;
    if round(new.valor, 2) > round(v_saldo, 2) then
      raise exception 'O saldo com o cliente não cobre este pagamento.';
    end if;
  end if;
  return new;
end;
$$;
create trigger pagamentos_regras before insert or update on public.pagamentos
  for each row execute function public._regras_pagamento();

-- Recebimento nunca passa do saldo com o cliente.
create or replace function public._regras_recebimento()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_saldo numeric;
begin
  perform pg_advisory_xact_lock(hashtext(new.cliente_id::text));
  v_saldo := public.saldo_cliente(new.cliente_id);
  if tg_op = 'UPDATE' and old.cliente_id = new.cliente_id then
    v_saldo := v_saldo + old.valor;
  end if;
  if round(new.valor, 2) > round(v_saldo, 2) then
    raise exception 'O saldo com o cliente não cobre este recebimento.';
  end if;
  return new;
end;
$$;
create trigger recebimentos_regras before insert or update on public.recebimentos
  for each row execute function public._regras_recebimento();

-- O valor de uma conta nunca fica menor do que o que já foi pago nela.
create or replace function public._regras_despesa()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_pago numeric;
begin
  if new.valor is distinct from old.valor then
    select coalesce(sum(valor), 0) into v_pago from public.pagamentos where despesa_id = new.id;
    if round(new.valor, 2) < round(v_pago, 2) then
      raise exception 'Já foram pagos R$ % desta conta. Desfaça um pagamento antes de diminuir o valor.',
        to_char(v_pago, 'FM999G999G990D00');
    end if;
  end if;
  return new;
end;
$$;
create trigger despesas_regras before update on public.despesas
  for each row execute function public._regras_despesa();

-- Saída rápida: ao editar, apaga os pagamentos antes de mudar o valor.
create or replace function public.salvar_saida(
  p_id uuid, p_descricao text, p_categoria uuid, p_data date,
  p_competencia date, p_valor numeric, p_pagamentos jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lar uuid := public.meu_lar_id();
  v_id uuid := p_id;
  v_soma numeric;
  v_qtd int;
begin
  if v_lar is null or not public.tem_acesso(v_lar) then raise exception 'Sem acesso a este lar.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if p_data is null then raise exception 'Informe a data.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;

  select count(*), coalesce(sum((x->>'valor')::numeric), 0)
  into v_qtd, v_soma
  from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) x;

  if v_qtd = 0 then raise exception 'Informe de onde saiu o dinheiro.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_pagamentos) x
    where coalesce((x->>'valor')::numeric, 0) <= 0
       or ((x->>'conta_id') is null) = ((x->>'cliente_id') is null)
  ) then
    raise exception 'Cada parte precisa de valor e de uma conta ou um cliente.';
  end if;
  if round(v_soma, 2) <> round(p_valor, 2) then
    raise exception 'A soma das partes (%) precisa ser igual ao valor (%).',
      to_char(v_soma, 'FM999G999G990D00'), to_char(p_valor, 'FM999G999G990D00');
  end if;

  if v_id is null then
    insert into public.despesas (lar_id, descricao, categoria_id, competencia, vencimento, valor, origem)
    values (v_lar, trim(p_descricao), p_categoria, coalesce(p_competencia, p_data), p_data, round(p_valor, 2), 'avulsa')
    returning id into v_id;
  else
    if not exists (select 1 from public.despesas where id = v_id and lar_id = v_lar) then
      raise exception 'Lançamento não encontrado.';
    end if;
    -- Apaga os pagamentos antes de mudar o valor (a regra não deixa o valor ficar abaixo do pago).
    delete from public.pagamentos where despesa_id = v_id;
    update public.despesas
    set descricao = trim(p_descricao), categoria_id = p_categoria,
        competencia = coalesce(p_competencia, p_data), vencimento = p_data, valor = round(p_valor, 2)
    where id = v_id and lar_id = v_lar;
  end if;

  perform public._checar_saldo_clientes(p_pagamentos);

  insert into public.pagamentos (lar_id, despesa_id, data, valor, conta_id, cliente_id)
  select v_lar, v_id, p_data, round((x->>'valor')::numeric, 2), (x->>'conta_id')::uuid, (x->>'cliente_id')::uuid
  from jsonb_array_elements(p_pagamentos) x;

  return v_id;
end;
$$;

-- Funções de gatilho não são chamáveis pela API.
revoke execute on function public._autor()               from public, anon, authenticated;
revoke execute on function public._lar_fixo()            from public, anon, authenticated;
revoke execute on function public._regras_pagamento()    from public, anon, authenticated;
revoke execute on function public._regras_recebimento()  from public, anon, authenticated;
revoke execute on function public._regras_despesa()      from public, anon, authenticated;

notify pgrst, 'reload schema';
