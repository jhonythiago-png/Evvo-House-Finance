// =====================================================================
// Evvo House Finance — Contas do mês (Etapa 4)
// Despesas fixas geradas todo mês, contas a pagar (faturas), pagamentos
// em partes, status Pagar / Parcial / Pago e desfazer pagamento.
// =====================================================================
import { supabase } from './supabase.js';
import {
  esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco,
  abrirFolha, fecharFolha, mostrarErro, toast
} from './util.js';
import { GRUPOS } from './cadastros.js';

const est = { mes: hojeISO().slice(0, 7) };

export const TITULOS_CONTAS = { fixas: 'Despesas fixas' };

function proximoMes(ym, n = 1) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nomeMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const ddmm = (iso) => dataBR(iso).slice(0, 5);

const SETA_VOLTAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

async function carregarApoio(lar) {
  const [c1, c2] = await Promise.all([
    supabase.from('categorias').select('id, nome, tipo, grupo, ativa, ordem').eq('lar_id', lar.id).eq('tipo', 'saida').order('ordem').order('nome'),
    supabase.from('v_saldo_contas').select('id, nome, natureza, ativa, data_saldo_inicial').eq('lar_id', lar.id).order('ordem').order('nome')
  ]);
  for (const r of [c1, c2]) if (r.error) throw r.error;
  return { categorias: c1.data, contas: c2.data };
}

function opcoesCategorias(categorias, selecionada) {
  return Object.entries(GRUPOS).filter(([, g]) => g.tipo === 'saida').map(([gid, g]) => {
    const lista = categorias.filter((c) => c.grupo === gid && (c.ativa || c.id === selecionada));
    if (!lista.length) return '';
    return `<optgroup label="${esc(g.nome)}">${lista.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === selecionada ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</optgroup>`;
  }).join('');
}

// ctx = { el, lar, ... }   partes = ['contas', 'm', 'AAAA-MM'] | ['contas', 'fixas']
export async function renderContas(ctx, partes) {
  if (partes[1] === 'fixas') return telaFixas(ctx);
  if (partes[1] === 'm' && /^\d{4}-\d{2}$/.test(partes[2] || '')) est.mes = partes[2];
  return telaMes(ctx);
}

