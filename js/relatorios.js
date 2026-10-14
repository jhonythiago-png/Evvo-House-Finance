// =====================================================================
// Evvo House Finance — Relatórios (Etapa 7)
// Gráficos mensal e anual, comparativo entre anos, impressão/PDF e Excel.
// =====================================================================
import { supabase } from './supabase.js';
import { esc, fmtMoeda, dataBR, hojeISO, erroBanco, toast } from './util.js';
import { GRUPOS } from './cadastros.js';

const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const XLSX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const est = { modo: 'mes', mes: hojeISO().slice(0, 7), ano: Number(hojeISO().slice(0, 4)) };
let graficos = [];

const COR = { entrada: '#1B6B4D', saida: '#E8936B', resultado: '#F2B544', anterior: '#9FB3A7', azul: '#1F4E79' };
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const carregados = {};
function carregarScript(url) {
  if (!carregados[url]) {
    carregados[url] = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = ok;
      s.onerror = () => { delete carregados[url]; falha(new Error('Não foi possível carregar ' + url)); };
      document.head.appendChild(s);
    });
  }
  return carregados[url];
}

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
function ultimoDia(ym) {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}
const n = (v) => Number(v || 0);
const moedaCurta = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : a.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return (v < 0 ? '−' : '') + 'R$ ' + s;
};

function destruirGraficos() {
  graficos.forEach((g) => g.destroy());
  graficos = [];
}

function barras(lista, cor, total) {
  if (!lista.length) return '<p class="lista-vazia">Nada lançado no período.</p>';
  const max = Math.max(...lista.map((x) => n(x.total)));
  return lista.map((x) => `
    <div class="barra-linha">
      <div class="barra-cab"><span>${esc(x.nome)}</span><strong>${esc(fmtMoeda(x.total))}${total ? ` <small>${Math.round(n(x.total) / total * 100)}%</small>` : ''}</strong></div>
      <div class="barra-fundo"><div class="barra" style="width:${Math.max(2, Math.round(n(x.total) / max * 100))}%;background:${cor}"></div></div>
    </div>`).join('');
}

// =====================================================================
// Tela
// =====================================================================
export async function renderRelatorios(ctx) {
  destruirGraficos();
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando relatórios…</div>';
  try {
    await carregarScript(CHART_JS);
  } catch (e) {
    // Sem a biblioteca de gráficos, o resto da tela continua funcionando.
  }
  if (est.modo === 'mes') return telaMes(ctx);
  return telaAno(ctx);
}

function cabecalho(titulo) {
  return `
    <div class="seg-opcoes seg-2" role="radiogroup" aria-label="Período do relatório">
      <button type="button" role="radio" class="seg-btn ${est.modo === 'mes' ? 'ativo' : ''}" aria-checked="${est.modo === 'mes'}" data-modo="mes">Mensal</button>
      <button type="button" role="radio" class="seg-btn ${est.modo === 'ano' ? 'ativo' : ''}" aria-checked="${est.modo === 'ano'}" data-modo="ano">Anual</button>
    </div>
    <div class="mes-nav">
      <button class="btn-icone" type="button" data-nav="-1" aria-label="Anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2>${esc(titulo)}</h2>
      <button class="btn-icone" type="button" data-nav="1" aria-label="Próximo"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>`;
}

function ligarCabecalho(ctx) {
  ctx.el.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    est.modo = b.dataset.modo;
    if (est.modo === 'ano') est.ano = Number(est.mes.slice(0, 4));
    renderRelatorios(ctx);
  }));
  ctx.el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.nav);
    if (est.modo === 'mes') est.mes = proximoMes(est.mes, d);
    else est.ano += d;
    renderRelatorios(ctx);
  }));
}

function botoesSaida() {
  return `
    <div class="acoes-form">
      <button class="btn btn-primario" type="button" id="btnImprimir">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>
        Imprimir / PDF
      </button>
      <button class="btn btn-secundario" type="button" id="btnExcel">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>
        Exportar Excel
      </button>
    </div>`;
}

