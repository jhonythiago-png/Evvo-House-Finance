// =====================================================================
// Evvo House Finance — Ajuda
// Guia de uso do sistema, da instalação aos avisos no WhatsApp.
// =====================================================================
import { esc } from './util.js';

const VOLTAR = '<a class="voltar" href="#/mais"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Mais</a>';

// Cada seção: id (usado em links #/mais/ajuda/<id>), título e conteúdo em HTML simples.
const SECOES = [
  {
    id: 'comecar', titulo: 'Primeiros passos',
    html: `
      <p>O Evvo House Finance organiza o dinheiro da casa: o que entra, o que sai, as contas do mês, o dízimo e o saldo de cada conta, tudo calculado sozinho.</p>
      <p><strong>Ordem recomendada para começar:</strong></p>
      <ol>
        <li><strong>Minhas contas</strong> (Mais › Minhas contas): cadastre cada banco e o dinheiro em espécie com o saldo real de um dia de corte.</li>
        <li><strong>Clientes</strong>: quem paga a renda do seu trabalho.</li>
        <li><strong>Categorias</strong>: confira as que já vêm prontas e ajuste o que precisar.</li>
        <li><strong>Despesas fixas</strong> (Contas › Despesas fixas): aluguel, escola, plano de saúde, internet…</li>
        <li><strong>Pessoas da casa</strong>: convide quem também vai usar.</li>
        <li><strong>Avisos no WhatsApp</strong>: para receber lembrete das contas a vencer.</li>
      </ol>
      <p>Depois disso, o dia a dia é lançar pelo botão <strong>+</strong> e pagar as contas pela aba <strong>Contas</strong>.</p>`
  },
  {
    id: 'instalar', titulo: 'Instalar o app no celular e no computador',
    html: `
      <p>O app funciona no navegador, mas instalado fica com ícone na tela inicial e abre em tela cheia, como um aplicativo.</p>
      <p><strong>Android (Chrome):</strong> abra o endereço do app, toque no menu <strong>⋮</strong> no canto de cima e escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</p>
      <p><strong>iPhone (Safari):</strong> abra o endereço no <strong>Safari</strong> (não funciona em outros navegadores do iPhone), toque em <strong>Compartilhar</strong> (quadrado com seta para cima) e depois em <strong>Adicionar à Tela de Início</strong>.</p>
      <p><strong>Computador (Chrome ou Edge):</strong> clique no ícone de instalar que aparece no fim da barra de endereço, ou no menu › <strong>Instalar Evvo House Finance</strong>.</p>
      <p><strong>Atualizações:</strong> chegam sozinhas. Se algo parecer antigo, feche o app e abra de novo. A versão aparece no fim da tela Mais.</p>`
  },
  {
    id: 'contas', titulo: 'Minhas contas e saldo inicial',
    html: `
      <p>Cada conta (banco, carteira, dinheiro) tem um <strong>saldo inicial</strong> e a <strong>data</strong> desse saldo. A partir dele o app calcula o saldo sozinho.</p>
      <p><strong>Regra importante:</strong> o saldo inicial vale para o <strong>fim do dia</strong> informado. Só os lançamentos com data <strong>depois</strong> desse dia mudam o saldo. Exemplo: saldo inicial em 30/09 → lance a partir de 01/10.</p>
      <p>Saldo negativo (cheque especial) se informa com o sinal de menos: <em>-2.478,41</em>.</p>
      <p>Conta que não usa mais? Desmarque <strong>Conta ativa</strong> em vez de excluir: o histórico continua certo.</p>`
  },
  {
    id: 'lancar', titulo: 'Lançar entradas, saídas e transferências',
    html: `
      <p>Toque no botão <strong>+</strong> e escolha o tipo.</p>
      <p><strong>Entrada:</strong> escolha a categoria, <strong>quem pagou</strong> (cliente) e <strong>onde está o dinheiro</strong>: na conta em que caiu, ou <strong>"Ficou com o cliente"</strong>, quando ele ainda vai repassar.</p>
      <p><strong>Saída:</strong> para gastos do dia a dia (Pix, mercado, dinheiro). Dá para <strong>dividir</strong> entre contas: a primeira se ajusta sozinha com o que sobra.</p>
      <p><strong>Transferência:</strong> dinheiro que mudou de conta. Não conta como renda, despesa nem dízimo.</p>
      <p><strong>Mês de referência:</strong> o mês a que o lançamento pertence, quando é diferente da data. Ex.: serviço de outubro pago em novembro.</p>
      <p>Use <strong>Salvar e lançar outro</strong> para lançar vários seguidos. Para corrigir ou excluir, toque no lançamento na lista do Início.</p>`
  },
  {
    id: 'contas-mes', titulo: 'Contas do mês, despesas fixas e faturas',
    html: `
      <p><strong>Despesas fixas</strong> (Contas › Despesas fixas) geram uma conta por mês no dia do vencimento. Marque <strong>"Valor muda todo mês"</strong> para água, luz e parecidos.</p>
      <p><strong>Corrigir o valor:</strong> toque no nome da conta. Escolha <strong>Só este mês</strong> (a água veio maior) ou <strong>Este e os próximos</strong> (reajuste do aluguel).</p>
      <p><strong>Faturas de cartão:</strong> use <strong>Conta a pagar</strong> e lance o valor total quando a fatura fechar. Se a fatura tiver gasto da empresa, lance essa parte como outra conta com categoria da empresa (assim o dízimo deduz certo).</p>
      <p><strong>Pagar:</strong> toque em <strong>Pagar</strong>, escolha de onde saiu o dinheiro (pode dividir) e a data. Pagamento menor que o valor fica como <strong>Parcial</strong>. Dá para apagar um pagamento ou <strong>desfazer todos</strong>.</p>
      <p>Contas vencidas e não pagas aparecem com uma faixa vermelha.</p>
      <p><strong>Importante:</strong> pague as contas fixas sempre pela aba Contas. O botão + é só para gastos do dia a dia; usar os dois para a mesma conta duplica a saída.</p>`
  },
  {
    id: 'clientes', titulo: 'Dinheiro com clientes',
    html: `
      <p>Quando você lança uma entrada como <strong>"Ficou com o cliente"</strong>, o valor vira <strong>saldo a receber</strong> desse cliente. A renda já conta no mês e no dízimo, mas não entra em nenhum banco.</p>
      <p><strong>Cliente pagou uma conta sua:</strong> em Contas › Pagar (ou numa saída), escolha o cliente no grupo <strong>"Saldo com cliente"</strong>. Sai do saldo dele, sem contar de novo como renda.</p>
      <p><strong>Cliente repassou o restante:</strong> no Início, toque em <strong>Dinheiro seu com clientes</strong> › <strong>Receber</strong> e escolha a conta onde caiu.</p>
      <p>O app não deixa usar mais do que o saldo do cliente.</p>`
  },
  {
    id: 'dizimo', titulo: 'Dízimo',
    html: `
      <p>O dízimo é calculado sozinho: <strong>percentual × (Renda Empresa − Despesas da Empresa)</strong> do mês.</p>
      <p>O que entra ou sai da conta depende do <strong>grupo da categoria</strong> (Mais › Categorias):</p>
      <ul>
        <li><strong>Renda Empresa:</strong> entra na base.</li>
        <li><strong>Despesas da Empresa:</strong> é deduzida.</li>
        <li><strong>Outras Rendas, Despesas da Casa, transferências e ajustes:</strong> ficam fora.</li>
      </ul>
      <p>Uma renda que não é do trabalho mas que você dizima (ex.: restituição de imposto) deve ter uma categoria no grupo <strong>Renda Empresa</strong>.</p>
      <p>A conta <strong>Dízimo</strong> aparece em Contas todo mês. Se você pagar e depois entrar mais renda, ela fica <strong>Parcial</strong> com a diferença a pagar.</p>
      <p>Percentual e liga/desliga: Mais › Dízimo e dados do lar.</p>`
  },
  {
    id: 'conferir', titulo: 'Conferir com o banco e fechar o mês',
    html: `
      <p>Em Mais › <strong>Conferência e fechamento</strong>, escolha o dia, abra o extrato de cada conta e digite o saldo real. O app mostra na hora se <strong>bateu</strong> ou a diferença.</p>
      <p>Antes de ajustar, procure lançamentos esquecidos: quase sempre a diferença é um Pix ou gasto que ficou sem lançar.</p>
      <p>O <strong>ajuste</strong> deixa o saldo igual ao banco, mas não conta como renda, despesa nem dízimo.</p>
      <p><strong>Fechar o mês</strong> trava tudo daquele mês. Para corrigir algo depois, é só <strong>Reabrir</strong>.</p>`
  },
  {
    id: 'relatorios', titulo: 'Relatórios, PDF e Excel',
    html: `
      <p><strong>Mensal:</strong> entradas, saídas, resultado, dízimo, para onde foi o dinheiro (por grupo e categoria) e renda por cliente.</p>
      <p><strong>Anual:</strong> gráfico mês a mês, comparação com o ano anterior, tabela do ano e maiores gastos.</p>
      <p><strong>Imprimir / PDF:</strong> gera o relatório em A4. No celular, escolha <strong>Salvar como PDF</strong> na tela de impressão.</p>
      <p><strong>Exportar Excel:</strong> baixa uma planilha com abas de entradas, saídas, categorias e clientes, com os valores prontos para somar.</p>`
  },
  {
    id: 'pessoas', titulo: 'Pessoas da casa',
    html: `
      <p>O dono do lar convida em Mais › <strong>Pessoas da casa</strong> › Convidar pessoa. O app gera uma mensagem pronta para mandar pelo WhatsApp.</p>
      <p>A pessoa cria a conta com o <strong>mesmo e-mail</strong> do convite e entra direto no lar.</p>
      <p>Todos lançam e veem as mesmas finanças, e o app mostra quem lançou cada coisa. Só o dono convida, remove pessoas, muda o dízimo e configura os avisos.</p>`
  },
  {
    id: 'whatsapp', titulo: 'Avisos no WhatsApp (CallMeBot): instalar e configurar',
    html: `
      <p>O app manda no WhatsApp, nos horários que você escolher, as contas <strong>não pagas</strong>: as que <strong>já venceram</strong> (até 60 dias), as que vencem <strong>hoje</strong> e as de <strong>amanhã</strong>. Se não houver nenhuma, nenhuma mensagem é enviada naquele horário. O envio é feito pela <strong>CallMeBot</strong>, um serviço gratuito. Cada pessoa precisa ativar a CallMeBot no próprio celular uma vez.</p>
      <p><strong>Passo a passo (uma vez por celular):</strong></p>
      <ol>
        <li>Abra o site <strong>callmebot.com</strong> e entre na página <strong>"Free WhatsApp API"</strong>. Lá aparece o <strong>número atual da CallMeBot</strong> (ele muda de tempos em tempos, por isso confira sempre no site).</li>
        <li>Salve esse número nos contatos do celular, com o nome que quiser (ex.: <em>CallMeBot</em>).</li>
        <li>Abra o WhatsApp e mande para esse contato a mensagem, exatamente assim, em inglês:<br><code>I allow callmebot to send me messages</code></li>
        <li>Em alguns segundos (às vezes alguns minutos) chega a resposta: <strong>"CallMeBot API Activated for 55…"</strong> e <strong>"Your apikey is: …"</strong>.</li>
        <li>Guarde dois dados dessa resposta: o <strong>número que aparece depois de "Activated for"</strong> e a <strong>apikey</strong>.</li>
      </ol>
      <p><strong>No app:</strong> Mais › <strong>Avisos no WhatsApp</strong> › <strong>Adicionar pessoa</strong>. Preencha o nome, o WhatsApp e a apikey, salve e toque em <strong>Testar</strong>.</p>
      <p><strong>Atenção ao número:</strong> use o número <strong>exatamente como veio na resposta da CallMeBot</strong>. Muitas contas de WhatsApp antigas aparecem <strong>sem o 9</strong> da frente (ex.: 55 44 8437-3004). Se cadastrar com o 9 e a CallMeBot ativou sem, a mensagem não chega.</p>
      <p><strong>Horários:</strong> na mesma tela, escolha até 3 horários por dia (de 15 em 15 minutos) e toque em <strong>Salvar horários</strong>.</p>
      <p><strong>Outros cuidados:</strong></p>
      <ul>
        <li>A apikey é ligada ao <strong>número</strong>, não ao app. Se outro aplicativo seu já usa a CallMeBot no mesmo celular, a chave é a mesma.</li>
        <li>Mandar <strong>Stop</strong> para a CallMeBot pausa todos os envios; <strong>Resume</strong> volta a ativar.</li>
        <li>A CallMeBot às vezes demora alguns minutos. Em <strong>Últimos envios</strong> você vê se a mensagem foi aceita.</li>
        <li>Quando a conta é marcada como paga no app, ela sai dos lembretes.</li>
      </ul>`
  },
  {
    id: 'duvidas', titulo: 'Dúvidas frequentes',
    html: `
      <p><strong>Lancei e o saldo da conta não mudou.</strong> A data do lançamento é igual ou anterior ao saldo inicial da conta. Ele aparece no mês, mas não muda o saldo (o app avisa com uma etiqueta amarela).</p>
      <p><strong>Não consigo salvar nem excluir um lançamento.</strong> O mês está fechado. Reabra em Mais › Conferência e fechamento.</p>
      <p><strong>A conta fixa apareceu duas vezes.</strong> Ela foi lançada pelo botão + e também gerada como fixa. Exclua uma delas (na fixa, use "Excluir só deste mês").</p>
      <p><strong>O dízimo não bateu com a minha conta.</strong> Confira o grupo das categorias em Mais › Categorias: é o grupo que decide o que entra e o que é deduzido.</p>
      <p><strong>O app parece desatualizado.</strong> Feche e abra de novo. A versão aparece no fim da tela Mais.</p>
      <p><strong>Esqueci a senha.</strong> Na tela de entrar, toque em <strong>Esqueci a senha</strong> e siga o link que chega no e-mail.</p>
      <p><strong>O WhatsApp não chegou.</strong> Confira em Avisos › Últimos envios. Se aparecer "Falhou", confira o número (com ou sem o 9, igual à CallMeBot) e a apikey.</p>`
  }
];