// =====================================================================
// Contas do mês
// =====================================================================
async function telaMes(ctx) {
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';
  const comp = `${est.mes}-01`;

  let apoio, lista;
  try {
    const g = await supabase.rpc('gerar_despesas_mes', { p_mes: comp });
    if (g.error) throw g.error;
    const [a, r] = await Promise.all([
      carregarApoio(lar),
      supabase.from('v_despesas').select('*').eq('lar_id', lar.id).eq('competencia', comp)
        .in('origem', ['fixa', 'conta', 'dizimo']).order('vencimento').order('descricao')
    ]);
    if (r.error) throw r.error;
    apoio = a;
    lista = r.data;
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const total = lista.reduce((s, d) => s + Number(d.valor), 0);
  const pago = lista.reduce((s, d) => s + Number(d.pago), 0);
  const atrasadas = lista.filter((d) => d.atrasada);
  const abertas = lista.filter((d) => d.status !== 'pago');
  const pagas = lista.filter((d) => d.status === 'pago');

  const item = (d) => {
    const venc = d.status === 'pago' ? `Vence ${ddmm(d.vencimento)}`
      : d.atrasada ? `Venceu ${ddmm(d.vencimento)}` : `Vence ${ddmm(d.vencimento)}`;
    const tags = [
      d.origem === 'fixa' ? '<span class="item-tag tag-cinza">Fixa</span>' : '',
      d.variavel ? '<span class="item-tag tag-ambar">Valor variável</span>' : ''
    ].join('');
    const statusTxt = d.status === 'pago' ? 'Pago' : d.status === 'parcial' ? 'Parcial' : 'Pagar';
    return `
      <div class="item conta-item ${d.atrasada ? 'atrasada' : ''}">
        <button class="conta-info" type="button" data-editar="${esc(d.id)}" aria-label="Editar ${esc(d.descricao)}">
          <span class="item-texto">
            <strong>${esc(d.descricao)}</strong>
            <small><span class="${d.atrasada ? 'neg' : ''}">${esc(venc)}</span> · ${esc(d.categoria_nome)}${d.status === 'parcial' ? ` · falta ${esc(fmtMoeda(d.falta))}` : ''}</small>
            ${tags ? `<span class="item-tags">${tags}</span>` : ''}
          </span>
        </button>
        <div class="conta-direita">
          <span class="item-valor">${esc(fmtMoeda(d.valor))}</span>
          <button class="btn btn-mini status-${d.status}" type="button" data-pagar="${esc(d.id)}">${statusTxt}</button>
        </div>
      </div>`;
  };

  ctx.el.innerHTML = `
    <div class="mes-nav">
      <button class="btn-icone" type="button" data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2>${esc(nomeMes(est.mes))}</h2>
      <button class="btn-icone" type="button" data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>

    <section class="resumo-contas">
      <div><span>Total</span><strong>${esc(fmtMoeda(total))}</strong></div>
      <div class="pago"><span>Pago</span><strong>${esc(fmtMoeda(pago))}</strong></div>
      <div class="falta"><span>Falta</span><strong>${esc(fmtMoeda(total - pago))}</strong></div>
    </section>

    ${atrasadas.length ? `
      <div class="aviso aviso-atraso" role="status">
        <strong>${atrasadas.length} ${atrasadas.length === 1 ? 'conta atrasada' : 'contas atrasadas'}</strong>
        somando ${esc(fmtMoeda(atrasadas.reduce((s, d) => s + Number(d.falta), 0)))}.
      </div>` : ''}

    ${abertas.length ? `<section class="cartao lista"><h2 class="lista-titulo">A pagar (${abertas.length})</h2>${abertas.map(item).join('')}</section>` : ''}
    ${pagas.length ? `<section class="cartao lista"><h2 class="lista-titulo">Pagas (${pagas.length})</h2>${pagas.map(item).join('')}</section>` : ''}
    ${lista.length ? '' : `
      <section class="cartao vazio">
        <h2>Nenhuma conta neste mês</h2>
        <p>Cadastre suas despesas fixas (aluguel, Unimed, colégios, IPTU…) e elas aparecem aqui todo mês com o vencimento. Faturas de cartão você lança em "Conta a pagar" quando fecham.</p>
      </section>`}

    <div class="acoes-form">
      <button class="btn btn-primario" type="button" id="btnNovaConta">Conta a pagar</button>
      <a class="btn btn-secundario" href="#/contas/fixas">Despesas fixas</a>
    </div>
    <p class="nota-etapa">Saídas rápidas (Pix e dinheiro do dia a dia) ficam na lista do Início. Pagar com o saldo de um cliente chega na Etapa 5.</p>`;

  ctx.el.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    est.mes = proximoMes(est.mes, Number(b.dataset.mes));
    history.replaceState(null, '', `#/contas/m/${est.mes}`);
    telaMes(ctx);
  }));
  ctx.el.querySelector('#btnNovaConta').addEventListener('click', () => formNovaConta(ctx, apoio));
  ctx.el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    formEditar(ctx, apoio, lista.find((d) => d.id === b.dataset.editar))));
  ctx.el.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', () =>
    formPagar(ctx, apoio, lista.find((d) => d.id === b.dataset.pagar))));
}

