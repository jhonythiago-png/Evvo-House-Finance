// =====================================================================
// Evvo House Finance — Lançamentos (Etapa 3)
// Início com a lista do mês e o saldo das contas; tela de novo lançamento
// (entrada, saída e transferência) com edição e exclusão.
// =====================================================================
import { supabase } from './supabase.js';
import { esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco, mostrarErro, toast } from './util.js';
import { GRUPOS } from './cadastros.js';

// ---------------------------------------------------------------------
// Estado da lista (mantido enquanto o app está aberto)
// ---------------------------------------------------------------------
const lista = {
  mes: hojeISO().slice(0, 7),   // AAAA-MM
  tipo: 'todos',                // todos | e | s | t
  conta: '',
  busca: ''
};

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
  const [c1, c2, c3] = await Promise.all([
    supabase.from('categorias').select('id, nome, tipo, grupo, ativa, ordem').eq('lar_id', lar.id).order('ordem').order('nome'),
    supabase.from('clientes').select('id, nome, ativo').eq('lar_id', lar.id).order('nome'),
    supabase.from('v_saldo_contas').select('*').eq('lar_id', lar.id).order('ordem').order('nome')
  ]);
  for (const r of [c1, c2, c3]) if (r.error) throw r.error;
  return { categorias: c1.data, clientes: c2.data, contas: c3.data };
}

const ICONE = {
  e: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  s: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  t: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 7h12l-4-4M17 17H5l4 4"/></svg>'
};

