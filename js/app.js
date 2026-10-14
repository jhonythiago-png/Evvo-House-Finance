// =====================================================================
// Evvo House Finance — app principal (Etapa 0)
// Login, verificação de acesso do lar e navegação entre as telas.
// =====================================================================
import { supabase, enderecoDoApp } from './supabase.js';
import { APP_VERSAO } from './config.js';

const raiz = document.getElementById('app');

const estado = {
  sessao: null,
  info: null,            // resposta de meu_lar()
  modoLogin: 'entrar',   // entrar | criar | esqueci
  recuperando: false,    // abriu pelo link de "esqueci a senha"
  avisoLogin: null       // { tipo: 'erro' | 'ok', texto }
};
let rotaSeq = 0;
let navegacaoLigada = false;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function dataBR(iso) {
  if (!iso) return 'Sem vencimento';
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

function traduzirErro(erro) {
  const msg = (erro && (erro.message || erro.error_description || String(erro))) || '';
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (m.includes('user already registered')) return 'Este e-mail já tem conta. Use "Entrar".';
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Digite um e-mail válido.';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (m.includes('same password') || m.includes('different from the old')) return 'A nova senha precisa ser diferente da atual.';
  return 'Não foi possível concluir: ' + msg;
}

function tituloMarca(textoApoio) {
  return `
    <section class="acesso-marca">
      <div class="marca">
        <img src="./icons/icon.svg" alt="">
        <div>
          <div class="marca-nome">Evvo</div>
          <div class="marca-sub">House Finance</div>
        </div>
      </div>
      <p>${esc(textoApoio)}</p>
    </section>`;
}

function avisoHTML(aviso) {
  if (!aviso) return '';
  return `<div class="aviso aviso-${aviso.tipo}" role="${aviso.tipo === 'erro' ? 'alert' : 'status'}">${esc(aviso.texto)}</div>`;
}

function limparUrlAuth() {
  const h = window.location.hash;
  if (h.includes('access_token') || h.includes('type=') || h.includes('error')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Erros que o Supabase devolve na URL (ex.: link de e-mail vencido).
function lerErroDaUrl() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const codigo = p.get('error_code') || p.get('error');
  if (!codigo) return null;
  if (codigo === 'otp_expired') return 'Esse link expirou ou já foi usado. Peça um novo abaixo.';
  return 'O link não pôde ser usado (' + codigo + '). Tente de novo.';
}

// ---------------------------------------------------------------------
// Ícones (traço simples, cor do texto)
// ---------------------------------------------------------------------
const ICONE = {
  inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>',
  contas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  lancar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  relatorios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};

const TELAS = {
  inicio: {
    nome: 'Início',
    vazio: { titulo: 'Seu resumo do mês aparece aqui', texto: 'Saldo das contas, dízimo do mês, contas a pagar e dinheiro com clientes.', etapa: 'Etapa 5' }
  },
  contas: {
    nome: 'Contas',
    vazio: { titulo: 'Contas do mês', texto: 'Despesas fixas geradas todo mês, faturas e pagamentos divididos entre contas e clientes.', etapa: 'Etapa 4' }
  },
  lancar: {
    nome: 'Novo lançamento',
    vazio: { titulo: 'Lançar entradas, saídas e transferências', texto: 'Lançamento rápido pelo celular, com cliente e conta em cada entrada.', etapa: 'Etapa 3' }
  },
  relatorios: {
    nome: 'Relatórios',
    vazio: { titulo: 'Gráficos e relatórios', texto: 'Comparativos mensal e anual, gastos por grupo, renda por cliente, impressão e PDF.', etapa: 'Etapa 7' }
  },
  mais: { nome: 'Mais' }
};
const ORDEM_NAV = ['inicio', 'contas', 'lancar', 'relatorios', 'mais'];

// ---------------------------------------------------------------------
// Fluxo de acesso
// ---------------------------------------------------------------------
async function rotear() {
  const minha = ++rotaSeq;

  if (!estado.sessao) {
    renderLogin();
    return;
  }

  // Se o Painel Master convidou este e-mail, liga a conta ao lar antes de verificar.
  try { await supabase.rpc('aceitar_convites'); } catch (e) { /* segue mesmo sem convite */ }
  if (minha !== rotaSeq) return;

  const { data, error } = await supabase.rpc('meu_lar');
  if (minha !== rotaSeq) return;

  if (error) {
    renderErroServidor(error);
    return;
  }

  estado.info = data;
  limparUrlAuth();

  if (!data || !data.lar) renderAguardando();
  else if (!data.lar.tem_acesso) renderBloqueado();
  else renderApp();
}

// ---------------------------------------------------------------------
// Tela: login / criar conta / esqueci a senha
// ---------------------------------------------------------------------
function renderLogin() {
  const modo = estado.modoLogin;
  const titulos = {
    entrar: 'Entrar',
    criar: 'Criar conta',
    esqueci: 'Recuperar senha'
  };
  const textos = {
    entrar: 'Use o e-mail e a senha da sua conta.',
    criar: 'Depois de criar, confirme pelo link que vai chegar no seu e-mail.',
    esqueci: 'Enviamos um link para você criar uma senha nova.'
  };

  raiz.innerHTML = `
    <div class="acesso">
      ${tituloMarca('Evolução financeira dentro de casa.')}
      <main class="acesso-corpo">
        <form class="cartao-acesso" id="formLogin" novalidate>
          <h1>${titulos[modo]}</h1>
          <p class="texto">${textos[modo]}</p>
          ${avisoHTML(estado.avisoLogin)}
          <div class="campo">
            <label for="email">E-mail</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" required>
          </div>
          ${modo !== 'esqueci' ? `
          <div class="campo">
            <label for="senha">Senha</label>
            <input id="senha" type="password" autocomplete="${modo === 'criar' ? 'new-password' : 'current-password'}" minlength="6" required>
          </div>` : ''}
          ${modo === 'criar' ? `
          <div class="campo">
            <label for="senha2">Repita a senha</label>
            <input id="senha2" type="password" autocomplete="new-password" minlength="6" required>
          </div>` : ''}
          <button class="btn btn-primario" type="submit" id="btnEnviar">
            ${modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Enviar link'}
          </button>
          <div class="links-acesso">
            ${modo !== 'entrar' ? '<button type="button" class="btn-link" data-modo="entrar">Já tenho conta</button>' : ''}
            ${modo !== 'criar' ? '<button type="button" class="btn-link" data-modo="criar">Criar conta</button>' : ''}
            ${modo !== 'esqueci' ? '<button type="button" class="btn-link" data-modo="esqueci">Esqueci a senha</button>' : ''}
          </div>
        </form>
      </main>
    </div>`;

  raiz.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    estado.modoLogin = b.dataset.modo;
    estado.avisoLogin = null;
    renderLogin();
  }));

  const form = document.getElementById('formLogin');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const senha = document.getElementById('senha')?.value || '';
    const senha2 = document.getElementById('senha2')?.value || '';
    const botao = document.getElementById('btnEnviar');

    if (!email) { mostrarAvisoLogin('erro', 'Digite seu e-mail.'); return; }
    if (modo !== 'esqueci' && senha.length < 6) { mostrarAvisoLogin('erro', 'A senha precisa ter pelo menos 6 caracteres.'); return; }
    if (modo === 'criar' && senha !== senha2) { mostrarAvisoLogin('erro', 'As duas senhas não são iguais.'); return; }

    botao.disabled = true;
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        estado.avisoLogin = null;
        // onAuthStateChange chama rotear()
      } else if (modo === 'criar') {
        const { data, error } = await supabase.auth.signUp({
          email, password: senha, options: { emailRedirectTo: enderecoDoApp() }
        });
        if (error) throw error;
        if (data.session) {
          estado.avisoLogin = null;
        } else {
          estado.modoLogin = 'entrar';
          mostrarAvisoLogin('ok', 'Conta criada. Abra o e-mail que enviamos para ' + email + ' e toque no link de confirmação. Depois é só entrar.');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: enderecoDoApp() });
        if (error) throw error;
        estado.modoLogin = 'entrar';
        mostrarAvisoLogin('ok', 'Se existir uma conta com ' + email + ', o link para criar uma senha nova já foi enviado.');
      }
    } catch (erro) {
      mostrarAvisoLogin('erro', traduzirErro(erro));
    } finally {
      const b = document.getElementById('btnEnviar');
      if (b) b.disabled = false;
    }
  });
}