// ---------------------------------------------------------------------
// Conta a pagar avulsa (ex.: fatura do cartão)
// ---------------------------------------------------------------------
function formNovaConta(ctx, apoio) {
  const fatura = apoio.categorias.find((c) => c.ativa && /cart[aã]o/i.test(c.nome));
  const folha = abrirFolha('Conta a pagar', `
    <form class="form" novalidate>
      <div class="campo"><label for="nDesc">Descrição</label><input id="nDesc" placeholder="Ex.: Fatura Nubank Poliana"></div>
      <div class="campo"><label for="nCat">Categoria</label><select id="nCat">${opcoesCategorias(apoio.categorias, fatura?.id)}</select></div>
      <div class="campo"><label for="nValor">Valor (R$)</label><input id="nValor" inputmode="decimal" placeholder="0,00"></div>
      <div class="campos-duplos">
        <div class="campo"><label for="nVenc">Vencimento</label><input id="nVenc" type="date" value="${esc(est.mes === hojeISO().slice(0, 7) ? hojeISO() : est.mes + '-10')}"></div>
        <div class="campo"><label for="nMes">Mês da conta</label><input id="nMes" type="month" value="${esc(est.mes)}"></div>
      </div>
      <small class="ajuda">Para fatura de cartão, lance o valor total quando ela fechar. Ela fica aqui até você marcar como paga.</small>
      <div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar</button></div>
    </form>`);
  const form = folha.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const descricao = form.querySelector('#nDesc').value.trim();
    const valor = parseMoeda(form.querySelector('#nValor').value);
    const venc = form.querySelector('#nVenc').value;
    const mes = form.querySelector('#nMes').value || est.mes;
    if (!descricao) return mostrarErro(form, 'Informe a descrição.');
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro(form, 'Informe o valor. Exemplo: 1.234,56');
    if (!venc) return mostrarErro(form, 'Informe o vencimento.');
    const { error } = await supabase.from('despesas').insert({
      lar_id: ctx.lar.id, descricao, categoria_id: form.querySelector('#nCat').value,
      valor, vencimento: venc, competencia: `${mes}-01`, origem: 'conta'
    });
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Conta adicionada.');
    est.mes = mes;
    telaMes(ctx);
  });
}

// ---------------------------------------------------------------------
// Editar a conta do mês
// ---------------------------------------------------------------------
function formEditar(ctx, apoio, d) {
  const ehFixa = !!d.despesa_fixa_id;
  const folha = abrirFolha('Editar conta', `
    <form class="form" novalidate>
      <div class="campo"><label for="eDesc">Descrição</label><input id="eDesc" value="${esc(d.descricao)}"></div>
      <div class="campo"><label for="eCat">Categoria</label><select id="eCat">${opcoesCategorias(apoio.categorias, d.categoria_id)}</select></div>
      <div class="campos-duplos">
        <div class="campo"><label for="eValor">Valor (R$)</label><input id="eValor" inputmode="decimal" value="${esc(fmtNumero(d.valor))}"></div>
        <div class="campo"><label for="eVenc">Vencimento</label><input id="eVenc" type="date" value="${esc(d.vencimento)}"></div>
      </div>
      ${ehFixa ? `
        <fieldset class="seg"><legend>Aplicar a mudança em</legend>
          <div class="seg-opcoes">
            <label><input type="radio" name="escopo" value="mes" checked><span>Só este mês</span></label>
            <label><input type="radio" name="escopo" value="proximos"><span>Este e os próximos</span></label>
          </div>
        </fieldset>
        <small class="ajuda" id="ajudaEscopo">Corrige só a conta deste mês. Ex.: a água veio maior.</small>` : ''}
      ${Number(d.pago) > 0 ? `<small class="ajuda">Já foram pagos ${esc(fmtMoeda(d.pago))} desta conta.</small>` : ''}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        <button class="btn btn-perigo" type="button" id="btnExcluir">${ehFixa ? 'Excluir só deste mês' : 'Excluir'}</button>
      </div>
    </form>`);
  const form = folha.querySelector('form');

  form.querySelectorAll('input[name="escopo"]').forEach((r) => r.addEventListener('change', () => {
    form.querySelector('#ajudaEscopo').textContent = r.value === 'mes'
      ? 'Corrige só a conta deste mês. Ex.: a água veio maior.'
      : 'Muda também o valor e o dia de vencimento dos próximos meses que ainda não foram pagos. Ex.: reajuste do aluguel.';
  }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = parseMoeda(form.querySelector('#eValor').value);
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro(form, 'Informe o valor. Exemplo: 1.234,56');
    const proximos = ehFixa && form.querySelector('input[name="escopo"]:checked').value === 'proximos';
    const { error } = await supabase.rpc('editar_conta', {
      p_id: d.id,
      p_descricao: form.querySelector('#eDesc').value,
      p_categoria: form.querySelector('#eCat').value,
      p_valor: valor,
      p_vencimento: form.querySelector('#eVenc').value,
      p_proximos: proximos
    });
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(proximos ? 'Conta e próximos meses atualizados.' : 'Conta atualizada.');
    telaMes(ctx);
  });

  folha.querySelector('#btnExcluir').addEventListener('click', async () => {
    const aviso = Number(d.pago) > 0 ? '\n\nOs pagamentos dela também serão apagados e os saldos das contas voltam.' : '';
    const texto = ehFixa
      ? `Excluir "${d.descricao}" só deste mês? A despesa fixa continua gerando nos outros meses.${aviso}`
      : `Excluir "${d.descricao}"?${aviso}`;
    if (!confirm(texto)) return;
    const { error } = await supabase.from('despesas').delete().eq('id', d.id);
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Conta excluída.');
    telaMes(ctx);
  });
}

