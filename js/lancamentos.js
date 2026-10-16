// =====================================================================
// Evvo House Finance — Lançamentos (Etapa 3)
// Início com a lista do mês e o saldo das contas; tela de novo lançamento
// (entrada, saída e transferência) com edição e exclusão.
// =====================================================================
import { supabase } from './supabase.js';
import {
  esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco, mostrarErro, toast,
  opcoesOrigem, origemParaLinha, linhaParaOrigem
} from './util.js';
import { GRUPOS } from './cadastros.js';

// ---------------------------------------------------------------------
// Estado da lista (mantido enquanto o app está aberto)
// ---------------------------------------------------------------------
const lista = {
  mes: hojeISO().slice(0, 7),   // AAAA-MM
  tipo: 'todos',                // todos | e | s | t
  conta: '',
  busca: '',
  escopo: 'ano',                // ano | mes (onde a busca procura)
  ordem: lerOrdem()             // recentes | antigos
};

// A ordem escolhida fica guardada no aparelho.
function lerOrdem() {
  try { return localStorage.getItem('ehf_ordem') === 'antigos' ? 'antigos' : 'recentes'; } catch { return 'recentes'; }
}
function gravarOrdem(v) {
  try { localStorage.setItem('ehf_ordem', v); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

const TIPOS = { e: 'entrada', s: 'saida', t: 'transf' };

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------
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
function diaSemana(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const t = new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------
// Dados de apoio
// ---------------------------------------------------------------------
async function carregarBase(lar) {
  const [c1, c2, c3, c4] = await Promise.all([
    supabase.from('categorias').select('id, nome, tipo, grupo, ativa, ordem').eq('lar_id', lar.id).order('ordem').order('nome'),
    supabase.from('clientes').select('id, nome, ativo').eq('lar_id', lar.id).order('nome'),
    supabase.from('v_saldo_contas').select('*').eq('lar_id', lar.id).order('ordem').order('nome'),
    supabase.from('v_saldo_clientes').select('*').eq('lar_id', lar.id).order('nome')
  ]);
  for (const r of [c1, c2, c3, c4]) if (r.error) throw r.error;
  return { categorias: c1.data, clientes: c2.data, contas: c3.data, saldosClientes: c4.data };
}

const ICONE = {
  e: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  s: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  t: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 7h12l-4-4M17 17H5l4 4"/></svg>',
  a: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h10M4 17h6M18 4v6M15 7h6M14 17h6"/></svg>'
};

// =====================================================================
// INÍCIO — lista do mês
// =====================================================================
// ---------------------------------------------------------------------
// Busca: texto sem acento, destaque do termo e cache curto dos dados
// ---------------------------------------------------------------------
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Destaca o termo no texto (ignora acentos e maiúsculas), já escapando o HTML.
function destacar(texto, termo) {
  const original = Array.from(String(texto ?? ''));
  const alvo = semAcento(termo).trim();
  if (!alvo) return esc(original.join(''));
  const norm = original.map((c) => { const x = semAcento(c); return x.length === 1 ? x : (x[0] || c.toLowerCase()); }).join('');
  let out = '';
  let pos = 0;
  let i = norm.indexOf(alvo);
  while (i !== -1) {
    out += esc(original.slice(pos, i).join('')) + '<mark>' + esc(original.slice(i, i + alvo.length).join('')) + '</mark>';
    pos = i + alvo.length;
    i = norm.indexOf(alvo, pos);
  }
  return out + esc(original.slice(pos).join(''));
}

let cacheBusca = null;   // { chave, itens, quando }
export function limparCacheBusca() { cacheBusca = null; }

// Lê os lançamentos de um período [ini, fim) e devolve os itens no formato da lista.
async function carregarItens(lar, base, ini, fim) {
  const [ent, des, tra, mem, ajs] = await Promise.all([
    supabase.from('entradas')
      .select('*, categoria:categorias!entradas_categoria_fkey(nome, grupo), cliente:clientes!entradas_cliente_fkey(nome), conta:contas!entradas_conta_fkey(nome)')
      .eq('lar_id', lar.id).gte('competencia', ini).lt('competencia', fim),
    supabase.from('despesas')
      .select('*, categoria:categorias!despesas_categoria_fkey(nome, grupo), pagamentos(valor, conta_id, cliente_id)')
      .eq('lar_id', lar.id).gte('competencia', ini).lt('competencia', fim),
    supabase.from('transferencias')
      .select('*, origem:contas!transferencias_origem_fkey(nome), destino:contas!transferencias_destino_fkey(nome)')
      .eq('lar_id', lar.id).gte('data', ini).lt('data', fim),
    supabase.from('membros').select('user_id, nome').eq('lar_id', lar.id),
    supabase.from('ajustes').select('id, data, diferenca, motivo, conta_id, criado_por, criado_em')
      .eq('lar_id', lar.id).gte('data', ini).lt('data', fim)
  ]);
  for (const r of [ent, des, tra, mem, ajs]) if (r.error) throw r.error;

  const nomeConta = Object.fromEntries(base.contas.map((c) => [c.id, c.nome]));
  const nomeCliente = Object.fromEntries(base.clientes.map((c) => [c.id, c.nome]));
  // Lançamento com data igual ou anterior ao saldo inicial da conta não muda o saldo.
  // Só vale para contas ativas: o histórico importado (conta desativada) não precisa do aviso.
  const corte = Object.fromEntries(base.contas.filter((c) => c.ativa).map((c) => [c.id, c.data_saldo_inicial]));
  const foraDoSaldo = (data, ids) => ids.some((id) => id && corte[id] && data <= corte[id]);
  const nomeQuem = Object.fromEntries(mem.data.map((m) => [m.user_id, (m.nome || '').split(' ')[0]]));
  const quem = (id) => (nomeQuem[id] ? ' · ' + nomeQuem[id] : '');

  const itens = [];
  ent.data.forEach((e) => itens.push({
    tipo: 'e', id: e.id, data: e.data, valor: Number(e.valor), contas: [e.conta_id], fora: foraDoSaldo(e.data, [e.conta_id]),
    grupo: e.categoria?.grupo,
    titulo: e.cliente?.nome || e.descricao || e.categoria?.nome,
    sub: [e.categoria?.nome, e.conta ? e.conta.nome : 'Ficou com o cliente', e.cliente && e.descricao ? e.descricao : null].filter(Boolean).join(' · ') + quem(e.criado_por),
    texto: [e.cliente?.nome, e.descricao, e.categoria?.nome, e.conta?.nome].filter(Boolean).join(' '),
    criado: e.criado_em
  }));
  des.data.forEach((d) => {
    const contas = (d.pagamentos || []).filter((p) => p.conta_id).map((p) => p.conta_id);
    const pagoBruto = (d.pagamentos || []).reduce((s, p) => s + Number(p.valor), 0);
    const pago = Math.min(pagoBruto, Number(d.valor));
    const situacao = pago >= Number(d.valor) - 0.005 ? '' : pago > 0 ? 'Parcial' : 'A pagar';
    const nomesPag = [
      ...contas.map((c) => nomeConta[c]),
      ...(d.pagamentos || []).filter((p) => p.cliente_id).map((p) => `saldo ${nomeCliente[p.cliente_id] || 'cliente'}`)
    ];
    itens.push({
      link: d.origem === 'avulsa' ? null : `#/contas/m/${String(d.competencia).slice(0, 7)}`,
      situacao, pago, falta: Number(d.valor) - pago,
      tipo: 's', id: d.id, data: d.vencimento, valor: Number(d.valor), contas, fora: foraDoSaldo(d.vencimento, contas),
      titulo: d.descricao,
      sub: [d.categoria?.nome, nomesPag.join(' + ')].filter(Boolean).join(' · ') + quem(d.criado_por),
      texto: [d.descricao, d.categoria?.nome, ...nomesPag].filter(Boolean).join(' '),
      criado: d.criado_em
    });
  });
  tra.data.forEach((t) => itens.push({
    tipo: 't', id: t.id, data: t.data, valor: Number(t.valor), contas: [t.conta_origem, t.conta_destino], fora: foraDoSaldo(t.data, [t.conta_origem, t.conta_destino]),
    titulo: t.descricao || 'Transferência',
    sub: `${t.origem?.nome} → ${t.destino?.nome}` + quem(t.criado_por),
    texto: [t.descricao, 'Transferência', t.origem?.nome, t.destino?.nome].filter(Boolean).join(' '),
    criado: t.criado_em
  }));
  ajs.data.forEach((a) => itens.push({
    tipo: 'a', id: a.id, data: a.data, valor: Number(a.diferenca), contas: [a.conta_id], link: '#/conferir',
    titulo: 'Ajuste de conferência',
    sub: [nomeConta[a.conta_id], a.motivo].filter(Boolean).join(' · ') + quem(a.criado_por),
    texto: ['Ajuste de conferência', nomeConta[a.conta_id], a.motivo].filter(Boolean).join(' '),
    criado: a.criado_em
  }));
  return itens;
}

const ordenarRecentes = (a, b) => (b.data.localeCompare(a.data)) || (b.criado || '').localeCompare(a.criado || '');

function linhaItem(i, termo = '') {
  return `
    <a class="item lanc lanc-${i.tipo}" href="${i.link ? esc(i.link) : `#/lancar/${i.tipo}/${esc(i.id)}`}">
      <span class="lanc-icone">${ICONE[i.tipo]}</span>
      <span class="item-texto"><strong>${termo ? destacar(i.titulo, termo) : esc(i.titulo)}</strong><small>${esc(i.sub)}</small>${i.situacao ? `<span class="item-tag tag-cinza aviso-saldo">${i.situacao} · ver em Contas</span>` : ''}${i.fora ? '<span class="item-tag tag-ambar aviso-saldo">Antes do saldo inicial: não muda o saldo</span>' : ''}</span>
      <span class="item-valor">${i.tipo === 'e' ? '+ ' : i.tipo === 's' ? '− ' : i.tipo === 'a' ? (i.valor < 0 ? '− ' : '+ ') : ''}${esc(fmtNumero(Math.abs(i.valor)))}</span>
    </a>`;
}

// Cartões por dia.
//   recentes: de hoje para trás; o que tem data depois de hoje (contas a vencer)
//             vem num bloco separado no fim, do mais próximo ao mais distante.
//   antigos:  do primeiro dia para o último.
function cartoesPorDia(lista_, termo = '') {
  const porDia = {};
  lista_.forEach((i) => { (porDia[i.data] = porDia[i.data] || []).push(i); });
  const cartao = (d) => `
    <section class="cartao lista">
      <h3 class="lista-titulo dia">${esc(diaSemana(d))}</h3>
      ${porDia[d].map((i) => linhaItem(i, termo)).join('')}
    </section>`;
  const dias = Object.keys(porDia);
  if (lista.ordem === 'antigos') {
    return dias.sort((a, b) => a.localeCompare(b)).map(cartao).join('');
  }
  const hoje = hojeISO();
  const passados = dias.filter((d) => d <= hoje).sort((a, b) => b.localeCompare(a));
  const futuros = dias.filter((d) => d > hoje).sort((a, b) => a.localeCompare(b));
  return passados.map(cartao).join('') + (futuros.length ? `
    <h3 class="bloco-futuro">Ainda vão acontecer <small>${futuros.length === 1 ? '1 dia' : futuros.length + ' dias'} com lançamentos a partir de amanhã</small></h3>
    ${futuros.map(cartao).join('')}` : '');
}

function htmlOrdem() {
  return `
    <div class="lista-ordem">
      <label for="fOrdem">Ordem</label>
      <select id="fOrdem">
        <option value="recentes" ${lista.ordem === 'recentes' ? 'selected' : ''}>Mais recentes primeiro</option>
        <option value="antigos" ${lista.ordem === 'antigos' ? 'selected' : ''}>Mais antigos primeiro</option>
      </select>
    </div>`;
}

// Filtros (tipo, busca, conta e — durante a busca — Mês | Ano).
function htmlFiltros(base, emBusca) {
  return `
    <section class="filtros">
      <div class="chips" role="group" aria-label="Tipo de lançamento">
        ${[['todos', 'Todos'], ['e', 'Entradas'], ['s', 'Saídas'], ['t', 'Transferências']].map(([v, t]) =>
          `<button type="button" class="chip-filtro" data-tipo="${v}" aria-pressed="${lista.tipo === v}">${t}</button>`).join('')}
      </div>
      <div class="busca-campo ${emBusca ? 'ativa' : ''}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="fBusca" type="search" placeholder="Buscar por nome, categoria, conta ou cliente" value="${esc(lista.busca)}" aria-label="Buscar lançamentos" autocomplete="off">
        ${emBusca ? '<button type="button" class="btn-icone" id="btnLimparBusca" aria-label="Limpar busca"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg></button>' : ''}
      </div>
      <div class="filtros-linha ${emBusca ? 'com-escopo' : 'so-conta'}">
        <select id="fConta" aria-label="Filtrar por conta">
          <option value="">Todas as contas</option>
          ${base.contas.map((c) => `<option value="${esc(c.id)}" ${lista.conta === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select>
        ${emBusca ? `
          <div class="escopo" role="radiogroup" aria-label="Onde buscar">
            <button type="button" role="radio" aria-checked="${lista.escopo === 'mes'}" class="${lista.escopo === 'mes' ? 'ativo' : ''}" data-escopo="mes">Mês</button>
            <button type="button" role="radio" aria-checked="${lista.escopo === 'ano'}" class="${lista.escopo === 'ano' ? 'ativo' : ''}" data-escopo="ano">Ano</button>
          </div>` : ''}
      </div>
    </section>`;
}

function ligarFiltros(ctx, aoMudar) {
  ctx.el.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    lista.tipo = b.dataset.tipo;
    aoMudar();
  }));
  ctx.el.querySelector('#fConta').addEventListener('change', (e) => { lista.conta = e.target.value; aoMudar(); });
  ctx.el.querySelectorAll('[data-escopo]').forEach((b) => b.addEventListener('click', () => {
    if (lista.escopo === b.dataset.escopo) return;
    lista.escopo = b.dataset.escopo;
    renderBusca(ctx);
  }));
  ctx.el.querySelector('#btnLimparBusca')?.addEventListener('click', () => {
    lista.busca = '';
    renderInicio(ctx);
  });
  let espera;
  ctx.el.querySelector('#fBusca').addEventListener('input', (e) => {
    clearTimeout(espera);
    const valor = e.target.value;
    espera = setTimeout(() => {
      const antes = !!lista.busca.trim();
      lista.busca = valor;
      const agora = !!valor.trim();
      if (agora && !antes) lista.escopo = 'ano';   // começou a buscar: padrão é o ano todo
      if (antes && agora) { pintarBusca(ctx); return; }
      (agora ? renderBusca(ctx) : renderInicio(ctx)).then(() => {
        const b = ctx.el.querySelector('#fBusca');
        if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
      });
    }, 250);
  });
}

// =====================================================================
// INÍCIO — lista do mês
// =====================================================================
export async function renderInicio(ctx) {
  if (lista.busca.trim()) return renderBusca(ctx);
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';

  const f = `${lista.mes}-01`;
  const n = `${proximoMes(lista.mes)}-01`;
  let base, itens, diz, apagar, fech;
  try {
    base = await carregarBase(lar);
    [itens, diz, apagar, fech] = await Promise.all([
      carregarItens(lar, base, f, n),
      supabase.rpc('dizimo_mes', { p_mes: f }),
      supabase.from('v_despesas').select('id, descricao, vencimento, valor, falta, status, atrasada, origem')
        .eq('lar_id', lar.id).eq('competencia', f).in('origem', ['fixa', 'conta', 'dizimo']).neq('status', 'pago')
        .order('vencimento'),
      supabase.from('meses_fechados').select('competencia').eq('lar_id', lar.id).eq('competencia', f)
    ]);
    for (const x of [diz, apagar, fech]) if (x.error) throw x.error;
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const mesFechado = fech.data.length > 0;
  const totEnt = itens.filter((i) => i.tipo === 'e').reduce((s, i) => s + i.valor, 0);
  const totSai = itens.filter((i) => i.tipo === 's').reduce((s, i) => s + i.valor, 0);
  const resultado = totEnt - totSai;
  const rendaEmpresa = itens.filter((i) => i.tipo === 'e' && i.grupo === 'renda_empresa').reduce((s, i) => s + i.valor, 0);

  const contasAtivas = base.contas.filter((c) => c.ativa);
  const totalContas = contasAtivas.reduce((s, c) => s + Number(c.saldo_atual), 0);
  const clientesSaldo = base.saldosClientes.filter((k) => Math.abs(Number(k.saldo)) >= 0.005);
  const totalClientes = clientesSaldo.reduce((s, k) => s + Number(k.saldo), 0);
  const dz = diz.data;
  const atrasadas = apagar.data.filter((d) => d.atrasada);

  // filtros (sem busca: ordem padrão da lista do mês)
  const filtrados = itens
    .filter((i) => lista.tipo === 'todos' || i.tipo === lista.tipo)
    .filter((i) => !lista.conta || i.contas.includes(lista.conta))
    .sort(ordenarRecentes);

  ctx.el.innerHTML = `
    <div class="mes-nav">
      <button class="btn-icone" type="button" data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2>${esc(nomeMes(lista.mes))}${mesFechado ? ' <span class="item-tag tag-cinza">Fechado</span>' : ''}</h2>
      <button class="btn-icone" type="button" data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>

    <section class="painel-mes">
      <div class="painel-saldo">
        <span>${totalClientes ? 'Total: contas + dinheiro com clientes' : 'Saldo agora em todas as contas'}</span>
        <strong>${esc(fmtMoeda(totalContas + totalClientes))}</strong>
        ${totalClientes ? `<small>Nas contas ${esc(fmtMoeda(totalContas))} · com clientes ${esc(fmtMoeda(totalClientes))}</small>` : ''}
      </div>
      <div class="painel-grade">
        <div><span>Entradas do mês</span><strong>${esc(fmtMoeda(totEnt))}</strong></div>
        <div><span>Saídas do mês</span><strong>${esc(fmtMoeda(totSai))}</strong></div>
      </div>
      <div class="painel-rodape">
        Resultado do mês: <strong class="${resultado < 0 ? 'neg-claro' : 'pos-claro'}">${resultado < 0 ? '− ' : '+ '}${esc(fmtMoeda(Math.abs(resultado)))}</strong>
        ${rendaEmpresa ? `<span>· Renda Empresa ${esc(fmtMoeda(rendaEmpresa))}</span>` : ''}
      </div>
    </section>

    ${cardDizimo(dz)}
    ${cardAPagar(apagar.data, atrasadas)}
    ${clientesSaldo.length ? `
      <a class="cartao card-link card-clientes" href="#/receber">
        <span class="item-texto">
          <span class="card-rotulo">Dinheiro seu com clientes</span>
          <strong>${esc(fmtMoeda(totalClientes))}</strong>
          <small>${esc(clientesSaldo.map((k) => `${k.nome} ${fmtMoeda(k.saldo)}`).join(' · '))}</small>
        </span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a>` : ''}

    ${contasAtivas.length ? `
      <details class="cartao saldos">
        <summary><span>Saldo de cada conta</span><small>${contasAtivas.length} contas</small></summary>
        ${contasAtivas.map((c) => `
          <div class="saldo-linha">
            <span><span class="item-tag tag-${c.natureza === 'PJ' ? 'azul' : 'verde'}">${esc(c.natureza)}</span> ${esc(c.nome)}</span>
            <strong class="${Number(c.saldo_atual) < 0 ? 'neg' : ''}">${esc(fmtMoeda(c.saldo_atual))}</strong>
          </div>`).join('')}
        <a class="item ver-todas" href="#/conferir">Conferir com o banco</a>
      </details>` : `
      <section class="cartao vazio">
        <h2>Cadastre suas contas primeiro</h2>
        <p>Os saldos são calculados a partir do saldo inicial de cada conta.</p>
        <a class="btn btn-primario" href="#/mais/contas">Ir para Minhas contas</a>
      </section>`}

    ${htmlFiltros(base, false)}
    ${filtrados.length ? htmlOrdem() : ''}

    ${filtrados.length ? cartoesPorDia(filtrados) : `
      <section class="cartao vazio">
        <h2>${itens.length ? 'Nada com esse filtro' : 'Nenhum lançamento neste mês'}</h2>
        <p>${itens.length ? 'Mude o filtro.' : 'Toque no botão + para lançar entradas, saídas e transferências.'}</p>
      </section>`}

    <p class="nota-etapa">Saídas do mês incluem as contas do mês, pagas ou não. O saldo das contas só muda quando a conta é paga.</p>`;

  ctx.el.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    lista.mes = proximoMes(lista.mes, Number(b.dataset.mes));
    renderInicio(ctx);
  }));
  ligarFiltros(ctx, () => renderInicio(ctx));
  ctx.el.querySelector('#fOrdem')?.addEventListener('change', (e) => {
    lista.ordem = e.target.value;
    gravarOrdem(lista.ordem);
    renderInicio(ctx);
  });
}

