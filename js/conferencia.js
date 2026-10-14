// =====================================================================
// Evvo House Finance — Conferência e fechamento (Etapa 6)
// Compara o saldo do app com o saldo real do banco, registra ajustes
// (fora da renda e do dízimo) e fecha/reabre o mês.
// =====================================================================
import { supabase } from './supabase.js';
import { esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco, mostrarErro, toast } from './util.js';

const est = { mes: hojeISO().slice(0, 7), data: null, informados: {} };

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
  const d = new Date(a, m, 0);
  return `${ym}-${String(d.getDate()).padStart(2, '0')}`;
}
// Data sugerida: último dia do mês se ele já passou; hoje se é o mês atual.
function dataPadrao(ym) {
  const hoje = hojeISO();
  return ym < hoje.slice(0, 7) ? ultimoDia(ym) : hoje;
}
function dataHoraBR(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function renderConferencia(ctx) {
  const lar = ctx.lar;
  if (!est.data || est.data.slice(0, 7) !== est.mes) est.data = dataPadrao(est.mes);
  ctx.el.innerHTML = '<div class="carregando-bloco">Carregando…</div>';

  const comp = `${est.mes}-01`;
  const prox = `${proximoMes(est.mes)}-01`;
  let sit, saldos, ajustes, confs, mem;
  try {
    const rs = await Promise.all([
      supabase.rpc('situacao_mes', { p_mes: comp }),
      supabase.rpc('saldos_em', { p_data: est.data }),
      supabase.from('ajustes').select('id, data, diferenca, saldo_calculado, saldo_informado, motivo, conta:contas!ajustes_conta_fkey(nome)')
        .eq('lar_id', lar.id).gte('data', comp).lt('data', prox).order('data', { ascending: false }),
      supabase.from('conferencias').select('id, data, total_diferenca, itens, criado_por, criado_em, ajustes(id, diferenca)')
        .eq('lar_id', lar.id).gte('data', comp).lt('data', prox).order('criado_em', { ascending: false }),
      supabase.from('membros').select('user_id, nome').eq('lar_id', lar.id)
    ]);
    for (const r of rs) if (r.error) throw r.error;
    [sit, saldos, ajustes, confs, mem] = rs.map((r) => r.data);
  } catch (e) {
    ctx.el.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
    return;
  }

  const nomeQuem = Object.fromEntries(mem.map((m) => [m.user_id, m.nome || 'alguém']));
  const futuro = est.mes > hojeISO().slice(0, 7);

  const linhaConta = (c) => {
    const bloqueada = est.data <= c.data_saldo_inicial;
    const inf = est.informados[c.id] ?? '';
    return `
      <div class="conf-linha" data-conta="${esc(c.id)}">
        <div class="conf-nome">
          <strong><span class="item-tag tag-${c.natureza === 'PJ' ? 'azul' : 'verde'}">${esc(c.natureza)}</span> ${esc(c.nome)}</strong>
          <small>${bloqueada ? `Saldo inicial em ${esc(dataBR(c.data_saldo_inicial))}: confira a partir do dia seguinte` : `No app: <b>${esc(fmtMoeda(c.saldo))}</b>`}</small>
        </div>
        ${bloqueada ? '' : `
          <input inputmode="decimal" placeholder="Saldo no banco" aria-label="Saldo no banco de ${esc(c.nome)}" value="${esc(inf)}">
          <span class="conf-dif" aria-live="polite"></span>`}
      </div>`;
  };

  ctx.el.innerHTML = `
    <a class="voltar" href="#/mais"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Mais</a>

    <div class="mes-nav">
      <button class="btn-icone" type="button" data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2>${esc(nomeMes(est.mes))}</h2>
      <button class="btn-icone" type="button" data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>

    ${sit.fechado ? `
      <section class="cartao status-mes fechado">
        <div>
          <strong>Mês fechado</strong>
          <small>Em ${esc(dataHoraBR(sit.fechado_em))}${sit.fechado_por ? ' por ' + esc(sit.fechado_por) : ''}. Nada deste mês pode ser alterado.</small>
        </div>
        <button class="btn btn-secundario btn-mini" type="button" id="btnReabrir">Reabrir</button>
      </section>` : ''}

    ${!sit.fechado && !futuro ? `
      <section class="cartao conf">
        <h2 class="lista-titulo sem-pad">Conferir saldos com o banco</h2>
        <p class="ajuda" style="margin:0">Abra o extrato de cada conta e digite o saldo no fim do dia escolhido. O app mostra a diferença na hora.</p>
        <div class="campo"><label for="cData">Saldo no fim do dia</label><input id="cData" type="date" value="${esc(est.data)}" max="${esc(hojeISO())}"></div>
        <div class="conf-lista">${saldos.map(linhaConta).join('') || '<p class="ajuda">Nenhuma conta ativa.</p>'}</div>
        <div class="conf-total" id="confTotal"></div>
        <div class="campo"><label for="cMotivo">Observação (opcional)</label><input id="cMotivo" placeholder="Ex.: tarifa não lançada, arredondamento"></div>
        <button class="btn btn-primario" type="button" id="btnConferir">Registrar conferência</button>
      </section>` : ''}

    ${ajustes.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Ajustes do mês</h2>
        ${ajustes.map((a) => `
          <div class="item item-fixo">
            <span class="item-texto">
              <strong>${esc(a.conta?.nome)}</strong>
              <small>${esc(dataBR(a.data))} · app ${esc(fmtMoeda(a.saldo_calculado))} → banco ${esc(fmtMoeda(a.saldo_informado))}${a.motivo ? ' · ' + esc(a.motivo) : ''}</small>
            </span>
            <span class="item-valor ${Number(a.diferenca) < 0 ? 'neg' : ''}">${Number(a.diferenca) > 0 ? '+ ' : ''}${esc(fmtMoeda(a.diferenca))}</span>
            ${sit.fechado ? '' : `<button type="button" class="btn-icone" data-apagar-ajuste="${esc(a.id)}" aria-label="Apagar ajuste"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`}
          </div>`).join('')}
        <p class="lista-vazia">Ajustes corrigem o saldo da conta, mas não contam como renda, despesa nem dízimo.</p>
      </section>` : ''}

    ${confs.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Conferências feitas</h2>
        ${confs.map((c) => {
          // Situação atual: considera só os ajustes que ainda existem.
          const original = Number(c.total_diferenca);
          const atual = (c.ajustes || []).reduce((s, a) => s + Number(a.diferenca), 0);
          const bateu = Math.abs(original) < 0.005;
          const desfeito = !bateu && !(c.ajustes || []).length;
          const parcial = !bateu && !desfeito && Math.abs(atual - original) >= 0.005;
          const tag = bateu ? ['tag-verde', 'Bateu'] : desfeito ? ['tag-cinza', 'Ajuste apagado'] : parcial ? ['tag-ambar', 'Ajuste parcial'] : ['tag-ambar', 'Ajustado'];
          const txt = bateu ? 'tudo bateu'
            : desfeito ? `diferença de ${fmtMoeda(original)} · o ajuste foi apagado`
            : parcial ? `diferença de ${fmtMoeda(original)} · ajuste atual ${fmtMoeda(atual)}`
            : `diferença de ${fmtMoeda(original)}`;
          return `
          <div class="item item-fixo">
            <span class="item-texto">
              <strong>${esc(dataBR(c.data))} · ${c.itens.length} ${c.itens.length === 1 ? 'conta' : 'contas'}</strong>
              <small>${esc(nomeQuem[c.criado_por] || '')} · ${esc(txt)}</small>
            </span>
            <span class="item-tag ${tag[0]}">${tag[1]}</span>
            ${sit.fechado ? '' : `<button type="button" class="btn-icone" data-apagar-conf="${esc(c.id)}" aria-label="Apagar esta conferência"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`}
          </div>`;
        }).join('')}
      </section>` : ''}

    ${!sit.fechado && !futuro ? `
      <section class="cartao fechar">
        <h2 class="lista-titulo sem-pad">Fechar o mês</h2>
        <ul class="checklist">
          <li class="${Number(sit.contas_abertas) ? 'pendente' : 'ok'}">${Number(sit.contas_abertas)
            ? `${sit.contas_abertas} ${Number(sit.contas_abertas) === 1 ? 'conta' : 'contas'} ainda a pagar (${esc(fmtMoeda(sit.valor_aberto))})`
            : 'Todas as contas do mês pagas'}</li>
          <li class="${sit.ultima_conferencia ? 'ok' : 'pendente'}">${sit.ultima_conferencia
            ? `Saldos conferidos em ${esc(dataBR(sit.ultima_conferencia))}`
            : 'Saldos ainda não conferidos neste mês'}</li>
        </ul>
        <p class="ajuda" style="margin:0">Depois de fechado, nada deste mês pode ser lançado, alterado ou apagado até reabrir. Pagamentos feitos no mês seguinte de contas deste mês continuam liberados.</p>
        <button class="btn btn-primario" type="button" id="btnFechar">Fechar ${esc(nomeMes(est.mes).toLowerCase())}</button>
      </section>` : ''}

    ${futuro ? '<section class="cartao vazio"><h2>Mês ainda não começou</h2><p>A conferência e o fechamento ficam disponíveis a partir do primeiro dia do mês.</p></section>' : ''}`;

  // ----- eventos -----
  ctx.el.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    est.mes = proximoMes(est.mes, Number(b.dataset.mes));
    est.data = dataPadrao(est.mes);
    est.informados = {};
    renderConferencia(ctx);
  }));

  const campoData = ctx.el.querySelector('#cData');
  campoData?.addEventListener('change', () => {
    if (!campoData.value) return;
    if (campoData.value > hojeISO()) { toast('A data não pode ser no futuro.'); campoData.value = est.data; return; }
    guardarDigitados();
    est.data = campoData.value;
    if (est.data.slice(0, 7) !== est.mes) est.mes = est.data.slice(0, 7);
    renderConferencia(ctx);
  });

  function guardarDigitados() {
    ctx.el.querySelectorAll('.conf-linha input').forEach((inp) => {
      est.informados[inp.closest('.conf-linha').dataset.conta] = inp.value;
    });
  }

  function atualizarDiferencas() {
    let total = 0;
    let preenchidas = 0;
    ctx.el.querySelectorAll('.conf-linha').forEach((linha) => {
      const inp = linha.querySelector('input');
      const span = linha.querySelector('.conf-dif');
      if (!inp) return;
      const c = saldos.find((x) => x.id === linha.dataset.conta);
      const v = parseMoeda(inp.value);
      if (inp.value.trim() === '' || Number.isNaN(v)) { span.textContent = ''; span.className = 'conf-dif'; return; }
      preenchidas++;
      const dif = Math.round((v - Number(c.saldo)) * 100) / 100;
      total += dif;
      span.textContent = Math.abs(dif) < 0.005 ? 'Bateu' : `${dif > 0 ? '+' : '−'} ${fmtNumero(Math.abs(dif))}`;
      span.className = 'conf-dif ' + (Math.abs(dif) < 0.005 ? 'ok' : 'neg');
    });
    const tot = ctx.el.querySelector('#confTotal');
    if (tot) {
      tot.textContent = !preenchidas ? ''
        : Math.abs(total) < 0.005 ? `Todas as ${preenchidas} contas preenchidas bateram.`
        : `Diferença total: ${total > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(total))}. Antes de ajustar, procure lançamentos esquecidos ou com valor errado.`;
      tot.className = 'conf-total ' + (preenchidas && Math.abs(total) >= 0.005 ? 'neg' : 'ok');
    }
  }
  ctx.el.querySelectorAll('.conf-linha input').forEach((inp) => inp.addEventListener('input', () => {
    guardarDigitados();
    atualizarDiferencas();
  }));
  atualizarDiferencas();

  ctx.el.querySelector('#btnConferir')?.addEventListener('click', async () => {
    guardarDigitados();
    const sec = ctx.el.querySelector('.conf');
    const itens = [];
    for (const c of saldos) {
      const t = est.informados[c.id];
      if (t === undefined || String(t).trim() === '') continue;
      const v = parseMoeda(t);
      if (Number.isNaN(v)) return mostrarErro(sec, `Saldo inválido em ${c.nome}. Exemplo: 1.234,56 ou -2.478,41`);
      itens.push({ conta_id: c.id, saldo_informado: v, nome: c.nome, dif: Math.round((v - Number(c.saldo)) * 100) / 100 });
    }
    if (!itens.length) return mostrarErro(sec, 'Digite o saldo do banco de pelo menos uma conta.');
    const comDif = itens.filter((i) => Math.abs(i.dif) >= 0.005);
    if (comDif.length) {
      const lista = comDif.map((i) => `• ${i.nome}: ${i.dif > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(i.dif))}`).join('\n');
      if (!confirm(`Estas contas não bateram e vão receber um ajuste para ficar igual ao banco:\n\n${lista}\n\nO ajuste não conta como renda, despesa nem dízimo. Registrar?`)) return;
    }
    const { data, error } = await supabase.rpc('registrar_conferencia', {
      p_data: est.data,
      p_itens: itens.map(({ conta_id, saldo_informado }) => ({ conta_id, saldo_informado })),
      p_motivo: ctx.el.querySelector('#cMotivo').value
    });
    if (error) return mostrarErro(sec, erroBanco(error));
    est.informados = {};
    toast(data.ajustes ? `Conferência registrada com ${data.ajustes} ${data.ajustes === 1 ? 'ajuste' : 'ajustes'}.` : 'Conferência registrada: tudo bateu.');
    renderConferencia(ctx);
  });

  ctx.el.querySelectorAll('[data-apagar-ajuste]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Apagar este ajuste? O saldo da conta volta ao calculado pelo app.')) return;
    const { error } = await supabase.from('ajustes').delete().eq('id', b.dataset.apagarAjuste);
    if (error) { toast(erroBanco(error)); return; }
    toast('Ajuste apagado.');
    renderConferencia(ctx);
  }));

  ctx.el.querySelectorAll('[data-apagar-conf]').forEach((b) => b.addEventListener('click', async () => {
    const c = confs.find((x) => x.id === b.dataset.apagarConf);
    const comAjuste = (c.ajustes || []).length;
    if (!confirm(comAjuste
      ? 'Apagar esta conferência do histórico? Os ajustes dela também são apagados e os saldos voltam ao calculado pelo app.'
      : 'Apagar esta conferência do histórico?')) return;
    const { error } = await supabase.from('conferencias').delete().eq('id', c.id);
    if (error) { toast(erroBanco(error)); return; }
    toast('Conferência apagada.');
    renderConferencia(ctx);
  }));

  ctx.el.querySelector('#btnFechar')?.addEventListener('click', async () => {
    const avisos = [];
    if (Number(sit.contas_abertas)) avisos.push(`• ${sit.contas_abertas} conta(s) ainda a pagar`);
    if (!sit.ultima_conferencia) avisos.push('• Saldos não conferidos neste mês');
    const texto = `Fechar ${nomeMes(est.mes).toLowerCase()}?\n\n` +
      (avisos.length ? `Atenção:\n${avisos.join('\n')}\n\n` : '') +
      'Depois de fechado, nada deste mês pode ser alterado até reabrir.';
    if (!confirm(texto)) return;
    const { error } = await supabase.rpc('fechar_mes', { p_mes: comp });
    if (error) { toast(erroBanco(error)); return; }
    toast('Mês fechado.');
    renderConferencia(ctx);
  });

  ctx.el.querySelector('#btnReabrir')?.addEventListener('click', async () => {
    if (!confirm(`Reabrir ${nomeMes(est.mes).toLowerCase()}? Os lançamentos do mês voltam a poder ser alterados.`)) return;
    const { error } = await supabase.rpc('reabrir_mes', { p_mes: comp });
    if (error) { toast(erroBanco(error)); return; }
    toast('Mês reaberto.');
    renderConferencia(ctx);
  });
}