// ---------------------------------------------------------------------
// Mensal
// ---------------------------------------------------------------------
async function telaMes(ctx) {
  const comp = `${est.mes}-01`;
  const ano = Number(est.mes.slice(0, 4));
  const dataSaldo = est.mes < hojeISO().slice(0, 7) ? ultimoDia(est.mes) : hojeISO();
  let rel, relAno, diz, saldos;
  try {
    const rs = await Promise.all([
      supabase.rpc('relatorio_mes', { p_mes: comp }),
      supabase.rpc('relatorio_ano', { p_ano: ano }),
      supabase.rpc('dizimo_mes', { p_mes: comp }),
      est.mes <= hojeISO().slice(0, 7) ? supabase.rpc('saldos_em', { p_data: dataSaldo }) : Promise.resolve({ data: [] })
    ]);
    for (const r of rs) if (r.error) throw r.error;
    [rel, relAno, diz, saldos] = rs.map((r) => r.data);
  } catch (e) {
    ctx.el.innerHTML = cabecalho(nomeMes(est.mes)) + `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    ligarCabecalho(ctx);
    return;
  }

  const cats = rel.categorias || [];
  const entradas = cats.filter((c) => c.tipo === 'entrada').reduce((s, c) => s + n(c.total), 0);
  const saidas = cats.filter((c) => c.tipo === 'saida').reduce((s, c) => s + n(c.total), 0);
  const resultado = entradas - saidas;
  const catSaida = cats.filter((c) => c.tipo === 'saida').sort((a, b) => n(b.total) - n(a.total));
  const porGrupo = Object.entries(GRUPOS).filter(([, g]) => g.tipo === 'saida').map(([gid, g]) => ({
    nome: g.nome, total: catSaida.filter((c) => c.grupo === gid).reduce((s, c) => s + n(c.total), 0)
  })).filter((x) => x.total > 0);
  const clientes = rel.clientes || [];
  const totalSaldos = (saldos || []).reduce((s, c) => s + n(c.saldo), 0);
  const vazio = !cats.length && !(rel.movimentos || []).length;

  ctx.el.innerHTML = `
    ${cabecalho(nomeMes(est.mes))}

    <section class="rel-cards">
      <div class="rel-card"><span>Entradas</span><strong class="txt-entrada">${esc(fmtMoeda(entradas))}</strong></div>
      <div class="rel-card"><span>Saídas</span><strong class="txt-saida">${esc(fmtMoeda(saidas))}</strong></div>
      <div class="rel-card"><span>Resultado</span><strong class="${resultado < 0 ? 'txt-saida' : 'txt-entrada'}">${resultado < 0 ? '− ' : '+ '}${esc(fmtMoeda(Math.abs(resultado)))}</strong></div>
      <div class="rel-card ambar"><span>Dízimo (${esc(n(diz.percentual).toLocaleString('pt-BR'))}%)</span><strong>${esc(fmtMoeda(diz.valor))}</strong></div>
    </section>

    ${vazio ? '<section class="cartao vazio"><h2>Nada lançado neste mês</h2><p>Os gráficos aparecem quando houver entradas ou saídas no mês.</p></section>' : ''}

    <div class="rel-grade">
      <section class="cartao rel-bloco">
        <h3>Entradas × Saídas em ${ano}</h3>
        <div class="grafico"><canvas id="gAno" aria-label="Gráfico de entradas e saídas por mês"></canvas></div>
      </section>

      <section class="cartao rel-bloco">
        <h3>Para onde foi o dinheiro</h3>
        ${barras(porGrupo, COR.saida, saidas)}
        <details class="rel-detalhe">
          <summary>Ver por categoria</summary>
          ${barras(catSaida, COR.saida, saidas)}
        </details>
      </section>

      <section class="cartao rel-bloco">
        <h3>Renda por cliente</h3>
        ${barras(clientes, COR.entrada, clientes.reduce((s, c) => s + n(c.total), 0))}
      </section>

      <section class="cartao rel-bloco">
        <h3>Dízimo do mês</h3>
        <div class="dizimo-conta">
          <div><span>Renda Empresa</span><span>${esc(fmtMoeda(diz.renda))}</span></div>
          <div><span>− Despesas da Empresa</span><span>${esc(fmtMoeda(diz.despesas_empresa))}</span></div>
          <div class="base"><span>Base</span><span>${esc(fmtMoeda(diz.base))}</span></div>
        </div>
        <div class="dizimo-valor"><span>${esc(n(diz.percentual).toLocaleString('pt-BR'))}%</span><strong>${esc(fmtMoeda(diz.valor))}</strong></div>
        ${(saldos || []).length ? `
          <h3 style="margin-top:8px">Saldo das contas em ${esc(dataBR(dataSaldo))}</h3>
          ${saldos.map((c) => `<div class="saldo-linha sem-borda"><span>${esc(c.nome)}</span><strong class="${n(c.saldo) < 0 ? 'neg' : ''}">${esc(fmtMoeda(c.saldo))}</strong></div>`).join('')}
          <div class="saldo-linha sem-borda total"><span>Total</span><strong>${esc(fmtMoeda(totalSaldos))}</strong></div>` : ''}
      </section>
    </div>

    ${botoesSaida()}`;

  ligarCabecalho(ctx);
  graficoAno(relAno, est.mes);
  ctx.el.querySelector('#btnImprimir').addEventListener('click', () =>
    imprimir(htmlRelatorioMes(ctx, rel, diz, saldos, dataSaldo, { entradas, saidas, resultado, porGrupo, catSaida, clientes })));
  ctx.el.querySelector('#btnExcel').addEventListener('click', () => excelMes(ctx, rel, diz, saldos, dataSaldo, { entradas, saidas, resultado }));
}

function graficoAno(relAno, destaque) {
  const cv = document.getElementById('gAno');
  if (!cv || !window.Chart) { if (cv) cv.parentElement.innerHTML = '<p class="lista-vazia">Gráfico indisponível sem internet.</p>'; return; }
  const meses = relAno.meses || [];
  const corDestaque = (cor, base) => meses.map((m) => (m.mes === destaque || !destaque ? cor : base));
  graficos.push(new window.Chart(cv, {
    type: 'bar',
    data: {
      labels: MESES_CURTOS,
      datasets: [
        { label: 'Entradas', data: meses.map((m) => n(m.entradas)), backgroundColor: corDestaque(COR.entrada, '#7FAE98'), borderRadius: 4 },
        { label: 'Saídas', data: meses.map((m) => n(m.saidas)), backgroundColor: corDestaque(COR.saida, '#F3C5AE'), borderRadius: 4 }
      ]
    },
    options: opcoesGrafico()
  }));
}

function opcoesGrafico(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Plus Jakarta Sans' } } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoeda(c.parsed.y)}` } }
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', size: 11 } } },
      y: { ticks: { callback: (v) => moedaCurta(v), font: { family: 'Plus Jakarta Sans', size: 11 } }, grid: { color: '#EEF2EF' } }
    },
    ...extra
  };
}