// =====================================================================
// BUSCA — no ano todo (padrão) ou só no mês aberto
// =====================================================================
async function renderBusca(ctx) {
  const lar = ctx.lar;
  const ano = lista.mes.slice(0, 4);
  const noMes = lista.escopo === 'mes';
  const ini = noMes ? `${lista.mes}-01` : `${ano}-01-01`;
  const fim = noMes ? `${proximoMes(lista.mes)}-01` : `${Number(ano) + 1}-01-01`;
  const chave = `${lar.id}|${ini}|${fim}`;

  let base;
  try {
    base = await carregarBase(lar);
    if (!cacheBusca || cacheBusca.chave !== chave || Date.now() - cacheBusca.quando > 30000) {
      ctx.el.innerHTML = `${htmlFiltros(base, true)}<div class="carregando-bloco">Buscando…</div>`;
      cacheBusca = { chave, itens: await carregarItens(lar, base, ini, fim), quando: Date.now() };
    }
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  ctx.el.innerHTML = `
    ${noMes ? `
      <div class="mes-nav">
        <button class="btn-icone" type="button" data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h2>${esc(nomeMes(lista.mes))}</h2>
        <button class="btn-icone" type="button" data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>` : ''}
    ${htmlFiltros(base, true)}
    <p class="busca-escopo">${noMes ? `Buscando só em ${esc(nomeMes(lista.mes).toLowerCase())}` : `Buscando em todos os meses de ${esc(ano)}`}</p>
    <div id="resBusca"></div>`;

  ctx.el.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    lista.mes = proximoMes(lista.mes, Number(b.dataset.mes));
    renderBusca(ctx);
  }));
  ligarFiltros(ctx, () => pintarBusca(ctx));
  pintarBusca(ctx);
}