// ---------------------------------------------------------------------
// Pagar (em uma ou várias contas, total ou parcial)
// ---------------------------------------------------------------------
async function formPagar(ctx, apoio, d) {
  const { data: pags, error } = await supabase.from('pagamentos')
    .select('id, data, valor, conta_id, cliente_id').eq('despesa_id', d.id).order('criado_em');
  if (error) { toast(erroBanco(error)); return; }

  const nomeConta = Object.fromEntries(apoio.contas.map((c) => [c.id, c.nome]));
  const ativas = apoio.contas.filter((c) => c.ativa);
  const falta = Math.round((Number(d.valor) - Number(d.pago)) * 100) / 100;
  const linhas = falta > 0 ? [{ conta: '', valor: fmtNumero(falta) }] : [];
  let dataPag = hojeISO();

  const folha = abrirFolha(`Pagar ${d.descricao}`, '<div id="corpoPag"></div>');
  const corpo = folha.querySelector('#corpoPag');

  function desenhar() {
    const novo = linhas.reduce((s, l) => s + (parseMoeda(l.valor) || 0), 0);
    const restante = Math.round((falta - novo) * 100) / 100;
    const opcoes = (sel) => ativas.map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.nome)} (${esc(c.natureza)})</option>`).join('');

    corpo.innerHTML = `
      <form class="form" novalidate>
        <div class="pag-resumo">
          <div><span>Valor da conta</span><strong>${esc(fmtMoeda(d.valor))}</strong></div>
          <div><span>Já pago</span><strong>${esc(fmtMoeda(d.pago))}</strong></div>
          <div><span>Falta</span><strong class="${falta > 0 ? 'neg' : ''}">${esc(fmtMoeda(falta))}</strong></div>
        </div>

        ${pags.length ? `
          <div class="campo">
            <span class="rotulo-campo">Pagamentos feitos</span>
            ${pags.map((p) => `
              <div class="pag-feito">
                <span>${esc(dataBR(p.data))} · ${esc(nomeConta[p.conta_id] || 'Cliente')}</span>
                <strong>${esc(fmtMoeda(p.valor))}</strong>
                <button type="button" class="btn-icone" data-apagar="${esc(p.id)}" aria-label="Apagar este pagamento"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
              </div>`).join('')}
          </div>` : ''}

        ${falta > 0 ? `
          <div class="campo">
            <span class="rotulo-campo">${pags.length ? 'Novo pagamento' : 'Como foi pago?'}</span>
            ${linhas.map((l, i) => `
              <div class="linha-pag" data-linha="${i}">
                <select aria-label="Conta ${i + 1}"><option value="">Escolha a conta</option>${opcoes(l.conta)}</select>
                <input aria-label="Valor ${i + 1}" inputmode="decimal" value="${esc(l.valor)}" placeholder="0,00">
                ${linhas.length > 1 ? `<button type="button" class="btn-icone" data-remover="${i}" aria-label="Remover"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
              </div>`).join('')}
            <button type="button" class="btn-link" id="btnDividir">+ dividir com outra conta</button>
            <small class="ajuda ${Math.abs(restante) < 0.005 ? 'ok' : restante < 0 ? 'neg' : ''}" id="ajudaPag">${
              Math.abs(restante) < 0.005 ? 'Quita a conta.' : restante > 0 ? `Pagamento parcial: depois ainda faltam ${fmtMoeda(restante)}.` : `Passou ${fmtMoeda(-restante)} do que falta.`}</small>
          </div>
          <div class="campo"><label for="pData">Data do pagamento</label><input id="pData" type="date" value="${esc(dataPag)}"></div>
          <button class="btn btn-primario" type="submit">${restante > 0.005 ? 'Registrar pagamento parcial' : 'Registrar pagamento'}</button>
        ` : '<div class="aviso aviso-ok">Esta conta está paga.</div>'}

        ${pags.length ? '<button class="btn btn-perigo" type="button" id="btnDesfazer">Desfazer todos os pagamentos</button>' : ''}
      </form>`;
    ligar();
  }

  function ler() {
    corpo.querySelectorAll('[data-linha]').forEach((row) => {
      const i = Number(row.dataset.linha);
      linhas[i].conta = row.querySelector('select').value;
      linhas[i].valor = row.querySelector('input').value;
    });
    const dt = corpo.querySelector('#pData');
    if (dt) dataPag = dt.value;
  }

  function ligar() {
    const form = corpo.querySelector('form');
    form.addEventListener('change', () => { ler(); });
    form.addEventListener('input', (e) => {
      ler();
      const novo = linhas.reduce((s, l) => s + (parseMoeda(l.valor) || 0), 0);
      const restante = Math.round((falta - novo) * 100) / 100;
      const aj = corpo.querySelector('#ajudaPag');
      if (aj) {
        aj.textContent = Math.abs(restante) < 0.005 ? 'Quita a conta.' : restante > 0 ? `Pagamento parcial: depois ainda faltam ${fmtMoeda(restante)}.` : `Passou ${fmtMoeda(-restante)} do que falta.`;
        aj.className = 'ajuda ' + (Math.abs(restante) < 0.005 ? 'ok' : restante < 0 ? 'neg' : '');
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.textContent = restante > 0.005 ? 'Registrar pagamento parcial' : 'Registrar pagamento';
      if (e.target.id === 'pData') dataPag = e.target.value;
    });

    corpo.querySelector('#btnDividir')?.addEventListener('click', () => {
      ler();
      const usado = linhas.reduce((s, l) => s + (parseMoeda(l.valor) || 0), 0);
      const sobra = Math.max(Math.round((falta - usado) * 100) / 100, 0);
      linhas.push({ conta: '', valor: sobra ? fmtNumero(sobra) : '' });
      desenhar();
    });
    corpo.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
      ler();
      linhas.splice(Number(b.dataset.remover), 1);
      desenhar();
    }));

    corpo.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar este pagamento? O saldo da conta volta.')) return;
      const { error: e } = await supabase.from('pagamentos').delete().eq('id', b.dataset.apagar);
      if (e) return mostrarErro(form, erroBanco(e));
      fecharFolha();
      toast('Pagamento apagado.');
      telaMes(ctx);
    }));

    corpo.querySelector('#btnDesfazer')?.addEventListener('click', async () => {
      if (!confirm(`Desfazer todos os pagamentos de "${d.descricao}"? Ela volta para "a pagar" e os saldos das contas voltam.`)) return;
      const { error: e } = await supabase.rpc('desfazer_pagamentos', { p_despesa: d.id });
      if (e) return mostrarErro(form, erroBanco(e));
      fecharFolha();
      toast('Pagamentos desfeitos.');
      telaMes(ctx);
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ler();
      if (!dataPag) return mostrarErro(form, 'Informe a data do pagamento.');
      if (linhas.some((l) => !l.conta)) return mostrarErro(form, 'Escolha a conta de cada parte.');
      if (new Set(linhas.map((l) => l.conta)).size !== linhas.length) return mostrarErro(form, 'A mesma conta aparece duas vezes. Junte os valores numa linha só.');
      const envio = linhas.map((l) => ({ conta_id: l.conta, valor: parseMoeda(l.valor) }));
      if (envio.some((l) => Number.isNaN(l.valor) || l.valor <= 0)) return mostrarErro(form, 'Informe o valor de cada parte.');
      const soma = Math.round(envio.reduce((s, l) => s + l.valor, 0) * 100) / 100;
      if (soma > falta + 0.005) return mostrarErro(form, `Passou do que falta pagar (${fmtMoeda(falta)}).`);

      const antigas = apoio.contas.filter((c) => envio.some((l) => l.conta_id === c.id) && dataPag <= c.data_saldo_inicial);
      if (antigas.length && !confirm(`A data ${dataBR(dataPag)} é igual ou anterior ao saldo inicial de ${antigas.map((c) => c.nome).join(', ')}.\n\nO pagamento vai ser registrado, mas NÃO vai mudar o saldo dessa conta.\n\nRegistrar mesmo assim?`)) return;

      const { error: e } = await supabase.rpc('registrar_pagamentos', { p_despesa: d.id, p_data: dataPag, p_linhas: envio });
      if (e) return mostrarErro(form, erroBanco(e));
      fecharFolha();
      toast(soma < falta - 0.005 ? 'Pagamento parcial registrado.' : 'Conta paga.');
      telaMes(ctx);
    });
  }

  desenhar();
}

