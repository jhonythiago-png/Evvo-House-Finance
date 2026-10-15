// =====================================================================
// Evvo House Finance — Cadastros (Etapa 2)
// Minhas contas, clientes, categorias, pessoas da casa, dízimo e lar.
// =====================================================================
import { supabase } from './supabase.js';
import {
  esc, fmtMoeda, fmtNumero, parseMoeda, dataBR, hojeISO, erroBanco,
  abrirFolha, fecharFolha, mostrarErro, toast, mensagemConvite
} from './util.js';
import { telaAvisos } from './avisos.js';
import { telaAjuda } from './ajuda.js';

export const TITULOS_CADASTRO = {
  contas: 'Minhas contas',
  clientes: 'Clientes',
  categorias: 'Categorias',
  pessoas: 'Pessoas da casa',
  lar: 'Dízimo e dados do lar',
  avisos: 'Avisos no WhatsApp',
  ajuda: 'Ajuda'
};

export const GRUPOS = {
  renda_empresa:   { nome: 'Renda Empresa',     tipo: 'entrada', dizimo: 'Entra na base do dízimo', classe: 'tag-ambar' },
  outras_rendas:   { nome: 'Outras Rendas',     tipo: 'entrada', dizimo: 'Fora do dízimo',          classe: 'tag-cinza' },
  despesa_casa:    { nome: 'Despesas da Casa',  tipo: 'saida',   dizimo: 'Fora do dízimo',          classe: 'tag-cinza' },
  despesa_empresa: { nome: 'Despesas da Empresa', tipo: 'saida', dizimo: 'Deduz da base do dízimo', classe: 'tag-azul' },
  dizimo:          { nome: 'Dízimo e Ofertas',  tipo: 'saida',   dizimo: 'Fora da base',            classe: 'tag-cinza' }
};

const ICONE_SETA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// ctx = { el, lar, info, recarregarInfo }
export async function renderCadastro(qual, ctx) {
  const telas = { contas: telaContas, clientes: telaClientes, categorias: telaCategorias, pessoas: telaPessoas, lar: telaLar, avisos: telaAvisos, ajuda: telaAjuda };
  const fn = telas[qual];
  if (!fn) { window.location.hash = '#/mais'; return; }
  ctx.el.innerHTML = `${voltar()}<div class="carregando-bloco">Carregando…</div>`;
  try {
    await fn(ctx);
  } catch (e) {
    ctx.el.innerHTML = `${voltar()}<div class="aviso aviso-erro" role="alert">${esc(erroBanco(e))}</div>`;
  }
}

function voltar() {
  return `<a class="voltar" href="#/mais"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Mais</a>`;
}