// Só redesenha os resultados (mantém o campo de busca com o foco).
function pintarBusca(ctx) {
  const caixa = ctx.el.querySelector('#resBusca');
  if (!caixa || !cacheBusca) return;
  const termo = lista.busca.trim();
  const alvo = semAcento(termo);
  const noMes = lista.escopo === 'mes';
  const periodo = noMes ? nomeMes(lista.mes).toLowerCase() : lista.mes.slice(0, 4);

  const res = cacheBusca.itens
    .filter((i) => lista.tipo === 'todos' || i.tipo === lista.tipo)
    .filter((i) => !lista.conta || i.contas.includes(lista.conta))
    .filter((i) => semAcento(`${i.titulo} ${i.texto}`).includes(alvo))
    .sort(ordenarRecentes);

  const ents = res.filter((i) => i.tipo === 'e');
  const sais = res.filter((i) => i.tipo === 's');
  const totE = ents.reduce((s, i) => s + i.valor, 0);
  const totS = sais.reduce((s, i) => s + i.valor, 0);
  const pago = sais.reduce((s, i) => s + i.pago, 0);
  const falta = sais.reduce((s, i) => s + i.falta, 0);
  const liquido = totE - totS;
  const outros = res.length - ents.length - sais.length;

  if (!res.length) {
    caixa.innerHTML = `
      <section class="cartao vazio">
        <h2>Nada encontrado para “${esc(termo)}”</h2>
        <p>${noMes ? 'Toque em "Ano" para buscar em todos os meses, ou tente outra palavra.' : 'Tente outra palavra, ou confira os filtros de tipo e conta.'}</p>
      </section>`;
    return;
  }

  caixa.innerHTML = `
    <section class="cartao busca-resumo">
      <span class="busca-rotulo">Resultado da busca por “${esc(termo)}”</span>
      <div class="busca-linha">
        <div>
          <strong>${res.length} ${res.length === 1 ? 'lançamento' : 'lançamentos'}</strong>
          <small>em ${esc(periodo)}</small>
        </div>
        <span class="busca-total ${liquido < 0 ? 'txt-saida' : 'txt-entrada'}">${liquido < 0 ? '− ' : '+ '}${esc(fmtMoeda(Math.abs(liquido)))}</span>
      </div>
      ${ents.length && sais.length ? `<p class="busca-mix">Entradas + ${esc(fmtMoeda(totE))} · Saídas − ${esc(fmtMoeda(totS))}</p>` : ''}
      ${sais.length ? `
        <div class="busca-pagos">
          <span>Já pago <strong>${esc(fmtMoeda(pago))}</strong></span>
          <span>Ainda a pagar <strong>${esc(fmtMoeda(falta))}</strong></span>
        </div>` : ''}
      ${outros ? `<p class="busca-mix">Transferências e ajustes aparecem na lista, mas não entram no total.</p>` : ''}
    </section>
    ${htmlOrdem()}
    ${cartoesPorDia(res, termo)}`;
  caixa.querySelector('#fOrdem').addEventListener('change', (e) => {
    lista.ordem = e.target.value;
    gravarOrdem(lista.ordem);
    pintarBusca(ctx);
  });
}

