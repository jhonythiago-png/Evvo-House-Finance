// =====================================================================
// Evvo House Finance — utilidades compartilhadas
// =====================================================================

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// R$ 1.234,56 (negativo com sinal de menos)
export function fmtMoeda(v) {
  const n = Number(v || 0);
  const txt = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '− R$ ' : 'R$ ') + txt;
}

// 1.234,56 (para preencher campos)
export function fmtNumero(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aceita "1.234,56", "1234,56", "1234.56", "-2.478,41", "R$ 10". Devolve NaN se inválido.
export function parseMoeda(texto) {
  let s = String(texto ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return NaN;
  const negativo = /^[-−]/.test(s);
  s = s.replace(/^[-−]/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return Math.round((negativo ? -n : n) * 100) / 100;
}

export function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// Data de hoje (Brasília) no formato AAAA-MM-DD
export function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Erros do banco em linguagem simples.
export function erroBanco(e) {
  const msg = (e && (e.message || e.details)) || String(e || '');
  const m = msg.toLowerCase();
  if (e && e.code === '23505' || m.includes('duplicate key')) return 'Já existe um cadastro com esse nome.';
  if (e && e.code === '23503' || m.includes('foreign key')) return 'Não dá para excluir porque já está sendo usado. Desative em vez de excluir.';
  if (m.includes('row-level security') || (e && e.code === '42501' && !msg.match(/[áéíóúãõç]/i))) return 'Sem permissão para fazer isso. Verifique se o acesso do lar está liberado.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (m.includes('could not find the function')) return 'Função não encontrada no banco. Confira se a última migration foi aplicada.';
  return msg;
}

// ---------------------------------------------------------------------
// Folha (janela que sobe de baixo no celular e aparece no centro no computador)
// ---------------------------------------------------------------------
let folhaAtual = null;
let focoAnterior = null;

export function abrirFolha(titulo, corpoHTML) {
  fecharFolha();
  focoAnterior = document.activeElement;
  const fundo = document.createElement('div');
  fundo.className = 'folha-fundo';
  fundo.innerHTML = `
    <div class="folha" role="dialog" aria-modal="true" aria-labelledby="folhaTitulo">
      <div class="folha-cab">
        <h2 id="folhaTitulo">${esc(titulo)}</h2>
        <button type="button" class="folha-fechar" aria-label="Fechar">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="folha-corpo">${corpoHTML}</div>
    </div>`;
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fecharFolha(); });
  fundo.querySelector('.folha-fechar').addEventListener('click', fecharFolha);
  document.addEventListener('keydown', escFecha);
  document.body.appendChild(fundo);
  document.body.classList.add('com-folha');
  folhaAtual = fundo;
  const primeiro = fundo.querySelector('input, select, textarea, button:not(.folha-fechar)');
  if (primeiro) setTimeout(() => primeiro.focus(), 50);
  return fundo.querySelector('.folha');
}

function escFecha(e) { if (e.key === 'Escape') fecharFolha(); }

export function fecharFolha() {
  if (!folhaAtual) return;
  folhaAtual.remove();
  folhaAtual = null;
  document.body.classList.remove('com-folha');
  document.removeEventListener('keydown', escFecha);
  if (focoAnterior && document.contains(focoAnterior)) focoAnterior.focus();
}

// Aviso dentro da folha ou de um container.
export function mostrarErro(container, texto) {
  let el = container.querySelector('.aviso-form');
  if (!el) {
    el = document.createElement('div');
    el.className = 'aviso aviso-erro aviso-form';
    el.setAttribute('role', 'alert');
    container.prepend(el);
  }
  el.textContent = texto;
}

// Mensagem rápida no rodapé.
export function toast(texto) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('saindo'), 2200);
  setTimeout(() => t.remove(), 2600);
}

// Mensagem de convite para entrar no lar.
export function mensagemConvite({ nome, lar, email }) {
  const url = new URL('./', window.location.href).href;
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  return `${saudacao} Você foi convidado para o lar "${lar}" no Evvo House Finance.\n\n` +
    `1. Abra: ${url}\n` +
    `2. Toque em "Criar conta" e use o e-mail ${email}\n` +
    `3. Confirme pelo link que vai chegar no seu e-mail e entre no app.\n\n` +
    `No celular, dá para instalar o app pela opção "Adicionar à tela de início".`;
}