// =====================================================================
// Despesas fixas
// =====================================================================
async function telaFixas(ctx) {
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';
  let apoio, fixas;
  try {
    const [a, r] = await Promise.all([
      carregarApoio(lar),
      supabase.from('despesas_fixas').select('*').eq('lar_id', lar.id).order('dia_vencimento').order('descricao')
    ]);
    if (r.error) throw r.error;
    apoio = a;
    fixas = r.data;
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const nomeCat = Object.fromEntries(apoio.categorias.map((c) => [c.id, c.nome]));
  const ativas = fixas.filter((f) => f.ativa);
  const inativas = fixas.filter((f) => !f.ativa);
  const totalMes = ativas.reduce((s, f) => s + Number(f.valor_padrao), 0);

  const item = (f) => `
    <button class="item ${f.ativa ? '' : 'inativo'}" type="button" data-id="${esc(f.id)}">
      <span class="dia-badge">${f.dia_vencimento}</span>
      <span class="item-texto">
        <strong>${esc(f.descricao)}</strong>
        <small>${esc(nomeCat[f.categoria_id] || '')}${f.variavel ? ' · valor variável' : ''}${f.ativa ? '' : ' · desativada'}</small>
      </span>
      <span class="item-valor">${esc(fmtMoeda(f.valor_padrao))}</span>
    </button>`;

  ctx.el.innerHTML = `
    <a class="voltar" href="#/contas/m/${esc(est.mes)}">${SETA_VOLTAR}Contas do mês</a>
    <p class="intro">Cada despesa fixa gera uma conta por mês, no dia de vencimento. O número à esquerda é o dia.</p>
    ${ativas.length ? `
      <section class="cartao resumo-linha"><span>Total previsto por mês</span><strong>${esc(fmtMoeda(totalMes))}</strong></section>
      <section class="cartao lista"><h2 class="lista-titulo">Ativas (${ativas.length})</h2>${ativas.map(item).join('')}</section>` : `
      <section class="cartao vazio"><h2>Nenhuma despesa fixa ainda</h2><p>Comece pelas que se repetem todo mês: aluguel, Unimed, colégios, internet, telefone, terreno, IPTUs. Água e luz entram como valor variável.</p></section>`}
    ${inativas.length ? `<section class="cartao lista"><h2 class="lista-titulo">Desativadas</h2>${inativas.map(item).join('')}</section>` : ''}
    <button class="btn btn-primario btn-largo" type="button" id="btnNova">Adicionar despesa fixa</button>`;

  ctx.el.querySelector('#btnNova').addEventListener('click', () => formFixa(ctx, apoio, null));
  ctx.el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () =>
    formFixa(ctx, apoio, fixas.find((f) => f.id === b.dataset.id))));
}