// ---------------------------------------------------------------------
// Anual
// ---------------------------------------------------------------------
async function telaAno(ctx) {
  let atual, anterior;
  try {
    const rs = await Promise.all([
      supabase.rpc('relatorio_ano', { p_ano: est.ano }),
      supabase.rpc('relatorio_ano', { p_ano: est.ano - 1 })
    ]);
    for (const r of rs) if (r.error) throw r.error;
    [atual, anterior] = rs.map((r) => r.data);
  } catch (e) {
    ctx.el.innerHTML = cabecalho(String(est.ano)) + `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    ligarCabecalho(ctx);
    return;
  }

  const meses = atual.meses || [];
  const soma = (lista, campo) => lista.reduce((s, m) => s + n(m[campo]), 0);
  const tot = {
    entradas: soma(meses, 'entradas'), saidas: soma(meses, 'saidas'), dizimo: soma(meses, 'dizimo'),
    renda: soma(meses, 'renda_empresa'), resultado: soma(meses, 'resultado')
  };
  const comMov = meses.filter((m) => n(m.entradas) || n(m.saidas));
  const mediaSaidas = comMov.length ? tot.saidas / comMov.length : 0;
  const totAnt = { entradas: soma(anterior.meses || [], 'entradas'), saidas: soma(anterior.meses || [], 'saidas') };
  const temAnterior = totAnt.entradas || totAnt.saidas;
  const catSaida = (atual.categorias || []).filter((c) => c.tipo === 'saida').slice(0, 12);
  const clientes = atual.clientes || [];

  const variacao = (a, b) => (!b ? '' : `${a >= b ? '+' : '−'}${Math.abs(Math.round((a - b) / b * 100))}% vs ${est.ano - 1}`);

  ctx.el.innerHTML = `
    ${cabecalho(String(est.ano))}

    <section class="rel-cards">
      <div class="rel-card"><span>Entradas no ano</span><strong class="txt-entrada">${esc(fmtMoeda(tot.entradas))}</strong>${temAnterior ? `<small>${esc(variacao(tot.entradas, totAnt.entradas))}</small>` : ''}</div>
      <div class="rel-card"><span>Saídas no ano</span><strong class="txt-saida">${esc(fmtMoeda(tot.saidas))}</strong>${temAnterior ? `<small>${esc(variacao(tot.saidas, totAnt.saidas))}</small>` : ''}</div>
      <div class="rel-card"><span>Resultado</span><strong class="${tot.resultado < 0 ? 'txt-saida' : 'txt-entrada'}">${tot.resultado < 0 ? '− ' : '+ '}${esc(fmtMoeda(Math.abs(tot.resultado)))}</strong><small>Média de saídas ${esc(fmtMoeda(mediaSaidas))}/mês</small></div>
      <div class="rel-card ambar"><span>Dízimo e ofertas</span><strong>${esc(fmtMoeda(tot.dizimo))}</strong><small>Renda Empresa ${esc(fmtMoeda(tot.renda))}</small></div>
    </section>

    <div class="rel-grade">
      <section class="cartao rel-bloco largo">
        <h3>Mês a mês</h3>
        <div class="grafico alto"><canvas id="gMeses" aria-label="Entradas, saídas e resultado por mês"></canvas></div>
      </section>

      ${temAnterior ? `
      <section class="cartao rel-bloco largo">
        <h3>Saídas: ${est.ano} × ${est.ano - 1}</h3>
        <div class="grafico"><canvas id="gComp" aria-label="Comparativo de saídas entre anos"></canvas></div>
      </section>` : ''}

      <section class="cartao rel-bloco largo">
        <h3>Tabela do ano</h3>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Resultado</th><th>Dízimo</th></tr></thead>
            <tbody>
              ${meses.map((m, i) => `
                <tr class="${n(m.entradas) || n(m.saidas) ? '' : 'apagado'}">
                  <td>${MESES_CURTOS[i]}${m.fechado ? ' <span class="item-tag tag-cinza">fechado</span>' : ''}</td>
                  <td>${esc(fmtMoeda(m.entradas))}</td>
                  <td>${esc(fmtMoeda(m.saidas))}</td>
                  <td class="${n(m.resultado) < 0 ? 'neg' : ''}">${esc(fmtMoeda(m.resultado))}</td>
                  <td>${esc(fmtMoeda(m.dizimo))}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr><td>Total</td><td>${esc(fmtMoeda(tot.entradas))}</td><td>${esc(fmtMoeda(tot.saidas))}</td><td class="${tot.resultado < 0 ? 'neg' : ''}">${esc(fmtMoeda(tot.resultado))}</td><td>${esc(fmtMoeda(tot.dizimo))}</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section class="cartao rel-bloco">
        <h3>Maiores gastos do ano</h3>
        ${barras(catSaida, COR.saida, tot.saidas)}
      </section>

      <section class="cartao rel-bloco">
        <h3>Renda por cliente no ano</h3>
        ${barras(clientes, COR.entrada, clientes.reduce((s, c) => s + n(c.total), 0))}
      </section>
    </div>

    ${botoesSaida()}`;

  ligarCabecalho(ctx);

  // Meses que ainda não chegaram ficam sem ponto nas linhas.
  const hoje = hojeISO();
  const futuro = (i) => est.ano > Number(hoje.slice(0, 4)) || (est.ano === Number(hoje.slice(0, 4)) && i + 1 > Number(hoje.slice(5, 7)));
  if (window.Chart) {
    const cv = document.getElementById('gMeses');
    graficos.push(new window.Chart(cv, {
      data: {
        labels: MESES_CURTOS,
        datasets: [
          { type: 'bar', label: 'Entradas', data: meses.map((m) => n(m.entradas)), backgroundColor: COR.entrada, borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Saídas', data: meses.map((m) => n(m.saidas)), backgroundColor: COR.saida, borderRadius: 4, order: 2 },
          { type: 'line', label: 'Resultado', data: meses.map((m, i) => (futuro(i) ? null : n(m.resultado))), borderColor: '#B07A12', backgroundColor: COR.resultado, pointRadius: 3, tension: 0.3, order: 1 }
        ]
      },
      options: opcoesGrafico()
    }));
    const cc = document.getElementById('gComp');
    if (cc) {
      graficos.push(new window.Chart(cc, {
        type: 'line',
        data: {
          labels: MESES_CURTOS,
          datasets: [
            { label: String(est.ano), data: meses.map((m, i) => (futuro(i) ? null : n(m.saidas))), borderColor: COR.saida, backgroundColor: COR.saida, tension: 0.3, pointRadius: 3 },
            { label: String(est.ano - 1), data: (anterior.meses || []).map((m) => n(m.saidas)), borderColor: COR.anterior, backgroundColor: COR.anterior, borderDash: [6, 4], tension: 0.3, pointRadius: 2 }
          ]
        },
        options: opcoesGrafico()
      }));
    }
  } else {
    const g = document.getElementById('gMeses');
    if (g) g.parentElement.innerHTML = '<p class="lista-vazia">Gráfico indisponível sem internet.</p>';
  }

  ctx.el.querySelector('#btnImprimir').addEventListener('click', () => imprimir(htmlRelatorioAno(ctx, atual, tot, catSaida, clientes)));
  ctx.el.querySelector('#btnExcel').addEventListener('click', () => excelAno(ctx, atual));
}

// =====================================================================
// Impressão / PDF
// =====================================================================
function imprimir(html) {
  document.getElementById('impressao')?.remove();
  const div = document.createElement('div');
  div.id = 'impressao';
  div.innerHTML = html;
  document.body.appendChild(div);
  document.body.classList.add('imprimindo');
  const limpar = () => {
    document.body.classList.remove('imprimindo');
    div.remove();
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);
  setTimeout(() => window.print(), 100);
}

function topoImpressao(ctx, titulo) {
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `
    <header class="imp-topo">
      <div class="imp-marca">
        <img src="./icons/icon.svg" alt="" width="40" height="40">
        <div><strong>Evvo House Finance</strong><span>${esc(ctx.lar.nome)}</span></div>
      </div>
      <div class="imp-titulo"><h1>${esc(titulo)}</h1><span>Emitido em ${esc(agora)}</span></div>
    </header>`;
}

function tabelaSimples(cabecalhos, linhas, rodape) {
  return `
    <table class="imp-tabela">
      <thead><tr>${cabecalhos.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      ${rodape ? `<tfoot><tr>${rodape.map((c) => `<td>${c}</td>`).join('')}</tr></tfoot>` : ''}
    </table>`;
}

// Movimentos separados: entradas (renda) primeiro, depois saídas e, por último,
// o que só muda dinheiro de lugar (transferências, recebimentos, ajustes).
function separarMovimentos(mov) {
  const porData = (a, b) => a.data.localeCompare(b.data) || (a.descricao || '').localeCompare(b.descricao || '');
  return {
    entradas: mov.filter((m) => m.tipo === 'Entrada').sort(porData),
    saidas: mov.filter((m) => m.tipo === 'Saída').sort(porData),
    outros: mov.filter((m) => !['Entrada', 'Saída'].includes(m.tipo)).sort(porData)
  };
}

const nw = (t) => `<span class="nw">${t}</span>`;

function secoesMovimentos(mov) {
  const { entradas, saidas, outros } = separarMovimentos(mov);
  const soma = (l) => l.reduce((s, m) => s + Math.abs(n(m.valor)), 0);
  const pago = saidas.filter((m) => m.situacao === 'Pago');
  const aberto = saidas.filter((m) => m.situacao !== 'Pago');
  let html = '';

  html += `<h2>Entradas (${entradas.length}) · ${esc(fmtMoeda(soma(entradas)))}</h2>`;
  html += entradas.length ? tabelaSimples(['Data', 'Quem pagou / descrição', 'Categoria', 'Onde caiu', 'Valor'],
    entradas.map((m) => [nw(esc(dataBR(m.data).slice(0, 5))), esc(m.descricao), esc(m.categoria || ''), esc(m.conta || ''), nw(esc(fmtMoeda(m.valor)))]),
    ['', '', '', 'Total', nw(esc(fmtMoeda(soma(entradas))))]) : '<p>Nenhuma entrada no mês.</p>';

  html += `<h2>Saídas (${saidas.length}) · ${esc(fmtMoeda(soma(saidas)))}</h2>`;
  html += saidas.length ? tabelaSimples(['Data', 'Descrição', 'Categoria', 'Pago com', 'Situação', 'Valor'],
    saidas.map((m) => [nw(esc(dataBR(m.data).slice(0, 5))), esc(m.descricao), esc(m.categoria || ''), esc(m.conta === '-' ? '' : (m.conta || '')), esc(m.situacao || ''), nw(esc(fmtMoeda(Math.abs(n(m.valor)))))]),
    ['', '', '', '', `Pago ${nw(esc(fmtMoeda(soma(pago))))} · a pagar ${nw(esc(fmtMoeda(soma(aberto))))}`, nw(esc(fmtMoeda(soma(saidas))))]) : '<p>Nenhuma saída no mês.</p>';

  if (outros.length) {
    html += `<h2>Transferências, recebimentos e ajustes (${outros.length})</h2>`;
    html += '<p class="imp-nota">Só mudam o dinheiro de lugar: não entram em entradas, saídas nem no dízimo.</p>';
    html += tabelaSimples(['Data', 'Tipo', 'Descrição', 'Contas', 'Valor'],
      outros.map((m) => [nw(esc(dataBR(m.data).slice(0, 5))), esc(m.tipo), esc(m.descricao), esc(m.conta || ''), nw(esc(fmtMoeda(m.valor)))]));
  }
  return html;
}

function htmlRelatorioMes(ctx, rel, diz, saldos, dataSaldo, t) {
  const mov = rel.movimentos || [];
  return `
    ${topoImpressao(ctx, 'Relatório de ' + nomeMes(est.mes).toLowerCase())}
    <section class="imp-resumo">
      <div><span>Entradas</span><strong>${esc(fmtMoeda(t.entradas))}</strong></div>
      <div><span>Saídas</span><strong>${esc(fmtMoeda(t.saidas))}</strong></div>
      <div><span>Resultado</span><strong>${esc(fmtMoeda(t.resultado))}</strong></div>
      <div><span>Dízimo</span><strong>${esc(fmtMoeda(diz.valor))}</strong></div>
    </section>
    <div class="imp-colunas">
      <section>
        <h2>Dízimo</h2>
        ${tabelaSimples(['Item', 'Valor'], [
          ['Renda Empresa', esc(fmtMoeda(diz.renda))],
          ['− Despesas da Empresa', esc(fmtMoeda(diz.despesas_empresa))],
          ['Base', esc(fmtMoeda(diz.base))]
        ], [`${esc(n(diz.percentual).toLocaleString('pt-BR'))}% da base`, esc(fmtMoeda(diz.valor))])}
        <h2>Renda por cliente</h2>
        ${t.clientes.length ? tabelaSimples(['Cliente', 'Total'], t.clientes.map((c) => [esc(c.nome), esc(fmtMoeda(c.total))])) : '<p>Nenhuma.</p>'}
      </section>
      <section>
        <h2>Saídas por grupo</h2>
        ${tabelaSimples(['Grupo', 'Total'], t.porGrupo.map((g) => [esc(g.nome), esc(fmtMoeda(g.total))]), ['Total', esc(fmtMoeda(t.saidas))])}
        ${(saldos || []).length ? `
          <h2>Saldo das contas em ${esc(dataBR(dataSaldo))}</h2>
          ${tabelaSimples(['Conta', 'Saldo'], saldos.map((c) => [esc(c.nome), esc(fmtMoeda(c.saldo))]), ['Total', esc(fmtMoeda(saldos.reduce((s, c) => s + n(c.saldo), 0)))])}` : ''}
      </section>
    </div>
    <h2>Saídas por categoria</h2>
    ${tabelaSimples(['Categoria', 'Grupo', 'Total'], t.catSaida.map((c) => [esc(c.nome), esc(GRUPOS[c.grupo]?.nome || ''), esc(fmtMoeda(c.total))]))}
    ${secoesMovimentos(mov)}`;
}

function htmlRelatorioAno(ctx, atual, tot, catSaida, clientes) {
  const meses = atual.meses || [];
  return `
    ${topoImpressao(ctx, 'Relatório anual de ' + est.ano)}
    <section class="imp-resumo">
      <div><span>Entradas</span><strong>${esc(fmtMoeda(tot.entradas))}</strong></div>
      <div><span>Saídas</span><strong>${esc(fmtMoeda(tot.saidas))}</strong></div>
      <div><span>Resultado</span><strong>${esc(fmtMoeda(tot.resultado))}</strong></div>
      <div><span>Dízimo e ofertas</span><strong>${esc(fmtMoeda(tot.dizimo))}</strong></div>
    </section>
    <h2>Mês a mês</h2>
    ${tabelaSimples(['Mês', 'Renda Empresa', 'Outras rendas', 'Entradas', 'Saídas', 'Resultado', 'Dízimo'],
      meses.map((m, i) => [MESES_CURTOS[i], esc(fmtMoeda(m.renda_empresa)), esc(fmtMoeda(m.outras_rendas)), esc(fmtMoeda(m.entradas)), esc(fmtMoeda(m.saidas)), esc(fmtMoeda(m.resultado)), esc(fmtMoeda(m.dizimo))]),
      ['Total', esc(fmtMoeda(tot.renda)), esc(fmtMoeda(meses.reduce((s, m) => s + n(m.outras_rendas), 0))), esc(fmtMoeda(tot.entradas)), esc(fmtMoeda(tot.saidas)), esc(fmtMoeda(tot.resultado)), esc(fmtMoeda(tot.dizimo))])}
    <div class="imp-colunas">
      <section>
        <h2>Maiores gastos</h2>
        ${tabelaSimples(['Categoria', 'Total'], catSaida.map((c) => [esc(c.nome), esc(fmtMoeda(c.total))]))}
      </section>
      <section>
        <h2>Renda por cliente</h2>
        ${clientes.length ? tabelaSimples(['Cliente', 'Total'], clientes.map((c) => [esc(c.nome), esc(fmtMoeda(c.total))])) : '<p>Nenhuma.</p>'}
      </section>
    </div>`;
}

// =====================================================================
// Excel
// =====================================================================
function nomeArquivo(ctx, sufixo) {
  const lar = ctx.lar.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_');
  return `EvvoHouse_${lar}_${sufixo}.xlsx`;
}

async function prepararXlsx() {
  try {
    await carregarScript(XLSX_JS);
    return window.XLSX;
  } catch {
    toast('Não foi possível carregar o gerador de Excel. Verifique a internet.');
    return null;
  }
}

function folha(XLSX, linhas, larguras) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  if (larguras) ws['!cols'] = larguras.map((w) => ({ wch: w }));
  return ws;
}

async function excelMes(ctx, rel, diz, saldos, dataSaldo, t) {
  const XLSX = await prepararXlsx();
  if (!XLSX) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Evvo House Finance', ctx.lar.nome],
    ['Mês', nomeMes(est.mes)],
    [],
    ['Entradas', t.entradas],
    ['Saídas', t.saidas],
    ['Resultado', t.resultado],
    [],
    ['Renda Empresa', n(diz.renda)],
    ['Despesas da Empresa', n(diz.despesas_empresa)],
    ['Base do dízimo', n(diz.base)],
    [`Dízimo (${n(diz.percentual)}%)`, n(diz.valor)],
    [],
    [`Saldo das contas em ${dataBR(dataSaldo)}`],
    ...(saldos || []).map((c) => [c.nome, n(c.saldo)])
  ], [32, 18]), 'Resumo');
  const sep = separarMovimentos(rel.movimentos || []);
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Data', 'Quem pagou / descrição', 'Categoria', 'Grupo', 'Onde caiu', 'Valor', 'Lançado por'],
    ...sep.entradas.map((m) => [dataBR(m.data), m.descricao, m.categoria || '', GRUPOS[m.grupo]?.nome || '', m.conta || '', n(m.valor), m.quem || ''])
  ], [11, 32, 26, 20, 26, 14, 16]), 'Entradas');
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Data', 'Descrição', 'Categoria', 'Grupo', 'Pago com', 'Valor', 'Situação', 'Lançado por'],
    ...sep.saidas.map((m) => [dataBR(m.data), m.descricao, m.categoria || '', GRUPOS[m.grupo]?.nome || '', m.conta === '-' ? '' : (m.conta || ''), Math.abs(n(m.valor)), m.situacao || '', m.quem || ''])
  ], [11, 34, 26, 20, 28, 14, 10, 16]), 'Saídas');
  if (sep.outros.length) {
    XLSX.utils.book_append_sheet(wb, folha(XLSX, [
      ['Data', 'Tipo', 'Descrição', 'Contas', 'Valor', 'Lançado por'],
      ...sep.outros.map((m) => [dataBR(m.data), m.tipo, m.descricao, m.conta || '', n(m.valor), m.quem || ''])
    ], [11, 14, 32, 30, 14, 16]), 'Transferências e ajustes');
  }
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Categoria', 'Grupo', 'Tipo', 'Total'],
    ...(rel.categorias || []).map((c) => [c.nome, GRUPOS[c.grupo]?.nome || '', c.tipo === 'entrada' ? 'Entrada' : 'Saída', n(c.total)])
  ], [30, 22, 10, 14]), 'Categorias');
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Cliente', 'Total', 'Ficou com o cliente'],
    ...(rel.clientes || []).map((c) => [c.nome, n(c.total), n(c.com_cliente)])
  ], [28, 14, 18]), 'Clientes');
  XLSX.writeFile(wb, nomeArquivo(ctx, est.mes));
}