// =====================================================================
// INÍCIO — lista do mês
// =====================================================================
export async function renderInicio(ctx) {
  const lar = ctx.lar;
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';

  const f = `${lista.mes}-01`;
  const n = `${proximoMes(lista.mes)}-01`;
  let base, ent, des, tra, mem;
  try {
    [base, ent, des, tra, mem] = await Promise.all([
      carregarBase(lar),
      supabase.from('entradas')
        .select('*, categoria:categorias!entradas_categoria_fkey(nome, grupo), cliente:clientes!entradas_cliente_fkey(nome), conta:contas!entradas_conta_fkey(nome)')
        .eq('lar_id', lar.id).eq('competencia', f),
      supabase.from('despesas')
        .select('*, categoria:categorias!despesas_categoria_fkey(nome, grupo), pagamentos(valor, conta_id, cliente_id)')
        .eq('lar_id', lar.id).eq('competencia', f),
      supabase.from('transferencias')
        .select('*, origem:contas!transferencias_origem_fkey(nome), destino:contas!transferencias_destino_fkey(nome)')
        .eq('lar_id', lar.id).gte('data', f).lt('data', n),
      supabase.from('membros').select('user_id, nome').eq('lar_id', lar.id)
    ]);
    for (const r of [ent, des, tra, mem]) if (r.error) throw r.error;
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const nomeConta = Object.fromEntries(base.contas.map((c) => [c.id, c.nome]));
  const nomeQuem = Object.fromEntries(mem.data.map((m) => [m.user_id, (m.nome || '').split(' ')[0]]));
  const quem = (id) => (nomeQuem[id] ? ' · ' + nomeQuem[id] : '');

  const itens = [];
  ent.data.forEach((e) => itens.push({
    tipo: 'e', id: e.id, data: e.data, valor: Number(e.valor), contas: [e.conta_id],
    titulo: e.cliente?.nome || e.descricao || e.categoria?.nome,
    sub: [e.categoria?.nome, e.conta ? e.conta.nome : 'Ficou com o cliente', e.cliente && e.descricao ? e.descricao : null].filter(Boolean).join(' · ') + quem(e.criado_por),
    criado: e.criado_em
  }));
  des.data.forEach((d) => {
    const contas = (d.pagamentos || []).filter((p) => p.conta_id).map((p) => p.conta_id);
    itens.push({
      tipo: 's', id: d.id, data: d.vencimento, valor: Number(d.valor), contas,
      titulo: d.descricao,
      sub: [d.categoria?.nome, contas.map((c) => nomeConta[c]).join(' + ')].filter(Boolean).join(' · ') + quem(d.criado_por),
      criado: d.criado_em
    });
  });
  tra.data.forEach((t) => itens.push({
    tipo: 't', id: t.id, data: t.data, valor: Number(t.valor), contas: [t.conta_origem, t.conta_destino],
    titulo: t.descricao || 'Transferência',
    sub: `${t.origem?.nome} → ${t.destino?.nome}` + quem(t.criado_por),
    criado: t.criado_em
  }));

  const totEnt = ent.data.reduce((s, e) => s + Number(e.valor), 0);
  const totSai = des.data.reduce((s, d) => s + Number(d.valor), 0);
  const resultado = totEnt - totSai;
  const rendaEmpresa = ent.data.filter((e) => e.categoria?.grupo === 'renda_empresa').reduce((s, e) => s + Number(e.valor), 0);

  const contasAtivas = base.contas.filter((c) => c.ativa);
  const totalContas = contasAtivas.reduce((s, c) => s + Number(c.saldo_atual), 0);

  // filtros
  const busca = lista.busca.trim().toLowerCase();
  const filtrados = itens
    .filter((i) => lista.tipo === 'todos' || i.tipo === lista.tipo)
    .filter((i) => !lista.conta || i.contas.includes(lista.conta))
    .filter((i) => !busca || `${i.titulo} ${i.sub}`.toLowerCase().includes(busca))
    .sort((a, b) => (b.data.localeCompare(a.data)) || (b.criado || '').localeCompare(a.criado || ''));

  const porDia = {};
  filtrados.forEach((i) => { (porDia[i.data] = porDia[i.data] || []).push(i); });

  const linhaItem = (i) => `
    <a class="item lanc lanc-${i.tipo}" href="#/lancar/${i.tipo}/${esc(i.id)}">
      <span class="lanc-icone">${ICONE[i.tipo]}</span>
      <span class="item-texto"><strong>${esc(i.titulo)}</strong><small>${esc(i.sub)}</small></span>
      <span class="item-valor">${i.tipo === 'e' ? '+ ' : i.tipo === 's' ? '− ' : ''}${esc(fmtNumero(i.valor))}</span>
    </a>`;

  ctx.el.innerHTML = `
    <div class="mes-nav">
      <button class="btn-icone" type="button" data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2>${esc(nomeMes(lista.mes))}</h2>
      <button class="btn-icone" type="button" data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>

    <section class="painel-mes">
      <div class="painel-saldo">
        <span>Saldo agora em todas as contas</span>
        <strong>${esc(fmtMoeda(totalContas))}</strong>
      </div>
      <div class="painel-grade">
        <div><span>Entradas do mês</span><strong>${esc(fmtMoeda(totEnt))}</strong></div>
        <div><span>Saídas do mês</span><strong>${esc(fmtMoeda(totSai))}</strong></div>
      </div>
      <div class="painel-rodape">
        Resultado do mês: <strong class="${resultado < 0 ? 'neg-claro' : 'pos-claro'}">${resultado < 0 ? '− ' : '+ '}${esc(fmtMoeda(Math.abs(resultado)).replace('R$ ', 'R$ '))}</strong>
        ${rendaEmpresa ? `<span>· Renda Empresa ${esc(fmtMoeda(rendaEmpresa))}</span>` : ''}
      </div>
    </section>

    ${contasAtivas.length ? `
      <details class="cartao saldos">
        <summary><span>Saldo de cada conta</span><small>${contasAtivas.length} contas</small></summary>
        ${contasAtivas.map((c) => `
          <div class="saldo-linha">
            <span><span class="item-tag tag-${c.natureza === 'PJ' ? 'azul' : 'verde'}">${esc(c.natureza)}</span> ${esc(c.nome)}</span>
            <strong class="${Number(c.saldo_atual) < 0 ? 'neg' : ''}">${esc(fmtMoeda(c.saldo_atual))}</strong>
          </div>`).join('')}
      </details>` : `
      <section class="cartao vazio">
        <h2>Cadastre suas contas primeiro</h2>
        <p>Os saldos são calculados a partir do saldo inicial de cada conta.</p>
        <a class="btn btn-primario" href="#/mais/contas">Ir para Minhas contas</a>
      </section>`}

    <section class="filtros">
      <div class="chips" role="group" aria-label="Tipo de lançamento">
        ${[['todos', 'Todos'], ['e', 'Entradas'], ['s', 'Saídas'], ['t', 'Transferências']].map(([v, t]) =>
          `<button type="button" class="chip-filtro" data-tipo="${v}" aria-pressed="${lista.tipo === v}">${t}</button>`).join('')}
      </div>
      <div class="filtros-linha">
        <select id="fConta" aria-label="Filtrar por conta">
          <option value="">Todas as contas</option>
          ${base.contas.map((c) => `<option value="${esc(c.id)}" ${lista.conta === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select>
        <input id="fBusca" type="search" placeholder="Buscar" value="${esc(lista.busca)}" aria-label="Buscar lançamento">
      </div>
    </section>

    ${filtrados.length ? Object.keys(porDia).map((d) => `
      <section class="cartao lista">
        <h3 class="lista-titulo dia">${esc(diaSemana(d))}</h3>
        ${porDia[d].map(linhaItem).join('')}
      </section>`).join('') : `
      <section class="cartao vazio">
        <h2>${itens.length ? 'Nada com esse filtro' : 'Nenhum lançamento neste mês'}</h2>
        <p>${itens.length ? 'Mude o filtro ou a busca.' : 'Toque no botão + para lançar entradas, saídas e transferências.'}</p>
      </section>`}

    <p class="nota-etapa">Dízimo do mês, contas a pagar e dinheiro com clientes entram nesta tela nas Etapas 4 e 5.</p>`;

  ctx.el.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    lista.mes = proximoMes(lista.mes, Number(b.dataset.mes));
    renderInicio(ctx);
  }));
  ctx.el.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    lista.tipo = b.dataset.tipo;
    renderInicio(ctx);
  }));
  ctx.el.querySelector('#fConta').addEventListener('change', (e) => { lista.conta = e.target.value; renderInicio(ctx); });
  let espera;
  ctx.el.querySelector('#fBusca').addEventListener('input', (e) => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      lista.busca = e.target.value;
      await renderInicio(ctx);
      const b = ctx.el.querySelector('#fBusca');
      if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 300);
  });
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
      ? reg.pagamentos.filter((p) => p.conta_id).map((p) => ({ conta: p.conta_id, valor: fmtNumero(p.valor) }))
      : [{ conta: '', valor: '' }],
    linha0Manual: !!(reg && tipoRota === 's' && reg.pagamentos.length > 1)
  };

  const usadas = new Set([st.categoria, st.cliente, st.onde, st.de, st.para, ...st.linhas.map((l) => l.conta)]);
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
              <span class="rotulo-campo">Saiu de qual conta?</span>
              ${st.linhas.map((l, i) => `
                <div class="linha-pag" data-linha="${i}">
                  <select aria-label="Conta ${i + 1}"><option value="">Escolha a conta</option>${opcoesContas(l.conta)}</select>
                  <input aria-label="Valor da conta ${i + 1}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}" ${st.linhas.length === 1 ? 'readonly' : ''}>
                  ${st.linhas.length > 1 ? `<button type="button" class="btn-icone" data-remover="${i}" aria-label="Remover esta conta"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
                </div>`).join('')}
              <button type="button" class="btn-link" id="btnDividir">+ dividir com outra conta</button>
              <small class="ajuda" id="ajudaLinhas"></small>
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
    const ids = st.tipo === 'entrada' ? [st.onde] : st.tipo === 'saida' ? st.linhas.map((l) => l.conta) : [st.de, st.para];
    const antigas = base.contas.filter((c) => ids.includes(c.id) && st.data && st.data <= c.data_saldo_inicial);
    const ac = ctx.el.querySelector('#ajudaCorte');
    if (ac) {
      ac.textContent = antigas.length
        ? `A data é igual ou anterior ao saldo inicial de ${antigas.map((c) => c.nome).join(', ')} (${dataBR(antigas[0].data_saldo_inicial)}). O lançamento entra no mês, mas não muda o saldo dessa conta.`
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
      if (st.linhas.some((l) => !l.conta)) return mostrarErro(form, 'Escolha a conta de onde saiu o dinheiro.');
      if (new Set(st.linhas.map((l) => l.conta)).size !== st.linhas.length) return mostrarErro(form, 'A mesma conta aparece duas vezes. Junte os valores numa linha só.');
      const linhas = st.linhas.length === 1
        ? [{ conta_id: st.linhas[0].conta, valor }]
        : st.linhas.map((l) => ({ conta_id: l.conta, valor: parseMoeda(l.valor) }));
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
    toast('Lançamento excluído.');
    window.location.hash = '#/inicio';
  }

  desenhar();
  if (!editando) ctx.el.querySelector('#fValor').focus();
}