// ---------------------------------------------------------------------
// Cartões do Início
// ---------------------------------------------------------------------
function cardDizimo(dz) {
  if (!dz || !dz.ativo) return '';
  const pct = Number(dz.percentual).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const d = dz.despesa;
  let selo = '<span class="item-tag tag-cinza">Sem dízimo no mês</span>';
  let extra = '';
  if (d) {
    if (d.status === 'pago') selo = '<span class="item-tag tag-verde">Pago</span>';
    else if (d.status === 'parcial') {
      selo = '<span class="item-tag tag-ambar">Diferença a pagar</span>';
      extra = `<p class="dizimo-dif">Já pago ${esc(fmtMoeda(d.pago))}. A base subiu depois do pagamento: falta ${esc(fmtMoeda(d.falta))}.</p>`;
    } else selo = `<span class="item-tag tag-ambar">A pagar até ${esc(dataBR(d.vencimento).slice(0, 5))}</span>`;
    if (Number(d.pago) > Number(dz.valor) + 0.005) {
      extra = `<p class="dizimo-dif">Foi pago ${esc(fmtMoeda(d.pago - dz.valor))} a mais do que o cálculo atual.</p>`;
    }
  }
  return `
    <section class="cartao card-dizimo">
      <div class="lista-cab sem-pad"><h2 class="lista-titulo sem-pad">Dízimo do mês</h2>${selo}</div>
      <div class="dizimo-conta">
        <div><span>Renda Empresa</span><span>${esc(fmtMoeda(dz.renda))}</span></div>
        <div><span>− Despesas da Empresa</span><span>${esc(fmtMoeda(dz.despesas_empresa))}</span></div>
        <div class="base"><span>Base</span><span>${esc(fmtMoeda(dz.base))}</span></div>
      </div>
      <div class="dizimo-valor"><span>${pct}% do mês</span><strong>${esc(fmtMoeda(dz.valor))}</strong></div>
      ${extra}
      ${d && d.status !== 'pago' ? `<a class="btn btn-secundario" href="#/contas/m/${lista.mes}">Pagar em Contas</a>` : ''}
    </section>`;
}