async function excelAno(ctx, atual) {
  const XLSX = await prepararXlsx();
  if (!XLSX) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Mês', 'Renda Empresa', 'Outras rendas', 'Entradas', 'Despesas da casa', 'Despesas da empresa', 'Dízimo e ofertas', 'Saídas', 'Resultado', 'Fechado'],
    ...(atual.meses || []).map((m, i) => [`${MESES_CURTOS[i]}/${est.ano}`, n(m.renda_empresa), n(m.outras_rendas), n(m.entradas), n(m.despesa_casa), n(m.despesa_empresa), n(m.dizimo), n(m.saidas), n(m.resultado), m.fechado ? 'Sim' : ''])
  ], [10, 15, 14, 14, 16, 18, 16, 14, 14, 8]), 'Meses');
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Categoria', 'Grupo', 'Tipo', 'Total no ano'],
    ...(atual.categorias || []).map((c) => [c.nome, GRUPOS[c.grupo]?.nome || '', c.tipo === 'entrada' ? 'Entrada' : 'Saída', n(c.total)])
  ], [30, 22, 10, 14]), 'Categorias');
  XLSX.utils.book_append_sheet(wb, folha(XLSX, [
    ['Cliente', 'Total no ano'],
    ...(atual.clientes || []).map((c) => [c.nome, n(c.total)])
  ], [28, 14]), 'Clientes');
  XLSX.writeFile(wb, nomeArquivo(ctx, String(est.ano)));
}
