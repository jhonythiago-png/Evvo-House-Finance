// =====================================================================
// Evvo House Finance — Painel Master (Etapa 1)
// Criar lares, convidar responsáveis, liberar, bloquear, estender e trocar plano.
// Todas as ações passam por funções no banco que conferem se é super admin.
// =====================================================================
import { supabase } from './supabase.js';
import { APP_VERSAO } from './config.js';

const raiz = document.getElementById('master');

const PLANOS = {
  teste: 'Teste grátis',
  familia: 'Família',
  familia_empresa: 'Família + Empresa',
  master: 'Master'
};
const ESTADOS = {
  ativo: 'Ativo',
  teste: 'Em teste',
  vencido: 'Vencido',
  bloqueado: 'Bloqueado'
};

const est = {
  email: '',
  lares: [],
  atividades: [],
  filtro: 'todos',      // todos | ativo | teste | vencendo | parados
  busca: '',
  criando: false,
  convite: null,        // { lar, email, nome }
  aviso: null,          // { tipo, texto }
  ocupado: false
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function dataHoraBR(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function enderecoApp() {
  return new URL('./', window.location.href).href;
}

function mensagemErro(erro) {
  const msg = (erro && erro.message) || String(erro || '');
  if (msg.toLowerCase().includes('failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (msg.includes('Could not find the function')) return 'As funções do painel não foram encontradas. Rode a migration 002 no Supabase.';
  return msg;
}

function textoAcesso(l) {
  if (!l.acesso_ate) return { texto: 'Sem vencimento', classe: '' };
  const d = l.dias_restantes;
  const data = dataBR(l.acesso_ate);
  if (d < 0) return { texto: `Venceu em ${data} (há ${-d} ${-d === 1 ? 'dia' : 'dias'})`, classe: 'txt-alerta' };
  if (d === 0) return { texto: `Vence hoje (${data})`, classe: 'txt-atencao' };
  if (d <= 7) return { texto: `Até ${data} (faltam ${d} ${d === 1 ? 'dia' : 'dias'})`, classe: 'txt-atencao' };
  return { texto: `Até ${data} (faltam ${d} dias)`, classe: '' };
}

function mensagemConvite(c) {
  const saudacao = c.nome ? `Olá, ${c.nome}!` : 'Olá!';
  return `${saudacao} Seu acesso ao Evvo House Finance foi liberado para o lar "${c.lar}".\n\n` +
    `1. Abra: ${enderecoApp()}\n` +
    `2. Toque em "Criar conta" e use o e-mail ${c.email}\n` +
    `3. Confirme pelo link que vai chegar no seu e-mail e entre no app.\n\n` +
    `No celular, dá para instalar o app pela opção "Adicionar à tela de início".`;
}

function contar() {
  const c = { ativo: 0, teste: 0, vencendo: 0, parados: 0 };
  est.lares.forEach((l) => {
    if (l.estado === 'ativo') c.ativo++;
    if (l.estado === 'teste') c.teste++;
    if ((l.estado === 'ativo' || l.estado === 'teste') && l.dias_restantes !== null && l.dias_restantes <= 7) c.vencendo++;
    if (l.estado === 'vencido' || l.estado === 'bloqueado') c.parados++;
  });
  return c;
}

function laresFiltrados() {
  const busca = est.busca.trim().toLowerCase();
  return est.lares.filter((l) => {
    if (est.filtro === 'ativo' && l.estado !== 'ativo') return false;
    if (est.filtro === 'teste' && l.estado !== 'teste') return false;
    if (est.filtro === 'vencendo' && !((l.estado === 'ativo' || l.estado === 'teste') && l.dias_restantes !== null && l.dias_restantes <= 7)) return false;
    if (est.filtro === 'parados' && !(l.estado === 'vencido' || l.estado === 'bloqueado')) return false;
    if (!busca) return true;
    return [l.nome, l.dono_email, l.dono_nome, l.convite_email, l.convite_nome]
      .some((v) => (v || '').toLowerCase().includes(busca));
  });
}

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------
async function carregar() {
  const [r1, r2] = await Promise.all([
    supabase.rpc('master_listar_lares'),
    supabase.rpc('master_atividades', { p_limite: 50 })
  ]);
  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
  est.lares = r1.data || [];
  est.atividades = r2.data || [];
}

async function executar(fn, sucesso) {
  if (est.ocupado) return;
  est.ocupado = true;
  try {
    const { data, error } = await fn();
    if (error) throw error;
    await carregar();
    est.aviso = { tipo: 'ok', texto: typeof sucesso === 'function' ? sucesso(data) : sucesso };
  } catch (e) {
    est.aviso = { tipo: 'erro', texto: mensagemErro(e) };
  } finally {
    est.ocupado = false;
    render();
  }
}

// ---------------------------------------------------------------------
// Telas de acesso
// ---------------------------------------------------------------------
function telaSimples(titulo, texto, botoes) {
  raiz.innerHTML = `
    <div class="acesso">
      <section class="acesso-marca">
        <div class="marca">
          <img src="./icons/icon.svg" alt="">
          <div><div class="marca-nome">Evvo</div><div class="marca-sub">Painel Master</div></div>
        </div>
        <p>Liberação de acessos do Evvo House Finance.</p>
      </section>
      <main class="acesso-corpo">
        <div class="cartao-acesso">
          <h1>${esc(titulo)}</h1>
          <p class="texto">${texto}</p>
          ${botoes}
        </div>
      </main>
    </div>`;
}

// ---------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------
function render() {
  const c = contar();
  const lista = laresFiltrados();

  raiz.innerHTML = `
    <header class="m-topo">
      <div class="m-topo-interno">
        <div class="marca">
          <img src="./icons/icon.svg" alt="">
          <div><div class="marca-nome">Evvo House</div><div class="marca-sub">Painel Master</div></div>
        </div>
        <div class="m-topo-acoes">
          <span class="email">${esc(est.email)}</span>
          <a class="m-btn-claro" href="./">Abrir o app</a>
          <button class="m-btn-claro" type="button" data-acao="sair">Sair</button>
        </div>
      </div>
    </header>

    <main class="m-conteudo">
      ${est.aviso ? `<div class="aviso aviso-${est.aviso.tipo}" role="${est.aviso.tipo === 'erro' ? 'alert' : 'status'}">${esc(est.aviso.texto)}</div>` : ''}

      <section class="m-resumo" aria-label="Resumo dos lares">
        <button class="m-kpi" type="button" data-filtro="ativo" aria-pressed="${est.filtro === 'ativo'}"><span>Lares ativos</span><strong>${c.ativo}</strong></button>
        <button class="m-kpi" type="button" data-filtro="teste" aria-pressed="${est.filtro === 'teste'}"><span>Em teste</span><strong>${c.teste}</strong></button>
        <button class="m-kpi ambar" type="button" data-filtro="vencendo" aria-pressed="${est.filtro === 'vencendo'}"><span>Vencendo em 7 dias</span><strong>${c.vencendo}</strong></button>
        <button class="m-kpi vermelho" type="button" data-filtro="parados" aria-pressed="${est.filtro === 'parados'}"><span>Vencidos ou bloqueados</span><strong>${c.parados}</strong></button>
      </section>

      ${est.convite ? caixaConvite() : ''}
      ${est.criando ? formNovoLar() : ''}

      <section class="m-barra">
        <div class="campo">
          <label for="busca">Buscar lar, nome ou e-mail</label>
          <input id="busca" type="search" value="${esc(est.busca)}" autocomplete="off">
        </div>
        <div class="campo campo-filtro">
          <label for="filtro">Mostrar</label>
          <select id="filtro">
            <option value="todos" ${est.filtro === 'todos' ? 'selected' : ''}>Todos os lares</option>
            <option value="ativo" ${est.filtro === 'ativo' ? 'selected' : ''}>Ativos</option>
            <option value="teste" ${est.filtro === 'teste' ? 'selected' : ''}>Em teste</option>
            <option value="vencendo" ${est.filtro === 'vencendo' ? 'selected' : ''}>Vencendo em 7 dias</option>
            <option value="parados" ${est.filtro === 'parados' ? 'selected' : ''}>Vencidos ou bloqueados</option>
          </select>
        </div>
        ${est.criando ? '' : '<button class="btn btn-primario" type="button" data-acao="novo">Novo lar</button>'}
      </section>

      <section class="m-lista" aria-label="Lares">
        ${lista.length ? lista.map(cartaoLar).join('') : `<p class="m-vazio-lista">${est.lares.length ? 'Nenhum lar com esse filtro.' : 'Nenhum lar cadastrado ainda. Toque em "Novo lar" para criar o primeiro.'}</p>`}
      </section>

      <section class="cartao">
        <div class="m-caixa-titulo"><h2>Registro de atividades</h2></div>
        <div class="m-atividades">
          ${est.atividades.length ? est.atividades.map((a) => `
            <div class="m-atv">
              <time datetime="${esc(a.criado_em)}">${esc(dataHoraBR(a.criado_em))}</time>
              <div>
                <strong>${esc(a.acao)}</strong>${a.lar_nome ? ` · ${esc(a.lar_nome)}` : ''}
                <small>${esc(a.autor_email)}${a.detalhe ? ' — ' + esc(a.detalhe) : ''}</small>
              </div>
            </div>`).join('') : '<p class="m-vazio-lista">Nada registrado ainda.</p>'}
        </div>
      </section>

      <p style="text-align:center;color:var(--suave);font-size:12px;margin:0">Evvo House Finance · versão ${esc(APP_VERSAO)}</p>
    </main>`;

  ligarEventos();
}

function cartaoLar(l) {
  const acesso = textoAcesso(l);
  const ehMaster = l.plano === 'master';
  const responsavel = l.dono_email
    ? `${l.dono_nome ? esc(l.dono_nome) + ' · ' : ''}${esc(l.dono_email)}`
    : (l.convite_email ? `<span class="chip chip-convite">Convite pendente</span> ${esc(l.convite_email)}` : '<span class="txt-alerta">Sem responsável</span>');

  return `
    <article class="m-lar">
      <div class="m-lar-cab">
        <h3>${esc(l.nome)}</h3>
        <span class="chip chip-${ehMaster ? 'master' : esc(l.estado)}">${ehMaster ? 'Master' : esc(ESTADOS[l.estado] || l.estado)}</span>
      </div>
      <div class="m-lar-info">
        <div><span>Responsável</span><span>${responsavel}</span></div>
        <div><span>Acesso</span><span class="${acesso.classe}">${esc(acesso.texto)}</span></div>
        <div>
          <span>Plano</span>
          <select data-plano="${esc(l.id)}" aria-label="Plano do lar ${esc(l.nome)}">
            ${Object.entries(PLANOS).map(([v, n]) => `<option value="${v}" ${l.plano === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="m-lar-acoes">
        ${l.convite_email ? `
          <button class="btn btn-secundario" type="button" data-acao="ver-convite" data-id="${esc(l.id)}">Mensagem de convite</button>
          <button class="btn btn-secundario" type="button" data-acao="corrigir" data-id="${esc(l.id)}">Corrigir e-mail</button>` : ''}
        ${l.acesso_ate ? `<button class="btn btn-secundario" type="button" data-acao="estender" data-id="${esc(l.id)}">+30 dias</button>` : ''}
        ${ehMaster ? '' : (l.estado === 'bloqueado'
          ? `<button class="btn btn-primario" type="button" data-acao="liberar" data-id="${esc(l.id)}">Liberar</button>`
          : (l.estado === 'vencido'
            ? `<button class="btn btn-primario" type="button" data-acao="liberar" data-id="${esc(l.id)}">Renovar 30 dias</button>`
            : `<button class="btn btn-perigo" type="button" data-acao="bloquear" data-id="${esc(l.id)}">Bloquear</button>`))}
      </div>
    </article>`;
}

function formNovoLar() {
  return `
    <section class="cartao">
      <div class="m-caixa-titulo"><h2>Novo lar</h2></div>
      <form class="m-form" id="formNovo" novalidate>
        <div class="campo">
          <label for="nNome">Nome do lar</label>
          <input id="nNome" required placeholder="Ex.: Família Souza">
        </div>
        <div class="campo">
          <label for="nResp">Nome do responsável</label>
          <input id="nResp" placeholder="Ex.: Ana Souza">
        </div>
        <div class="campo">
          <label for="nEmail">E-mail do responsável</label>
          <input id="nEmail" type="email" inputmode="email" required placeholder="email@exemplo.com">
        </div>
        <div class="campo">
          <label for="nPlano">Plano</label>
          <select id="nPlano">
            <option value="teste">Teste grátis</option>
            <option value="familia">Família</option>
            <option value="familia_empresa">Família + Empresa</option>
          </select>
        </div>
        <div class="campo">
          <label for="nDias">Dias de acesso</label>
          <input id="nDias" type="number" inputmode="numeric" min="1" max="3650" value="7">
        </div>
        <div class="m-form-acoes">
          <button class="btn btn-primario" type="submit">Criar lar e gerar convite</button>
          <button class="btn btn-secundario" type="button" data-acao="cancelar-novo">Cancelar</button>
        </div>
      </form>
    </section>`;
}

function caixaConvite() {
  const texto = mensagemConvite(est.convite);
  return `
    <section class="cartao m-convite">
      <div class="m-caixa-titulo">
        <h2>Convite para ${esc(est.convite.lar)}</h2>
        <button class="btn-link" type="button" data-acao="fechar-convite">Fechar</button>
      </div>
      <pre id="textoConvite">${esc(texto)}</pre>
      <div class="m-form-acoes">
        <button class="btn btn-primario" type="button" data-acao="copiar-convite">Copiar mensagem</button>
        <a class="btn btn-secundario" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
function acharLar(id) { return est.lares.find((l) => l.id === id); }

function ligarEventos() {
  const busca = document.getElementById('busca');
  busca.addEventListener('input', () => {
    est.busca = busca.value;
    const pos = busca.selectionStart;
    render();
    const b = document.getElementById('busca');
    b.focus();
    b.setSelectionRange(pos, pos);
  });

  document.getElementById('filtro').addEventListener('change', (e) => {
    est.filtro = e.target.value;
    render();
  });

  raiz.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
    est.filtro = est.filtro === b.dataset.filtro ? 'todos' : b.dataset.filtro;
    render();
  }));

  raiz.querySelectorAll('select[data-plano]').forEach((s) => s.addEventListener('change', () => {
    const l = acharLar(s.dataset.plano);
    const novo = s.value;
    if (!confirm(`Trocar o plano de "${l.nome}" de ${PLANOS[l.plano]} para ${PLANOS[novo]}?`)) {
      s.value = l.plano;
      return;
    }
    executar(() => supabase.rpc('master_alterar_plano', { p_lar: l.id, p_plano: novo }),
      `Plano de "${l.nome}" alterado para ${PLANOS[novo]}.`);
  }));

  const form = document.getElementById('formNovo');
  if (form) {
    document.getElementById('nPlano').addEventListener('change', (e) => {
      document.getElementById('nDias').value = e.target.value === 'teste' ? 7 : 30;
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nome = document.getElementById('nNome').value.trim();
      const resp = document.getElementById('nResp').value.trim();
      const email = document.getElementById('nEmail').value.trim().toLowerCase();
      const plano = document.getElementById('nPlano').value;
      const dias = parseInt(document.getElementById('nDias').value, 10) || 0;
      if (!nome) { est.aviso = { tipo: 'erro', texto: 'Informe o nome do lar.' }; render(); return; }
      if (!email.includes('@')) { est.aviso = { tipo: 'erro', texto: 'Informe o e-mail do responsável.' }; render(); return; }
      executar(
        () => supabase.rpc('master_criar_lar', { p_nome: nome, p_email: email, p_nome_resp: resp, p_plano: plano, p_dias: dias }),
        (data) => {
          est.criando = false;
          if (data && data.ligado) {
            est.convite = null;
            return `Lar "${nome}" criado. ${email} já tinha conta e foi ligado ao lar na hora.`;
          }
          est.convite = { lar: nome, email, nome: resp };
          return `Lar "${nome}" criado. Envie a mensagem de convite para ${email}.`;
        }
      );
    });
  }

  raiz.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', async () => {
    const acao = b.dataset.acao;
    const l = b.dataset.id ? acharLar(b.dataset.id) : null;

    if (acao === 'sair') {
      await supabase.auth.signOut();
      window.location.href = './';
    } else if (acao === 'novo') {
      est.criando = true; est.aviso = null; render();
      document.getElementById('nNome').focus();
    } else if (acao === 'cancelar-novo') {
      est.criando = false; render();
    } else if (acao === 'fechar-convite') {
      est.convite = null; render();
    } else if (acao === 'copiar-convite') {
      try {
        await navigator.clipboard.writeText(mensagemConvite(est.convite));
        est.aviso = { tipo: 'ok', texto: 'Mensagem copiada.' };
      } catch {
        est.aviso = { tipo: 'erro', texto: 'Não foi possível copiar. Selecione o texto e copie manualmente.' };
      }
      render();
    } else if (acao === 'ver-convite') {
      est.convite = { lar: l.nome, email: l.convite_email, nome: l.convite_nome };
      est.aviso = null;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (acao === 'corrigir') {
      const novo = prompt(`E-mail correto do responsável por "${l.nome}":`, l.convite_email || '');
      if (!novo || novo.trim().toLowerCase() === l.convite_email) return;
      executar(
        () => supabase.rpc('master_corrigir_convite', { p_lar: l.id, p_email: novo.trim().toLowerCase() }),
        (data) => {
          if (data && data.ligado) { est.convite = null; return `${novo.trim()} já tinha conta e foi ligado a "${l.nome}".`; }
          est.convite = { lar: l.nome, email: novo.trim().toLowerCase(), nome: l.convite_nome };
          return `Convite de "${l.nome}" corrigido. Envie a mensagem nova.`;
        }
      );
    } else if (acao === 'estender') {
      executar(() => supabase.rpc('master_estender', { p_lar: l.id, p_dias: 30 }),
        `Acesso de "${l.nome}" estendido em 30 dias.`);
    } else if (acao === 'bloquear') {
      const motivo = prompt(`Bloquear "${l.nome}"? Os membros param de acessar na hora.\n\nMotivo (opcional):`, '');
      if (motivo === null) return;
      executar(() => supabase.rpc('master_bloquear', { p_lar: l.id, p_motivo: motivo }),
        `"${l.nome}" foi bloqueado.`);
    } else if (acao === 'liberar') {
      executar(() => supabase.rpc('master_liberar', { p_lar: l.id, p_dias: 30 }),
        `"${l.nome}" foi liberado.`);
    }
  }));
}

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
async function iniciar() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    telaSimples('Entre pelo app primeiro',
      'O Painel Master usa o mesmo login do app. Entre com sua conta e depois abra o painel pelo menu Mais.',
      '<a class="btn btn-primario" href="./">Ir para o login</a>');
    return;
  }
  est.email = data.session.user.email;

  const { data: ehSuper, error } = await supabase.rpc('is_super_admin');
  if (error) {
    telaSimples('Não foi possível abrir', esc(mensagemErro(error)),
      '<button class="btn btn-primario" type="button" id="btnRecarregar">Tentar de novo</button>');
    document.getElementById('btnRecarregar').addEventListener('click', () => location.reload());
    return;
  }
  if (!ehSuper) {
    telaSimples('Acesso restrito',
      'Esta área é só para a administração do Evvo House Finance. A conta ' + esc(est.email) + ' não tem permissão.',
      '<a class="btn btn-primario" href="./">Voltar para o app</a>');
    return;
  }

  try {
    await carregar();
  } catch (e) {
    est.aviso = { tipo: 'erro', texto: mensagemErro(e) };
  }
  render();
}

iniciar();