function seg(nome, opcoes, valor) {
  return `<fieldset class="seg"><legend>${esc(nome.rotulo)}</legend>
    <div class="seg-opcoes">
      ${opcoes.map(([v, t]) => `<label><input type="radio" name="${nome.campo}" value="${esc(v)}" ${v === valor ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}
    </div>
  </fieldset>`;
}

function valorRadio(form, campo) {
  const r = form.querySelector(`input[name="${campo}"]:checked`);
  return r ? r.value : null;
}

// =====================================================================
// Minhas contas
// =====================================================================
async function telaContas(ctx) {
  const { data, error } = await supabase.from('v_saldo_contas').select('*')
    .eq('lar_id', ctx.lar.id).order('ordem').order('nome');
  if (error) throw error;

  const ativas = data.filter((c) => c.ativa);
  const inativas = data.filter((c) => !c.ativa);
  const total = ativas.reduce((s, c) => s + Number(c.saldo_atual), 0);

  const item = (c) => `
    <button class="item" type="button" data-id="${esc(c.id)}">
      <span class="item-tag tag-${c.natureza === 'PJ' ? 'azul' : 'verde'}">${esc(c.natureza)}</span>
      <span class="item-texto">
        <strong>${esc(c.nome)}</strong>
        <small>${c.tipo === 'dinheiro' ? 'Dinheiro' : 'Banco'} · inicial ${esc(fmtMoeda(c.saldo_inicial))} em ${esc(dataBR(c.data_saldo_inicial))}</small>
      </span>
      <span class="item-valor ${Number(c.saldo_atual) < 0 ? 'neg' : ''}">${esc(fmtMoeda(c.saldo_atual))}</span>
      ${ICONE_SETA}
    </button>`;

  const bloco = (titulo, lista) => lista.length ? `
    <section class="cartao lista">
      <h2 class="lista-titulo">${esc(titulo)}</h2>
      ${lista.map(item).join('')}
    </section>` : '';

  ctx.el.innerHTML = `
    ${voltar()}
    <p class="intro">Cadastre onde o dinheiro fica e o saldo real de cada conta em um dia de corte. A partir dele o app calcula tudo sozinho.</p>
    ${data.length ? `
      <section class="cartao resumo-linha">
        <span>Saldo agora em todas as contas</span>
        <strong class="${total < 0 ? 'neg' : ''}">${esc(fmtMoeda(total))}</strong>
      </section>` : ''}
    ${bloco('Pessoa física', ativas.filter((c) => c.natureza === 'PF'))}
    ${bloco('Empresa', ativas.filter((c) => c.natureza === 'PJ'))}
    ${bloco('Desativadas', inativas)}
    ${data.length ? '' : '<section class="cartao vazio"><h2>Nenhuma conta ainda</h2><p>Comece pelas contas que você mais usa: Caixa Pol, Sicredi PJ, Nubank, dinheiro.</p></section>'}
    <button class="btn btn-primario btn-largo" type="button" id="btnNova">Adicionar conta</button>`;

  ctx.el.querySelector('#btnNova').addEventListener('click', () => formConta(ctx, null));
  ctx.el.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => formConta(ctx, data.find((c) => c.id === b.dataset.id))));
}

function formConta(ctx, c) {
  const nova = !c;
  const folha = abrirFolha(nova ? 'Nova conta' : 'Editar conta', `
    <form class="form" novalidate>
      <div class="campo"><label for="cNome">Nome</label><input id="cNome" value="${esc(c?.nome || '')}" placeholder="Ex.: Sicredi PJ" required></div>
      ${seg({ rotulo: 'De quem é', campo: 'natureza' }, [['PF', 'Pessoa física'], ['PJ', 'Empresa']], c?.natureza || 'PF')}
      ${seg({ rotulo: 'Tipo', campo: 'tipo' }, [['banco', 'Banco'], ['dinheiro', 'Dinheiro']], c?.tipo || 'banco')}
      <div class="campo">
        <label for="cSaldo">Saldo inicial (R$)</label>
        <input id="cSaldo" inputmode="decimal" value="${c ? esc(fmtNumero(c.saldo_inicial)) : ''}" placeholder="0,00">
        <small class="ajuda">Use o sinal de menos para saldo negativo, como cheque especial: -2.478,41. Lançamentos com data depois deste dia mudam o saldo.</small>
      </div>
      <div class="campo"><label for="cData">Saldo no fim do dia</label><input id="cData" type="date" value="${esc(c?.data_saldo_inicial || hojeISO())}"></div>
      ${nova ? '' : `<label class="check"><input type="checkbox" id="cAtiva" ${c.ativa ? 'checked' : ''}><span>Conta ativa</span></label>`}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        ${nova ? '' : '<button class="btn btn-perigo" type="button" id="btnExcluir">Excluir</button>'}
      </div>
    </form>`);

  const form = folha.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.querySelector('#cNome').value.trim();
    const textoSaldo = form.querySelector('#cSaldo').value;
    const saldo = textoSaldo.trim() === '' ? 0 : parseMoeda(textoSaldo);
    const data = form.querySelector('#cData').value;
    if (!nome) return mostrarErro(form, 'Informe o nome da conta.');
    if (Number.isNaN(saldo)) return mostrarErro(form, 'Saldo inválido. Exemplo: 1.234,56');
    if (!data) return mostrarErro(form, 'Informe a data do saldo.');
    const reg = {
      nome, saldo_inicial: saldo, data_saldo_inicial: data,
      natureza: valorRadio(form, 'natureza'), tipo: valorRadio(form, 'tipo')
    };
    if (!nova) reg.ativa = form.querySelector('#cAtiva').checked;
    const q = nova
      ? supabase.from('contas').insert({ ...reg, lar_id: ctx.lar.id })
      : supabase.from('contas').update(reg).eq('id', c.id);
    const { error } = await q;
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(nova ? 'Conta adicionada.' : 'Conta atualizada.');
    renderCadastro('contas', ctx);
  });

  folha.querySelector('#btnExcluir')?.addEventListener('click', async () => {
    if (!confirm(`Excluir a conta "${c.nome}"?`)) return;
    const { error } = await supabase.from('contas').delete().eq('id', c.id);
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Conta excluída.');
    renderCadastro('contas', ctx);
  });
}

// =====================================================================
// Clientes
// =====================================================================
async function telaClientes(ctx) {
  const { data, error } = await supabase.from('clientes').select('*')
    .eq('lar_id', ctx.lar.id).order('nome');
  if (error) throw error;

  const ativos = data.filter((c) => c.ativo);
  const inativos = data.filter((c) => !c.ativo);
  const item = (c) => `
    <button class="item" type="button" data-id="${esc(c.id)}">
      <span class="item-texto"><strong>${esc(c.nome)}</strong></span>
      ${ICONE_SETA}
    </button>`;

  ctx.el.innerHTML = `
    ${voltar()}
    <p class="intro">Quem paga a renda da empresa. Em cada entrada você escolhe o cliente e a conta onde o dinheiro caiu, ou se ficou com o cliente.</p>
    ${ativos.length ? `<section class="cartao lista"><h2 class="lista-titulo">Ativos (${ativos.length})</h2>${ativos.map(item).join('')}</section>` : ''}
    ${inativos.length ? `<section class="cartao lista"><h2 class="lista-titulo">Desativados</h2>${inativos.map(item).join('')}</section>` : ''}
    ${data.length ? '' : '<section class="cartao vazio"><h2>Nenhum cliente ainda</h2><p>Cadastre quem te paga: Acocimentos, Assoline, Isotec, Frete, Zingoti, Midi…</p></section>'}
    <button class="btn btn-primario btn-largo" type="button" id="btnNovo">Adicionar cliente</button>`;

  ctx.el.querySelector('#btnNovo').addEventListener('click', () => formCliente(ctx, null));
  ctx.el.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => formCliente(ctx, data.find((c) => c.id === b.dataset.id))));
}

function formCliente(ctx, c) {
  const novo = !c;
  const folha = abrirFolha(novo ? 'Novo cliente' : 'Editar cliente', `
    <form class="form" novalidate>
      <div class="campo"><label for="clNome">Nome</label><input id="clNome" value="${esc(c?.nome || '')}" placeholder="Ex.: Isotec" required></div>
      ${novo ? '' : `<label class="check"><input type="checkbox" id="clAtivo" ${c.ativo ? 'checked' : ''}><span>Cliente ativo</span></label>`}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        ${novo ? '<button class="btn btn-secundario" type="button" id="btnSalvarOutro">Salvar e adicionar outro</button>' : '<button class="btn btn-perigo" type="button" id="btnExcluir">Excluir</button>'}
      </div>
    </form>`);
  const form = folha.querySelector('form');

  async function salvar(outro) {
    const nome = form.querySelector('#clNome').value.trim();
    if (!nome) return mostrarErro(form, 'Informe o nome do cliente.');
    const q = novo
      ? supabase.from('clientes').insert({ lar_id: ctx.lar.id, nome })
      : supabase.from('clientes').update({ nome, ativo: form.querySelector('#clAtivo').checked }).eq('id', c.id);
    const { error } = await q;
    if (error) return mostrarErro(form, erroBanco(error));
    toast(novo ? `${nome} adicionado.` : 'Cliente atualizado.');
    if (outro) {
      form.querySelector('#clNome').value = '';
      form.querySelector('.aviso-form')?.remove();
      form.querySelector('#clNome').focus();
      return;
    }
    fecharFolha();
    renderCadastro('clientes', ctx);
  }

  form.addEventListener('submit', (ev) => { ev.preventDefault(); salvar(false); });
  folha.querySelector('#btnSalvarOutro')?.addEventListener('click', async () => {
    await salvar(true);
    renderCadastro('clientes', ctx);
  });
  folha.querySelector('#btnExcluir')?.addEventListener('click', async () => {
    if (!confirm(`Excluir o cliente "${c.nome}"?`)) return;
    const { error } = await supabase.from('clientes').delete().eq('id', c.id);
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Cliente excluído.');
    renderCadastro('clientes', ctx);
  });
}

// =====================================================================
// Categorias
// =====================================================================
async function telaCategorias(ctx) {
  const { data, error } = await supabase.from('categorias').select('*')
    .eq('lar_id', ctx.lar.id).order('ordem').order('nome');
  if (error) throw error;

  const blocos = Object.entries(GRUPOS).map(([g, info]) => {
    const lista = data.filter((c) => c.grupo === g);
    return `
      <section class="cartao lista">
        <div class="lista-cab">
          <h2 class="lista-titulo">${esc(info.nome)}</h2>
          <span class="item-tag ${info.classe}">${esc(info.dizimo)}</span>
        </div>
        ${lista.map((c) => `
          <button class="item ${c.ativa ? '' : 'inativo'}" type="button" data-id="${esc(c.id)}">
            <span class="item-texto"><strong>${esc(c.nome)}</strong>${c.ativa ? '' : '<small>Desativada</small>'}</span>
            ${ICONE_SETA}
          </button>`).join('') || '<p class="lista-vazia">Nenhuma categoria neste grupo.</p>'}
      </section>`;
  }).join('');

  ctx.el.innerHTML = `
    ${voltar()}
    <p class="intro">O grupo de cada categoria define o dízimo: Renda Empresa entra na base, Despesas da Empresa são deduzidas e o resto fica fora.</p>
    ${blocos}
    <button class="btn btn-primario btn-largo" type="button" id="btnNova">Adicionar categoria</button>`;

  ctx.el.querySelector('#btnNova').addEventListener('click', () => formCategoria(ctx, null));
  ctx.el.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => formCategoria(ctx, data.find((c) => c.id === b.dataset.id))));
}

function formCategoria(ctx, c) {
  const nova = !c;
  const opcoes = Object.entries(GRUPOS).map(([g, i]) =>
    `<option value="${g}" ${c?.grupo === g ? 'selected' : ''}>${esc(i.nome)} (${i.tipo === 'entrada' ? 'entrada' : 'saída'}) · ${esc(i.dizimo)}</option>`).join('');
  const folha = abrirFolha(nova ? 'Nova categoria' : 'Editar categoria', `
    <form class="form" novalidate>
      <div class="campo"><label for="catNome">Nome</label><input id="catNome" value="${esc(c?.nome || '')}" placeholder="Ex.: Academia" required></div>
      <div class="campo"><label for="catGrupo">Grupo</label><select id="catGrupo">${opcoes}</select></div>
      ${nova ? '' : `<label class="check"><input type="checkbox" id="catAtiva" ${c.ativa ? 'checked' : ''}><span>Categoria ativa</span></label>`}
      ${c?.padrao ? '<small class="ajuda">Categoria padrão: pode renomear, mudar de grupo ou desativar, mas não excluir.</small>' : ''}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        ${!nova && !c.padrao ? '<button class="btn btn-perigo" type="button" id="btnExcluir">Excluir</button>' : ''}
      </div>
    </form>`);
  const form = folha.querySelector('form');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.querySelector('#catNome').value.trim();
    const grupo = form.querySelector('#catGrupo').value;
    if (!nome) return mostrarErro(form, 'Informe o nome da categoria.');
    const reg = { nome, grupo, tipo: GRUPOS[grupo].tipo };
    if (!nova) reg.ativa = form.querySelector('#catAtiva').checked;
    const q = nova
      ? supabase.from('categorias').insert({ ...reg, lar_id: ctx.lar.id })
      : supabase.from('categorias').update(reg).eq('id', c.id);
    const { error } = await q;
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(nova ? 'Categoria adicionada.' : 'Categoria atualizada.');
    renderCadastro('categorias', ctx);
  });

  folha.querySelector('#btnExcluir')?.addEventListener('click', async () => {
    if (!confirm(`Excluir a categoria "${c.nome}"?`)) return;
    const { error } = await supabase.from('categorias').delete().eq('id', c.id);
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Categoria excluída.');
    renderCadastro('categorias', ctx);
  });
}

// =====================================================================
// Pessoas da casa
// =====================================================================
async function telaPessoas(ctx) {
  const { data, error } = await supabase.rpc('listar_pessoas');
  if (error) throw error;
  const souDono = ctx.lar.papel === 'dono';
  const eu = data.membros.find((m) => m.voce);

  ctx.el.innerHTML = `
    ${voltar()}
    <p class="intro">Todos do lar veem e lançam as mesmas finanças, e o app registra quem lançou cada coisa. ${souDono ? 'Só você, como dono, convida e remove pessoas.' : 'Convites e remoções são feitos pelo dono do lar.'}</p>

    <section class="cartao lista">
      <h2 class="lista-titulo">Pessoas no lar</h2>
      ${data.membros.map((m) => `
        <div class="item item-fixo">
          <span class="item-texto">
            <strong>${esc(m.nome || m.email)}${m.voce ? ' (você)' : ''}</strong>
            <small>${esc(m.email)} · ${m.papel === 'dono' ? 'Dono' : 'Membro'}</small>
          </span>
          ${m.voce ? '<button class="btn btn-secundario btn-mini" type="button" id="btnMeuNome">Meu nome</button>' : ''}
          ${souDono && !m.voce && m.papel === 'membro' ? `<button class="btn btn-perigo btn-mini" type="button" data-remover="${esc(m.user_id)}" data-nome="${esc(m.nome || m.email)}">Remover</button>` : ''}
        </div>`).join('')}
    </section>

    ${data.convites.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Convites pendentes</h2>
        ${data.convites.map((c) => `
          <div class="item item-fixo">
            <span class="item-texto"><strong>${esc(c.nome || c.email)}</strong><small>${esc(c.email)} · aguardando criar a conta</small></span>
            ${souDono ? `
              <button class="btn btn-secundario btn-mini" type="button" data-msg="${esc(c.id)}">Mensagem</button>
              <button class="btn btn-perigo btn-mini" type="button" data-cancelar="${esc(c.id)}">Cancelar</button>` : ''}
          </div>`).join('')}
      </section>` : ''}

    ${souDono ? '<button class="btn btn-primario btn-largo" type="button" id="btnConvidar">Convidar pessoa</button>' : ''}`;

  ctx.el.querySelector('#btnMeuNome')?.addEventListener('click', () => {
    const folha = abrirFolha('Seu nome', `
      <form class="form" novalidate>
        <div class="campo"><label for="pNome">Como você quer aparecer nos lançamentos</label><input id="pNome" value="${esc(eu?.nome || '')}" required></div>
        <div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar</button></div>
      </form>`);
    const form = folha.querySelector('form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const { error: e } = await supabase.rpc('atualizar_meu_nome', { p_nome: form.querySelector('#pNome').value });
      if (e) return mostrarErro(form, erroBanco(e));
      fecharFolha();
      toast('Nome atualizado.');
      await ctx.recarregarInfo();
      renderCadastro('pessoas', ctx);
    });
  });

  ctx.el.querySelector('#btnConvidar')?.addEventListener('click', () => formConvite(ctx));

  ctx.el.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => {
    const c = data.convites.find((x) => x.id === b.dataset.msg);
    abrirMensagem(ctx, c.nome, c.email);
  }));

  ctx.el.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Cancelar este convite?')) return;
    const { error: e } = await supabase.rpc('cancelar_convite', { p_convite: b.dataset.cancelar });
    if (e) { toast(erroBanco(e)); return; }
    toast('Convite cancelado.');
    renderCadastro('pessoas', ctx);
  }));

  ctx.el.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Remover ${b.dataset.nome} do lar? A pessoa perde o acesso na hora. Os lançamentos dela continuam guardados.`)) return;
    const { error: e } = await supabase.rpc('remover_membro', { p_user: b.dataset.remover });
    if (e) { toast(erroBanco(e)); return; }
    toast('Pessoa removida.');
    renderCadastro('pessoas', ctx);
  }));
}

function formConvite(ctx) {
  const folha = abrirFolha('Convidar pessoa', `
    <form class="form" novalidate>
      <div class="campo"><label for="iNome">Nome</label><input id="iNome" placeholder="Ex.: Poliana"></div>
      <div class="campo"><label for="iEmail">E-mail</label><input id="iEmail" type="email" inputmode="email" placeholder="email@exemplo.com" required></div>
      <small class="ajuda">A pessoa cria a conta com este e-mail e entra direto no seu lar.</small>
      <div class="acoes-form"><button class="btn btn-primario" type="submit">Convidar</button></div>
    </form>`);
  const form = folha.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.querySelector('#iNome').value.trim();
    const email = form.querySelector('#iEmail').value.trim().toLowerCase();
    if (!email.includes('@')) return mostrarErro(form, 'Informe o e-mail.');
    const { data, error } = await supabase.rpc('convidar_membro', { p_email: email, p_nome: nome });
    if (error) return mostrarErro(form, erroBanco(error));
    if (data && data.ligado) {
      fecharFolha();
      toast(`${nome || email} já tinha conta e entrou no lar.`);
      renderCadastro('pessoas', ctx);
      return;
    }
    renderCadastro('pessoas', ctx);
    abrirMensagem(ctx, nome, email);
  });
}

function abrirMensagem(ctx, nome, email) {
  const texto = mensagemConvite({ nome, lar: ctx.lar.nome, email });
  const folha = abrirFolha('Envie o convite', `
    <p class="ajuda" style="margin:0">Mande esta mensagem para ${esc(nome || email)}:</p>
    <pre class="msg-convite">${esc(texto)}</pre>
    <div class="acoes-form">
      <a class="btn btn-primario" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
      <button class="btn btn-secundario" type="button" id="btnCopiar">Copiar mensagem</button>
    </div>`);
  folha.querySelector('#btnCopiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(texto); toast('Mensagem copiada.'); }
    catch { toast('Não foi possível copiar. Selecione o texto e copie.'); }
  });
}

// =====================================================================
// Dízimo e dados do lar
// =====================================================================
async function telaLar(ctx) {
  const lar = ctx.info.lar;
  const souDono = lar.papel === 'dono';
  const { data: cats, error } = await supabase.from('categorias').select('nome, grupo, ativa')
    .eq('lar_id', lar.id).in('grupo', ['renda_empresa', 'despesa_empresa']).eq('ativa', true).order('ordem');
  if (error) throw error;
  const nomes = (g) => cats.filter((c) => c.grupo === g).map((c) => esc(c.nome)).join(', ') || 'nenhuma';
  const pct = Number(lar.dizimo_percentual);

  ctx.el.innerHTML = `
    ${voltar()}
    <section class="cartao">
      <form class="form" id="formLar" novalidate>
        <div class="campo"><label for="lNome">Nome do lar</label><input id="lNome" value="${esc(lar.nome)}" ${souDono ? '' : 'disabled'}></div>
        <label class="check"><input type="checkbox" id="lDizimo" ${lar.dizimo_ativo ? 'checked' : ''} ${souDono ? '' : 'disabled'}><span>Calcular o dízimo todo mês</span></label>
        <div class="campo"><label for="lPct">Percentual do dízimo (%)</label><input id="lPct" inputmode="decimal" value="${esc(fmtNumero(pct).replace(/,00$/, ''))}" ${souDono ? '' : 'disabled'}></div>
        ${souDono ? '<div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar</button></div>' : '<small class="ajuda">Só o dono do lar altera estas configurações.</small>'}
      </form>
    </section>

    <section class="cartao regra">
      <h2>Como o dízimo é calculado</h2>
      <p class="formula">${esc(fmtNumero(pct).replace(/,00$/, ''))}% × (Renda Empresa − Despesas da Empresa)</p>
      <p><strong>Entra na base:</strong> ${nomes('renda_empresa')}.</p>
      <p><strong>É deduzido:</strong> ${nomes('despesa_empresa')}.</p>
      <p>Outras Rendas, transferências, recebimentos de cliente e ajustes ficam fora. Se a base do mês ficar negativa, o dízimo é zero. O valor é recalculado a cada lançamento a partir da Etapa 5.</p>
      <a class="btn btn-secundario" href="#/mais/categorias">Ajustar categorias</a>
    </section>`;

  const form = ctx.el.querySelector('#formLar');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.querySelector('#lNome').value.trim();
    const p = parseMoeda(form.querySelector('#lPct').value);
    if (!nome) return mostrarErro(form, 'Informe o nome do lar.');
    if (Number.isNaN(p) || p < 0 || p > 100) return mostrarErro(form, 'Percentual deve ficar entre 0 e 100.');
    const { error: e } = await supabase.rpc('salvar_config_lar', {
      p_nome: nome, p_dizimo_ativo: form.querySelector('#lDizimo').checked, p_percentual: p
    });
    if (e) return mostrarErro(form, erroBanco(e));
    toast('Configurações salvas.');
    await ctx.recarregarInfo();
    ctx.lar = ctx.info.lar;
    renderCadastro('lar', ctx);
  });
}