function formFixa(ctx, apoio, f) {
  const nova = !f;
  const folha = abrirFolha(nova ? 'Nova despesa fixa' : 'Editar despesa fixa', `
    <form class="form" novalidate>
      <div class="campo"><label for="fDesc">Descrição</label><input id="fDesc" value="${esc(f?.descricao || '')}" placeholder="Ex.: Aluguel Casa Dirce"></div>
      <div class="campo"><label for="fCat">Categoria</label><select id="fCat">${opcoesCategorias(apoio.categorias, f?.categoria_id || apoio.categorias.find((c) => c.grupo === 'despesa_casa' && c.ativa)?.id)}</select></div>
      <div class="campos-duplos">
        <div class="campo"><label for="fValor">Valor por mês (R$)</label><input id="fValor" inputmode="decimal" value="${f ? esc(fmtNumero(f.valor_padrao)) : ''}" placeholder="0,00"></div>
        <div class="campo"><label for="fDia">Dia do vencimento</label><input id="fDia" type="number" inputmode="numeric" min="1" max="31" value="${esc(f?.dia_vencimento || 10)}"></div>
      </div>
      <label class="check"><input type="checkbox" id="fVar" ${f?.variavel ? 'checked' : ''}><span>Valor muda todo mês (água, luz)</span></label>
      ${nova
        ? `<div class="campo"><label for="fInicio">Começar a gerar em</label><input id="fInicio" type="month" value="${esc(est.mes)}"></div>`
        : `<label class="check"><input type="checkbox" id="fAtiva" ${f.ativa ? 'checked' : ''}><span>Ativa (gera a conta todo mês)</span></label>
           <small class="ajuda">Mudanças aqui valem para os meses que ainda vão ser gerados. Para mudar um mês que já aparece em Contas do mês, edite a conta daquele mês e escolha "Este e os próximos".</small>`}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        ${nova ? '' : '<button class="btn btn-perigo" type="button" id="btnExcluir">Excluir</button>'}
      </div>
    </form>`);
  const form = folha.querySelector('form');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const descricao = form.querySelector('#fDesc').value.trim();
    const valor = parseMoeda(form.querySelector('#fValor').value);
    const dia = parseInt(form.querySelector('#fDia').value, 10);
    if (!descricao) return mostrarErro(form, 'Informe a descrição.');
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro(form, 'Informe o valor. Para valor variável, use uma média.');
    if (!(dia >= 1 && dia <= 31)) return mostrarErro(form, 'Dia do vencimento entre 1 e 31.');
    const reg = {
      descricao, categoria_id: form.querySelector('#fCat').value, valor_padrao: valor,
      dia_vencimento: dia, variavel: form.querySelector('#fVar').checked
    };
    let error;
    if (nova) {
      reg.lar_id = ctx.lar.id;
      reg.inicio = `${form.querySelector('#fInicio').value || est.mes}-01`;
      ({ error } = await supabase.from('despesas_fixas').insert(reg));
    } else {
      reg.ativa = form.querySelector('#fAtiva').checked;
      ({ error } = await supabase.from('despesas_fixas').update(reg).eq('id', f.id));
    }
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(nova ? 'Despesa fixa adicionada. Ela já aparece em Contas do mês.' : 'Despesa fixa atualizada.');
    telaFixas(ctx);
  });

  folha.querySelector('#btnExcluir')?.addEventListener('click', async () => {
    if (!confirm(`Excluir a despesa fixa "${f.descricao}"?\n\nAs contas que ela já gerou continuam em Contas do mês (você pode excluí-las lá). Se quiser só parar de gerar, desmarque "Ativa".`)) return;
    const { error } = await supabase.from('despesas_fixas').delete().eq('id', f.id);
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Despesa fixa excluída.');
    telaFixas(ctx);
  });
}