export async function telaAjuda(ctx) {
  const abrir = (window.location.hash.split('/')[3] || '').trim();

  ctx.el.innerHTML = `
    ${VOLTAR}
    <div class="campo ajuda-busca">
      <label for="buscaAjuda" class="sr-only">Buscar na ajuda</label>
      <input id="buscaAjuda" type="search" placeholder="Buscar na ajuda (ex.: dízimo, fatura, instalar)" autocomplete="off">
    </div>
    <div class="ajuda-lista" id="ajudaLista">
      ${SECOES.map((s) => `
        <details class="cartao ajuda-secao" id="ajuda-${esc(s.id)}" ${s.id === abrir ? 'open' : ''}>
          <summary>${esc(s.titulo)}</summary>
          <div class="ajuda-corpo">${s.html}</div>
        </details>`).join('')}
    </div>
    <p class="lista-vazia" id="ajudaVazia" hidden>Nada encontrado. Tente outra palavra.</p>`;

  if (abrir) {
    const alvo = ctx.el.querySelector(`#ajuda-${CSS.escape(abrir)}`);
    if (alvo) setTimeout(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const normalizar = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const textos = SECOES.map((s) => normalizar(s.titulo + ' ' + s.html.replace(/<[^>]+>/g, ' ')));
  ctx.el.querySelector('#buscaAjuda').addEventListener('input', (e) => {
    const termo = normalizar(e.target.value.trim());
    let visiveis = 0;
    SECOES.forEach((s, i) => {
      const el = ctx.el.querySelector(`#ajuda-${s.id}`);
      const ok = !termo || textos[i].includes(termo);
      el.hidden = !ok;
      el.open = !!termo && ok;
      if (ok) visiveis++;
    });
    ctx.el.querySelector('#ajudaVazia').hidden = visiveis > 0;
  });
}