function mostrarAvisoLogin(tipo, texto) {
  const email = document.getElementById('email')?.value || '';
  estado.avisoLogin = { tipo, texto };
  renderLogin();
  const campo = document.getElementById('email');
  if (campo) campo.value = email;
}

// ---------------------------------------------------------------------
// Tela: nova senha (aberta pelo link de recuperação)
// ---------------------------------------------------------------------
function renderNovaSenha(aviso) {
  raiz.innerHTML = `
    <div class="acesso">
      ${tituloMarca('Evolução financeira dentro de casa.')}
      <main class="acesso-corpo">
        <form class="cartao-acesso" id="formSenha" novalidate>
          <h1>Criar senha nova</h1>
          <p class="texto">Escolha uma senha com pelo menos 6 caracteres.</p>
          ${avisoHTML(aviso)}
          <div class="campo">
            <label for="nova1">Senha nova</label>
            <input id="nova1" type="password" autocomplete="new-password" minlength="6" required>
          </div>
          <div class="campo">
            <label for="nova2">Repita a senha nova</label>
            <input id="nova2" type="password" autocomplete="new-password" minlength="6" required>
          </div>
          <button class="btn btn-primario" type="submit" id="btnSenha">Salvar senha nova</button>
        </form>
      </main>
    </div>`;

  document.getElementById('formSenha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const s1 = document.getElementById('nova1').value;
    const s2 = document.getElementById('nova2').value;
    if (s1.length < 6) { renderNovaSenha({ tipo: 'erro', texto: 'A senha precisa ter pelo menos 6 caracteres.' }); return; }
    if (s1 !== s2) { renderNovaSenha({ tipo: 'erro', texto: 'As duas senhas não são iguais.' }); return; }
    document.getElementById('btnSenha').disabled = true;
    const { error } = await supabase.auth.updateUser({ password: s1 });
    if (error) { renderNovaSenha({ tipo: 'erro', texto: traduzirErro(error) }); return; }
    estado.recuperando = false;
    limparUrlAuth();
    rotear();
  });
}

