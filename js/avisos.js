// =====================================================================
// Evvo House Finance — Avisos no WhatsApp
// Quem recebe os lembretes de contas a vencer (10h e 16h) pela CallMeBot.
// =====================================================================
import { supabase } from './supabase.js';
import { esc, erroBanco, abrirFolha, fecharFolha, mostrarErro, toast } from './util.js';

const VOLTAR = '<a class="voltar" href="#/mais"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Mais</a>';

function telefoneBR(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

function quando(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function telaAvisos(ctx) {
  if (ctx.lar.papel !== 'dono') {
    ctx.el.innerHTML = `${VOLTAR}
      <section class="cartao vazio"><h2>Avisos no WhatsApp</h2><p>Só o dono do lar configura quem recebe os lembretes de contas a vencer.</p></section>`;
    return;
  }

  const [r1, r2, r3] = await Promise.all([
    supabase.from('avisos_destinatarios').select('id, nome, telefone, ativo').eq('lar_id', ctx.lar.id).order('nome'),
    supabase.rpc('historico_avisos'),
    supabase.rpc('previa_aviso_whatsapp')
  ]);
  for (const r of [r1, r2, r3]) if (r.error) throw r.error;
  const pessoas = r1.data;
  const historico = r2.data || [];
  const previa = r3.data;

  ctx.el.innerHTML = `
    ${VOLTAR}
    <p class="intro">Todo dia às <strong>10h</strong> e às <strong>16h</strong>, quem estiver aqui recebe no WhatsApp as contas <strong>não pagas</strong> que vencem <strong>amanhã</strong> e <strong>hoje</strong>. Quando a conta é marcada como paga, ela sai dos lembretes.</p>

    <section class="cartao lista">
      <h2 class="lista-titulo">Quem recebe</h2>
      ${pessoas.length ? pessoas.map((p) => `
        <div class="item item-fixo">
          <span class="item-texto">
            <strong>${esc(p.nome)}</strong>
            <small>${esc(telefoneBR(p.telefone))} · ${p.ativo ? 'recebendo' : 'pausado'}</small>
          </span>
          <button class="btn btn-secundario btn-mini" type="button" data-testar="${esc(p.id)}">Testar</button>
          <button class="btn btn-secundario btn-mini" type="button" data-editar="${esc(p.id)}">Editar</button>
        </div>`).join('') : '<p class="lista-vazia">Ninguém cadastrado ainda.</p>'}
    </section>
    <button class="btn btn-primario btn-largo" type="button" id="btnAdd">Adicionar pessoa</button>

    <section class="cartao">
      <h2 class="lista-titulo sem-pad" style="margin-bottom:8px">Mensagem de agora</h2>
      ${previa
        ? `<pre class="msg-convite">${esc(previa)}</pre>`
        : '<p class="ajuda" style="margin:0">Nenhuma conta a pagar vence hoje ou amanhã: nenhum lembrete seria enviado agora.</p>'}
    </section>

    ${historico.length ? `
      <section class="cartao lista">
        <h2 class="lista-titulo">Últimos envios</h2>
        ${historico.map((h) => {
          const ok = h.status >= 200 && h.status < 300;
          const pendente = h.status == null && !h.erro;
          return `
          <div class="item item-fixo">
            <span class="item-texto">
              <strong>${esc(h.nome || 'Removido')}</strong>
              <small>${esc(quando(h.quando))} · ${h.periodo === 'manha' ? 'manhã' : h.periodo === 'tarde' ? 'tarde' : 'teste'}</small>
            </span>
            <span class="item-tag ${ok ? 'tag-verde' : pendente ? 'tag-cinza' : 'tag-vermelho'}">${ok ? 'Enviado' : pendente ? 'Na fila' : 'Falhou'}</span>
          </div>`;
        }).join('')}
      </section>` : ''}

    <details class="cartao ajuda-callmebot">
      <summary>Como pegar a chave da CallMeBot</summary>
      <ol>
        <li>Salve nos contatos do celular o número indicado em <strong>callmebot.com</strong>, na seção WhatsApp.</li>
        <li>Mande para ele, pelo WhatsApp, a mensagem <strong>I allow callmebot to send me messages</strong> (em inglês, exatamente assim).</li>
        <li>Você recebe de volta uma mensagem com a sua <strong>apikey</strong>. É ela que vai no cadastro aqui.</li>
      </ol>
      <p>Se for o mesmo celular que já recebe os avisos do LSR, a chave é a mesma. Cada pessoa precisa da própria chave, ligada ao próprio número.</p>
    </details>`;

  ctx.el.querySelector('#btnAdd').addEventListener('click', () => formPessoa(ctx, null));
  ctx.el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    formPessoa(ctx, pessoas.find((p) => p.id === b.dataset.editar))));
  ctx.el.querySelectorAll('[data-testar]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase.rpc('testar_aviso_whatsapp', { p_id: b.dataset.testar });
    b.disabled = false;
    if (error) { toast(erroBanco(error)); return; }
    toast('Teste enviado. Confira o WhatsApp em alguns segundos.');
    setTimeout(() => telaAvisos(ctx).catch(() => {}), 6000);
  }));
}

function formPessoa(ctx, p) {
  const novo = !p;
  const folha = abrirFolha(novo ? 'Adicionar pessoa' : 'Editar pessoa', `
    <form class="form" novalidate>
      <div class="campo"><label for="aNome">Nome</label><input id="aNome" value="${esc(p?.nome || '')}" placeholder="Ex.: Jhony"></div>
      <div class="campo"><label for="aTel">WhatsApp (com DDD)</label><input id="aTel" inputmode="tel" value="${esc(p ? telefoneBR(p.telefone) : '')}" placeholder="(44) 99999-9999"></div>
      <div class="campo">
        <label for="aKey">Chave (apikey) da CallMeBot</label>
        <input id="aKey" autocomplete="off" placeholder="${novo ? 'Ex.: 1234567' : 'Deixe em branco para manter a chave salva'}">
        <small class="ajuda">A chave fica guardada só no servidor e nunca aparece de novo aqui.</small>
      </div>
      ${novo ? '' : `<label class="check"><input type="checkbox" id="aAtivo" ${p.ativo ? 'checked' : ''}><span>Recebendo os lembretes</span></label>`}
      <div class="acoes-form">
        <button class="btn btn-primario" type="submit">Salvar</button>
        ${novo ? '' : '<button class="btn btn-perigo" type="button" id="btnRemover">Remover</button>'}
      </div>
    </form>`);
  const form = folha.querySelector('form');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await supabase.rpc('salvar_destinatario_aviso', {
      p_id: p?.id || null,
      p_nome: form.querySelector('#aNome').value,
      p_telefone: form.querySelector('#aTel').value,
      p_apikey: form.querySelector('#aKey').value,
      p_ativo: novo ? true : form.querySelector('#aAtivo').checked
    });
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast(novo ? 'Pessoa adicionada. Use "Testar" para conferir.' : 'Dados atualizados.');
    telaAvisos(ctx).catch((e) => toast(erroBanco(e)));
  });

  folha.querySelector('#btnRemover')?.addEventListener('click', async () => {
    if (!confirm(`Parar de enviar lembretes para ${p.nome} e remover?`)) return;
    const { error } = await supabase.rpc('remover_destinatario_aviso', { p_id: p.id });
    if (error) return mostrarErro(form, erroBanco(error));
    fecharFolha();
    toast('Removido.');
    telaAvisos(ctx).catch((e) => toast(erroBanco(e)));
  });
}
