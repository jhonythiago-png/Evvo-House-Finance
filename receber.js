// =====================================================================
// Evvo House Finance — A receber de clientes (Etapa 5)
// Saldo que cada cliente ainda tem seu e recebimento do restante numa conta.
// =====================================================================
import { supabase } from './supabase.js';
import {
  esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco,
  abrirFolha, fecharFolha, mostrarErro, toast
} from './util.js';

export async function renderReceber(ctx) {
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';

  let clientes, contas, recebs;
  try {
    const [r1, r2, r3] = await Promise.all([
      supabase.from('v_saldo_clientes').select('*').eq('lar_id', lar.id).order('nome'),
      supabase.from('v_saldo_contas').select('id, nome, natureza, ativa, data_saldo_inicial').eq('lar_id', lar.id).order('ordem').order('nome'),
      supabase.from('recebimentos')
        .select('id, data, valor, descricao, cliente:clientes!recebimentos_cliente_fkey(nome), conta:contas!recebimentos_conta_fkey(nome)')
        .eq('lar_id', lar.id).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(20)
    ]);
    for (const r of [r1, r2, r3]) if (r.error) throw r.error;
    [clientes, contas, recebs] = [r1.data, r2.data, r3.data];
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const comSaldo = clientes.filter((k) => Number(k.saldo) > 0.005).sort((a, b) => b.saldo - a.saldo);
  const negativos = clientes.filter((k) => Number(k.saldo) < -0.005);
  const total = comSaldo.reduce((s, k) => s + Number(k.saldo), 0);

  const cartaoCliente = (k) => `
    <div class="item item-fixo">
      <span class="item-texto">
        <strong>${esc(k.nome)}</strong>
        <small>Lançado ${esc(fmtMoeda(k.lancado))} · pagou contas ${esc(fmtMoeda(k.usado))} · repassou ${esc(fmtMoeda(k.recebido))}</small>
      </span>
      <div class="conta-direita">
        <span class="item-valor ${Number(k.saldo) < 0 ? 'neg' : ''}">${esc(fmtMoeda(k.saldo))}</span>
        ${Number(k.saldo) > 0.005 ? `<button class="btn btn-mini btn-primario" type="button" data-receber="${esc(k.id)}">Receber</button>` : ''}
      </div>
    </div>`;

  ctx.el.innerHTML = `
    <a class="voltar" href="#/inicio"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Início</a>
    <p class="intro">Renda que você já lançou como "ficou com o cliente" e que ele ainda não repassou nem usou para pagar contas suas.</p>

    <section class="cartao resumo-linha"><span>Total com clientes</span><strong>${esc(fmtMoeda(total))}</strong></section>

    ${comSaldo.length ? `
      <section class="cartao lista"><h2 class="lista-titulo">A receber</h2>${comSaldo.map(cartaoCliente).join('')}</section>` : `
      <section class="cartao vazio"><h2>Nada pendente com clientes</h2><p>Quando você lançar uma entrada como "ficou com o cliente", o valor aparece aqui até ele repassar ou pagar contas suas.</p></section>`}

    ${negativos.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Saldo negativo</h2>
        <p class="lista-vazia">O cliente pagou ou repassou mais do que a renda lançada. Confira se falta lançar alguma entrada dele.</p>
        ${negativos.map(cartaoCliente).join('')}
      </section>` : ''}

    ${recebs.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Últimos recebimentos</h2>
        ${recebs.map((r) => `
          <div class="item item-fixo">
            <span class="item-texto">
              <strong>${esc(r.cliente?.nome)} → ${esc(r.conta?.nome)}</strong>
              <small>${esc(dataBR(r.data))}${r.descricao ? ' · ' + esc(r.descricao) : ''}</small>
            </span>
            <span class="item-valor">${esc(fmtMoeda(r.valor))}</span>
            <button type="button" class="btn-icone" data-apagar="${esc(r.id)}" aria-label="Apagar este recebimento"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>`).join('')}
      </section>` : ''}`;

  ctx.el.querySelectorAll('[data-receber]').forEach((b) => b.addEventListener('click', () =>
    formReceber(ctx, clientes.find((k) => k.id === b.dataset.receber), contas)));

  ctx.el.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Apagar este recebimento? O valor volta para o saldo com o cliente e sai da conta.')) return;
    const { error } = await supabase.from('recebimentos').delete().eq('id', b.dataset.apagar);
    if (error) { toast(erroBanco(error)); return; }
    toast('Recebimento apagado.');
    renderReceber(ctx);
  }));
}

function formReceber(ctx, k, contas) {
  const ativas = contas.filter((c) => c.ativa);
  const pj = ativas.find((c) => c.natureza === 'PJ');
  const folha = abrirFolha(`Receber de ${k.nome}`, `
    <form class="form" novalidate>
      <div class="aviso aviso-ok">Saldo com ${esc(k.nome)}: <strong>${esc(fmtMoeda(k.saldo))}</strong></div>
      <div class="campo"><label for="rValor">Valor recebido (R$)</label><input id="rValor" inputmode="decimal" value="${esc(fmtNumero(k.saldo))}"></div>
      <div class="campo"><label for="rConta">Caiu em qual conta?</label>
        <select id="rConta">${ativas.map((c) => `<option value="${esc(c.id)}" ${pj && c.id === pj.id ? 'selected' : ''}>${esc(c.nome)} (${esc(c.natureza)})</option>`).join('')}</select>
      </div>
      <div class="campo"><label for="rData">Data</label><input id="rData" type="date" value="${esc(hojeISO())}"></div>
      <div class="campo"><label for="rDesc">Descrição (opcional)</label><input id="rDesc" placeholder="Ex.: Pix do restante"></div>
      <small class="ajuda">O dinheiro só muda de lugar: sai do saldo com o cliente e entra na conta. Não conta de novo como renda nem no dízimo.</small>
      <div class="acoes-form"><button class="btn btn-primario" type="submit">Confirmar recebimento</button></div>
    </form>`);
  const form = folha.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = parseMoeda(form.querySelector('#rValor').value);
    const conta = form.querySelector('#rConta').value;
    const data = form.querySelector('#rData').value;
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro(form, 'Informe o valor. Exemplo: 1.234,56');
    if (valor > Number(k.saldo) + 0.005) return mostrarErro(form, `O saldo com ${k.nome} é ${fmtMoeda(k.saldo)}.`);
    if (!conta) return mostrarErro(form, 'Escolha a conta.');
    if (!data) return mostrarErro(form, 'Informe a data.');
    const c = contas.find((x) => x.id === conta);
    if (c && data <= c.data_saldo_inicial && !confirm(`A data ${dataBR(data)} é igual ou anterior ao saldo inicial de ${c.nome}.\n\nO recebimento sai do saldo com o cliente, mas NÃO muda o saldo da conta.\n\nConfirmar mesmo assim?`)) return;
    const { error } = await supabase.rpc('receber_de_cliente', {
      p_cliente: k.id, p_conta: conta, p_data: data, p_valor: valor, p_descricao: form.querySelector('#rDesc').value
    });
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(`Recebido de ${k.nome}.`);
    renderReceber(ctx);
  });
}