// ---------------------------------------------------------------------
// Tela: aguardando liberação / bloqueado / erro
// ---------------------------------------------------------------------
function telaAviso(titulo, texto, extra = '') {
  const email = estado.info?.email || estado.sessao?.user?.email || '';
  raiz.innerHTML = `
    <div class="acesso">
      ${tituloMarca('Evolução financeira dentro de casa.')}
      <main class="acesso-corpo">
        <div class="cartao-acesso">
          <h1>${esc(titulo)}</h1>
          <p class="texto">${texto}</p>
          ${extra}
          <div class="lista-info cartao">
            <div><span>Conta</span><span>${esc(email)}</span></div>
          </div>
          <button class="btn btn-secundario" type="button" id="btnVerificar">Verificar de novo</button>
          <button class="btn-link" type="button" id="btnSair">Sair desta conta</button>
        </div>
      </main>
    </div>`;
  document.getElementById('btnVerificar').addEventListener('click', () => rotear());
  document.getElementById('btnSair').addEventListener('click', sair);
}

function renderAguardando() {
  telaAviso(
    'Aguardando liberação',
    'Sua conta foi criada, mas ainda não está ligada a nenhum lar. Assim que o acesso for liberado, toque em "Verificar de novo".'
  );
}

function renderBloqueado() {
  const lar = estado.info.lar;
  const vencido = lar.situacao !== 'bloqueado';
  telaAviso(
    'Acesso bloqueado',
    vencido
      ? 'O acesso do lar ' + esc(lar.nome) + ' venceu em ' + esc(dataBR(lar.acesso_ate)) + '. Renove para voltar a usar. Seus dados continuam guardados.'
      : 'O acesso do lar ' + esc(lar.nome) + ' está bloqueado. Fale com o suporte para liberar. Seus dados continuam guardados.'
  );
}

function renderErroServidor(erro) {
  raiz.innerHTML = `
    <div class="acesso">
      ${tituloMarca('Evolução financeira dentro de casa.')}
      <main class="acesso-corpo">
        <div class="cartao-acesso">
          <h1>Não foi possível abrir</h1>
          ${avisoHTML({ tipo: 'erro', texto: traduzirErro(erro) })}
          <button class="btn btn-primario" type="button" id="btnTentar">Tentar de novo</button>
          <button class="btn-link" type="button" id="btnSair">Sair desta conta</button>
        </div>
      </main>
    </div>`;
  document.getElementById('btnTentar').addEventListener('click', () => rotear());
  document.getElementById('btnSair').addEventListener('click', sair);
}

// ---------------------------------------------------------------------
// App logado
// ---------------------------------------------------------------------
function telaAtual() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return TELAS[id] ? id : 'inicio';
}