function cardAPagar(abertas, atrasadas) {
  if (!abertas.length) return '';
  const total = abertas.reduce((s, d) => s + Number(d.falta), 0);
  return `
    <section class="cartao lista">
      <div class="lista-cab">
        <h2 class="lista-titulo">A pagar no mês</h2>
        <span class="item-tag ${atrasadas.length ? 'tag-vermelho' : 'tag-cinza'}">${atrasadas.length ? `${atrasadas.length} atrasada${atrasadas.length > 1 ? 's' : ''}` : esc(fmtMoeda(total))}</span>
      </div>
      ${abertas.slice(0, 4).map((d) => `
        <a class="item" href="#/contas/m/${lista.mes}">
          <span class="item-texto">
            <strong>${esc(d.descricao)}</strong>
            <small class="${d.atrasada ? 'neg' : ''}">${d.atrasada ? 'Venceu' : 'Vence'} ${esc(dataBR(d.vencimento).slice(0, 5))}${d.status === 'parcial' ? ' · parcial' : ''}</small>
          </span>
          <span class="item-valor">${esc(fmtMoeda(d.falta))}</span>
        </a>`).join('')}
      ${abertas.length > 4 ? `<a class="item ver-todas" href="#/contas/m/${lista.mes}">Ver todas as ${abertas.length} contas · ${esc(fmtMoeda(total))}</a>` : ''}
    </section>`;
}

// =====================================================================
// NOVO LANÇAMENTO / EDIÇÃO
// =====================================================================
export async function renderLancar(ctx, tipoRota, id) {
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';

  let base, reg = null;
  try {
    base = await carregarBase(lar);
    if (id) {
      const tabela = { e: 'entradas', s: 'despesas', t: 'transferencias' }[tipoRota];
      const sel = tipoRota === 's' ? '*, pagamentos(conta_id, cliente_id, valor)' : '*';
      const { data, error } = await supabase.from(tabela).select(sel).eq('id', id).single();
      if (error) throw error;
      reg = data;
    }
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div><a class="voltar" href="#/inicio">Voltar ao início</a>`;
    return;
  }

  if (!base.contas.length) {
    ctx.el.innerHTML = `
      <section class="cartao vazio">
        <h2>Cadastre suas contas primeiro</h2>
        <p>Todo lançamento entra ou sai de uma conta. Comece cadastrando onde o dinheiro fica.</p>
        <a class="btn btn-primario" href="#/mais/contas">Ir para Minhas contas</a>
      </section>`;
    return;
  }

  const editando = !!reg;
  const hoje = hojeISO();

  // Estado do formulário
  const st = {
    tipo: TIPOS[tipoRota] || 'entrada',
    valor: reg ? fmtNumero(reg.valor) : '',
    data: reg ? (reg.data || reg.vencimento) : hoje,
    comp: reg?.competencia ? reg.competencia.slice(0, 7) : hoje.slice(0, 7),
    compManual: !!reg,
    descricao: reg?.descricao || '',
    categoria: reg?.categoria_id || '',
    cliente: reg?.cliente_id || '',
    onde: reg ? (reg.conta_id || (tipoRota === 'e' ? 'cliente' : '')) : '',
    de: reg?.conta_origem || '',
    para: reg?.conta_destino || '',
    linhas: reg && tipoRota === 's'
      ? reg.pagamentos.map((p) => ({ conta: linhaParaOrigem(p), valor: fmtNumero(p.valor) }))
      : [{ conta: '', valor: '' }],
    linha0Manual: !!(reg && tipoRota === 's' && reg.pagamentos.length > 1)
  };

  const usadas = new Set([st.categoria, st.cliente, st.onde, st.de, st.para, ...st.linhas.map((l) => (l.conta || '').slice(2))]);
  const contasOk = base.contas.filter((c) => c.ativa || usadas.has(c.id));
  const clientesOk = base.clientes.filter((c) => c.ativo || usadas.has(c.id));
  const cats = (tipo) => base.categorias.filter((c) => c.tipo === tipo && (c.ativa || usadas.has(c.id)));

  function opcoesCategorias(tipo) {
    const grupos = Object.entries(GRUPOS).filter(([, g]) => g.tipo === tipo);
    return grupos.map(([gid, g]) => {
      const lista = cats(tipo).filter((c) => c.grupo === gid);
      if (!lista.length) return '';
      return `<optgroup label="${esc(g.nome)}">${lista.map((c) => `<option value="${esc(c.id)}" ${st.categoria === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</optgroup>`;
    }).join('');
  }
  const opcoesContas = (sel) => contasOk.map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.nome)} (${esc(c.natureza)})</option>`).join('');

  function lerCampos() {
    const v = (s) => ctx.el.querySelector(s);
    if (v('#fValor')) st.valor = v('#fValor').value;
    if (v('#fData')) st.data = v('#fData').value;
    if (v('#fComp')) st.comp = v('#fComp').value;
    if (v('#fDescricao')) st.descricao = v('#fDescricao').value;
    if (v('#fCategoria')) st.categoria = v('#fCategoria').value;
    if (v('#fCliente')) st.cliente = v('#fCliente').value;
    if (v('#fOnde')) st.onde = v('#fOnde').value;
    if (v('#fDe')) st.de = v('#fDe').value;
    if (v('#fPara')) st.para = v('#fPara').value;
    ctx.el.querySelectorAll('[data-linha]').forEach((row) => {
      const i = Number(row.dataset.linha);
      st.linhas[i].conta = row.querySelector('select').value;
      st.linhas[i].valor = row.querySelector('input').value;
    });
  }

  function desenhar() {
    // categoria padrão do tipo
    const doTipo = cats(st.tipo === 'entrada' ? 'entrada' : 'saida');
    if (st.tipo !== 'transf' && !doTipo.some((c) => c.id === st.categoria)) {
      const preferida = st.tipo === 'entrada'
        ? doTipo.find((c) => c.grupo === 'renda_empresa') || doTipo[0]
        : doTipo.find((c) => c.grupo === 'despesa_casa') || doTipo[0];
      st.categoria = preferida ? preferida.id : '';
    }

    const titulo = editando
      ? { entrada: 'Editar entrada', saida: 'Editar saída', transf: 'Editar transferência' }[st.tipo]
      : 'Novo lançamento';

    ctx.el.innerHTML = `
      <a class="voltar" href="#/inicio"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Início</a>
      <form class="form form-lanc" id="formLanc" novalidate>
        <h2 class="sr-only">${esc(titulo)}</h2>
        ${editando ? '' : `
          <div class="seg-opcoes seg-3" role="radiogroup" aria-label="Tipo de lançamento">
            ${[['entrada', 'Entrada'], ['saida', 'Saída'], ['transf', 'Transferência']].map(([v, t]) =>
              `<button type="button" role="radio" aria-checked="${st.tipo === v}" class="seg-btn ${st.tipo === v ? 'ativo' : ''}" data-tipo="${v}">${t}</button>`).join('')}
          </div>`}

        <div class="cartao valor-grande tipo-${st.tipo}">
          <label for="fValor">Valor</label>
          <input id="fValor" inputmode="decimal" placeholder="0,00" value="${esc(st.valor)}" autocomplete="off">
        </div>

        <div class="cartao campos">
          ${st.tipo === 'entrada' ? `
            <div class="campo"><label for="fCategoria">Categoria</label><select id="fCategoria">${opcoesCategorias('entrada')}</select></div>
            <div class="campo"><label for="fCliente">Quem pagou?</label>
              <select id="fCliente"><option value="">Sem cliente</option>${clientesOk.map((c) => `<option value="${esc(c.id)}" ${st.cliente === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
            </div>
            <div class="campo"><label for="fOnde">Onde está o dinheiro?</label>
              <select id="fOnde">
                <option value="" ${!st.onde ? 'selected' : ''} disabled>Escolha</option>
                <optgroup label="Já caiu em uma conta">${opcoesContas(st.onde)}</optgroup>
                <optgroup label="Ainda não recebi"><option value="cliente" ${st.onde === 'cliente' ? 'selected' : ''}>Ficou com o cliente (a receber)</option></optgroup>
              </select>
              <small class="ajuda" id="ajudaOnde">${st.onde === 'cliente' ? 'Vira saldo a receber do cliente. Ele pode pagar contas suas com esse saldo e depositar o resto depois.' : ''}</small>
            </div>
            <div class="campo"><label for="fDescricao">Descrição (opcional)</label><input id="fDescricao" value="${esc(st.descricao)}" placeholder="Ex.: NF 1234"></div>
          ` : ''}

          ${st.tipo === 'saida' ? `
            <div class="campo"><label for="fDescricao">Descrição</label><input id="fDescricao" value="${esc(st.descricao)}" placeholder="Ex.: Mercado, Pix presente"></div>
            <div class="campo"><label for="fCategoria">Categoria</label><select id="fCategoria">${opcoesCategorias('saida')}</select></div>
            <div class="campo">
              <span class="rotulo-campo">De onde saiu o dinheiro?</span>
              ${st.linhas.map((l, i) => `
                <div class="linha-pag" data-linha="${i}">
                  <select aria-label="Origem ${i + 1}"><option value="">Escolha</option>${opcoesOrigem(base.contas, base.saldosClientes, l.conta)}</select>
                  <input aria-label="Valor da conta ${i + 1}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}" ${st.linhas.length === 1 ? 'readonly' : ''}>
                  ${st.linhas.length > 1 ? `<button type="button" class="btn-icone" data-remover="${i}" aria-label="Remover esta conta"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
                </div>`).join('')}
              <button type="button" class="btn-link" id="btnDividir">+ dividir com outra conta</button>
              <small class="ajuda" id="ajudaLinhas"></small>
              <small class="ajuda ok" id="ajudaCliente"></small>
            </div>
          ` : ''}

          ${st.tipo === 'transf' ? `
            <div class="campo"><label for="fDe">De</label><select id="fDe"><option value="">Escolha a conta</option>${opcoesContas(st.de)}</select></div>
            <div class="campo"><label for="fPara">Para</label><select id="fPara"><option value="">Escolha a conta</option>${opcoesContas(st.para)}</select></div>
            <div class="campo"><label for="fDescricao">Descrição (opcional)</label><input id="fDescricao" value="${esc(st.descricao)}" placeholder="Ex.: Pro-labore do mês"></div>
            <small class="ajuda">Transferência só muda o dinheiro de lugar: não conta como renda, despesa nem dízimo.</small>
          ` : ''}

          <div class="campos-duplos">
            <div class="campo"><label for="fData">Data</label><input id="fData" type="date" value="${esc(st.data)}"></div>
            ${st.tipo !== 'transf' ? `<div class="campo"><label for="fComp">Mês de referência</label><input id="fComp" type="month" value="${esc(st.comp)}"></div>` : ''}
          </div>
          <small class="ajuda" id="ajudaCorte"></small>
        </div>

        <div class="acoes-form">
          <button class="btn btn-primario" type="submit">Salvar</button>
          ${editando
            ? '<button class="btn btn-perigo" type="button" id="btnExcluir">Excluir</button>'
            : '<button class="btn btn-secundario" type="button" id="btnOutro">Salvar e lançar outro</button>'}
        </div>
      </form>`;

    ligar();
    atualizarAjudas();
  }

  function somaLinhas() {
    return st.linhas.reduce((s, l) => s + (parseMoeda(l.valor) || 0), 0);
  }

  function atualizarAjudas() {
    // Primeira conta se ajusta sozinha: recebe o valor todo (conta única)
    // ou o que sobra depois das outras contas (enquanto você não mexer nela).
    if (st.tipo === 'saida' && (st.linhas.length === 1 || !st.linha0Manual)) {
      const inp = ctx.el.querySelector('[data-linha="0"] input');
      const total = parseMoeda(st.valor);
      const outras = st.linhas.slice(1).reduce((s, l) => s + (parseMoeda(l.valor) || 0), 0);
      const v = Number.isNaN(total) ? NaN : Math.round((total - outras) * 100) / 100;
      st.linhas[0].valor = Number.isNaN(v) || v <= 0 ? '' : fmtNumero(v);
      if (inp && document.activeElement !== inp) inp.value = st.linhas[0].valor;
    }
    const aj = ctx.el.querySelector('#ajudaLinhas');
    if (aj) {
      if (st.linhas.length > 1) {
        const total = parseMoeda(st.valor) || 0;
        const falta = Math.round((total - somaLinhas()) * 100) / 100;
        const vazia = st.linhas.some((l) => !(parseMoeda(l.valor) > 0));
        aj.textContent = vazia ? 'Preencha o valor de cada conta. A primeira se ajusta com o que sobrar.'
          : Math.abs(falta) < 0.005 ? 'A soma das contas fecha com o valor.'
          : falta > 0 ? `Faltam ${fmtMoeda(falta)} para fechar o valor.` : `Passou ${fmtMoeda(-falta)} do valor.`;
        aj.className = 'ajuda ' + (vazia ? '' : Math.abs(falta) < 0.005 ? 'ok' : 'neg');
      } else aj.textContent = '';
    }
    // aviso de data anterior ao saldo inicial
    const ids = st.tipo === 'entrada' ? [st.onde] : st.tipo === 'saida' ? st.linhas.map((l) => (l.conta || '').startsWith('c:') ? l.conta.slice(2) : '') : [st.de, st.para];
    const antigas = base.contas.filter((c) => ids.includes(c.id) && st.data && st.data <= c.data_saldo_inicial);
    const ac = ctx.el.querySelector('#ajudaCorte');
    if (ac) {
      ac.textContent = antigas.length
        ? `A data é igual ou anterior ao saldo inicial de ${antigas.map((c) => c.nome).join(', ')} (${dataBR(antigas[0].data_saldo_inicial)}). O lançamento entra no mês, mas não muda o saldo dessa conta.`
        : '';
    }
    const ak = ctx.el.querySelector('#ajudaCliente');
    if (ak) {
      const cli = st.tipo === 'saida' ? st.linhas.filter((l) => (l.conta || '').startsWith('k:')) : [];
      ak.textContent = cli.length
        ? 'Sai do saldo que o cliente tem com você. Essa renda já foi lançada, então não conta de novo no dízimo nem mexe nos bancos.'
        : '';
    }
    const ao = ctx.el.querySelector('#ajudaOnde');
    if (ao) ao.textContent = st.onde === 'cliente' ? 'Vira saldo a receber do cliente. Ele pode pagar contas suas com esse saldo e depositar o resto depois.' : '';
  }

  function ligar() {
    const form = ctx.el.querySelector('#formLanc');

    ctx.el.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
      lerCampos();
      st.tipo = b.dataset.tipo;
      desenhar();
      ctx.el.querySelector('#fValor').focus();
    }));

    form.addEventListener('input', (e) => {
      lerCampos();
      if (e.target.id === 'fData' && !st.compManual && ctx.el.querySelector('#fComp')) {
        st.comp = st.data.slice(0, 7);
        ctx.el.querySelector('#fComp').value = st.comp;
      }
      if (e.target.id === 'fComp') st.compManual = true;
      const linha = e.target.closest('[data-linha]');
      if (linha && linha.dataset.linha === '0' && e.target.tagName === 'INPUT') st.linha0Manual = true;
      atualizarAjudas();
    });
    form.addEventListener('change', () => { lerCampos(); atualizarAjudas(); });

    ctx.el.querySelector('#btnDividir')?.addEventListener('click', () => {
      lerCampos();
      st.linhas.push({ conta: '', valor: '' });
      desenhar();
      ctx.el.querySelector(`[data-linha="${st.linhas.length - 1}"] select`)?.focus();
    });
    ctx.el.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
      lerCampos();
      const i = Number(b.dataset.remover);
      st.linhas.splice(i, 1);
      if (i === 0) st.linha0Manual = false;
      desenhar();
    }));

    form.addEventListener('submit', (ev) => { ev.preventDefault(); salvar(false); });
    ctx.el.querySelector('#btnOutro')?.addEventListener('click', () => salvar(true));
    ctx.el.querySelector('#btnExcluir')?.addEventListener('click', excluir);
  }

  async function salvar(outro) {
    lerCampos();
    const form = ctx.el.querySelector('#formLanc');
    const valor = parseMoeda(st.valor);
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro(form, 'Informe um valor maior que zero. Exemplo: 1.234,56');
    if (!st.data) return mostrarErro(form, 'Informe a data.');
    const comp = (st.comp || st.data.slice(0, 7)) + '-01';
    let erro = null;

    // Data igual ou anterior ao saldo inicial: pede confirmação para não confundir.
    const idsContas = st.tipo === 'entrada' ? [st.onde] : st.tipo === 'saida' ? st.linhas.map((l) => (l.conta || '').startsWith('c:') ? l.conta.slice(2) : '') : [st.de, st.para];
    const antigas = base.contas.filter((c) => idsContas.includes(c.id) && st.data <= c.data_saldo_inicial);
    if (antigas.length) {
      const nomes = antigas.map((c) => `${c.nome} (saldo inicial em ${dataBR(c.data_saldo_inicial)})`).join(', ');
      const ok = confirm(`A data ${dataBR(st.data)} é igual ou anterior ao saldo inicial de ${nomes}.\n\n` +
        'Este lançamento vai aparecer no mês, mas NÃO vai mudar o saldo dessa conta, porque ele já está dentro do saldo informado.\n\n' +
        'Salvar mesmo assim?');
      if (!ok) return;
    }

    if (st.tipo === 'entrada') {
      if (!st.categoria) return mostrarErro(form, 'Escolha a categoria.');
      if (!st.onde) return mostrarErro(form, 'Escolha onde está o dinheiro.');
      if (st.onde === 'cliente' && !st.cliente) return mostrarErro(form, 'Para "ficou com o cliente", escolha quem pagou.');
      const r = {
        lar_id: lar.id, data: st.data, competencia: comp, valor,
        descricao: st.descricao.trim() || null, categoria_id: st.categoria,
        cliente_id: st.cliente || null, conta_id: st.onde === 'cliente' ? null : st.onde
      };
      ({ error: erro } = editando
        ? await supabase.from('entradas').update(r).eq('id', reg.id)
        : await supabase.from('entradas').insert(r));
    } else if (st.tipo === 'saida') {
      if (!st.categoria) return mostrarErro(form, 'Escolha a categoria.');
      if (st.linhas.some((l) => !l.conta)) return mostrarErro(form, 'Escolha de onde saiu o dinheiro.');
      if (new Set(st.linhas.map((l) => l.conta)).size !== st.linhas.length) return mostrarErro(form, 'A mesma conta ou cliente aparece duas vezes. Junte os valores numa linha só.');
      const linhas = st.linhas.length === 1
        ? [{ ...origemParaLinha(st.linhas[0].conta), valor }]
        : st.linhas.map((l) => ({ ...origemParaLinha(l.conta), valor: parseMoeda(l.valor) }));
      if (linhas.some((l) => Number.isNaN(l.valor) || l.valor <= 0)) return mostrarErro(form, 'Informe o valor de cada conta.');
      const soma = Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100;
      if (Math.abs(soma - valor) >= 0.005) return mostrarErro(form, `A soma das contas (${fmtMoeda(soma)}) precisa ser igual ao valor (${fmtMoeda(valor)}).`);
      const nomeCat = base.categorias.find((c) => c.id === st.categoria)?.nome || 'Saída';
      ({ error: erro } = await supabase.rpc('salvar_saida', {
        p_id: editando ? reg.id : null,
        p_descricao: st.descricao.trim() || nomeCat,
        p_categoria: st.categoria, p_data: st.data, p_competencia: comp,
        p_valor: valor, p_pagamentos: linhas
      }));
    } else {
      if (!st.de || !st.para) return mostrarErro(form, 'Escolha as duas contas.');
      if (st.de === st.para) return mostrarErro(form, 'As contas de origem e destino precisam ser diferentes.');
      const r = { lar_id: lar.id, data: st.data, valor, conta_origem: st.de, conta_destino: st.para, descricao: st.descricao.trim() || null };
      ({ error: erro } = editando
        ? await supabase.from('transferencias').update(r).eq('id', reg.id)
        : await supabase.from('transferencias').insert(r));
    }

    if (erro) return mostrarErro(form, erroBanco(erro));
    limparCacheBusca();

    lista.mes = st.tipo === 'transf' ? st.data.slice(0, 7) : comp.slice(0, 7);
    if (outro) {
      toast('Lançamento salvo.');
      st.valor = '';
      st.descricao = '';
      st.linhas = [{ conta: st.tipo === 'saida' ? st.linhas[0].conta : '', valor: '' }];
      desenhar();
      ctx.el.querySelector('#fValor').focus();
      return;
    }
    toast(editando ? 'Lançamento atualizado.' : 'Lançamento salvo.');
    window.location.hash = '#/inicio';
  }

  async function excluir() {
    if (!confirm('Excluir este lançamento?')) return;
    const tabela = { entrada: 'entradas', saida: 'despesas', transf: 'transferencias' }[st.tipo];
    const { error } = await supabase.from(tabela).delete().eq('id', reg.id);
    if (error) return mostrarErro(ctx.el.querySelector('#formLanc'), erroBanco(error));
    limparCacheBusca();
    toast('Lançamento excluído.');
    window.location.hash = '#/inicio';
  }

  desenhar();
  if (!editando) ctx.el.querySelector('#fValor').focus();
}