function renderApp() {
  const lar = estado.info.lar;
  const atual = telaAtual();
  if (!window.location.hash.startsWith('#/')) history.replaceState(null, '', '#/' + atual);

  raiz.innerHTML = `
    <div class="app">
      <div class="area">
        <header class="topo">
          <div class="topo-marca">
            <img src="./icons/icon.svg" alt="">
            <div style="min-width:0">
              <div class="topo-titulo" id="tituloTela">${esc(TELAS[atual].nome)}</div>
              <div class="topo-lar">${esc(lar.nome)}</div>
            </div>
          </div>
        </header>
        <main class="conteudo" id="conteudo"></main>
      </div>
      <nav class="nav" aria-label="Menu principal">
        ${ORDEM_NAV.map((id) => id === 'lancar'
          ? `<a href="#/lancar" class="nav-lancar" data-tela="lancar" aria-label="Novo lançamento"><span class="bola">${ICONE.lancar}</span><span class="rotulo">Novo lançamento</span></a>`
          : `<a href="#/${id}" data-tela="${id}">${ICONE[id]}<span>${esc(TELAS[id].nome)}</span></a>`
        ).join('')}
      </nav>
    </div>`;

  if (!navegacaoLigada) {
    window.addEventListener('hashchange', () => {
      if (estado.info?.lar?.tem_acesso && document.getElementById('conteudo')) renderTela();
    });
    navegacaoLigada = true;
  }
  renderTela();
}

function renderTela() {
  const atual = telaAtual();
  document.getElementById('tituloTela').textContent = TELAS[atual].nome;
  document.title = TELAS[atual].nome + ' · Evvo House Finance';
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.tela === atual) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const conteudo = document.getElementById('conteudo');
  if (atual === 'mais') {
    conteudo.innerHTML = telaMais();
    document.getElementById('btnSair').addEventListener('click', sair);
  } else {
    const v = TELAS[atual].vazio;
    conteudo.innerHTML = `
      <section class="cartao vazio">
        <span class="selo">Chega na ${esc(v.etapa)}</span>
        <h2>${esc(v.titulo)}</h2>
        <p>${esc(v.texto)}</p>
      </section>`;
  }
  window.scrollTo(0, 0);
}

function telaMais() {
  const info = estado.info;
  const lar = info.lar;
  const planos = { teste: 'Teste grátis', familia: 'Família', familia_empresa: 'Família + Empresa', master: 'Master' };
  return `
    <section class="cartao">
      <h2 style="font-size:18px;margin-bottom:8px">Seu lar</h2>
      <div class="lista-info">
        <div><span>Lar</span><span>${esc(lar.nome)}</span></div>
        <div><span>Plano</span><span>${esc(planos[lar.plano] || lar.plano)}</span></div>
        <div><span>Acesso até</span><span>${esc(dataBR(lar.acesso_ate))}</span></div>
        <div><span>Seu papel</span><span>${lar.papel === 'dono' ? 'Dono' : 'Membro'}</span></div>
        <div><span>Conta</span><span>${esc(info.email)}</span></div>
      </div>
    </section>
    ${info.eh_super ? `
    <section class="cartao vazio">
      <h2>Painel Master</h2>
      <p>Crie lares, envie convites, libere, bloqueie e estenda acessos.</p>
      <a class="btn btn-primario" href="./master.html">Abrir Painel Master</a>
    </section>` : ''}
    <button class="btn btn-secundario" type="button" id="btnSair">Sair desta conta</button>
    <p style="text-align:center;color:var(--suave);font-size:12px;margin:4px 0 0">Evvo House Finance · versão ${esc(APP_VERSAO)}</p>`;
}

async function sair() {
  await supabase.auth.signOut();
  estado.info = null;
  estado.modoLogin = 'entrar';
  estado.avisoLogin = null;
  history.replaceState(null, '', window.location.pathname);
  renderLogin();
}

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
async function iniciar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Link de "esqueci a senha": mostra a tela de senha nova em vez do app.
  if (window.location.hash.includes('type=recovery')) estado.recuperando = true;

  const erroUrl = lerErroDaUrl();
  if (erroUrl) {
    estado.avisoLogin = { tipo: 'erro', texto: erroUrl };
    estado.modoLogin = 'esqueci';
    limparUrlAuth();
  }

  supabase.auth.onAuthStateChange((evento, sessao) => {
    estado.sessao = sessao;
    // Chamadas ao Supabase fora do callback, para não travar a sessão.
    setTimeout(() => {
      if (evento === 'PASSWORD_RECOVERY') {
        estado.recuperando = true;
        renderNovaSenha();
      } else if ((evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') && !estado.recuperando) {
        rotear();
      }
    }, 0);
  });

  const { data } = await supabase.auth.getSession();
  estado.sessao = data.session;
  if (estado.recuperando && estado.sessao) renderNovaSenha();
  else {
    estado.recuperando = false;
    rotear();
  }
}

iniciar();
