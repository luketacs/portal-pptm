// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Aprovação do Fundo Fixo pelo Teams sem licença Premium: o portal manda um card
// pro fluxo do Power Automate (gatilho gratuito "Quando uma solicitação de webhook do
// Teams for recebida"), que só posta o card no chat privado do gestor do setor. Os
// botões do card abrem a página pública /publico/fundo-fixo/decisao com um token
// próprio da solicitação, e é lá que o gestor confirma. Depois da decisão o portal manda
// outro card pelo mesmo fluxo confirmando. Passo a passo em docs/FUNDO-FIXO-TEAMS.md.

import { createHash, randomBytes } from 'crypto';

// Quem aprova depende do setor. 'Outros' não tem gestor fixo: só vai pro Teams se a
// solicitação já vier com gestor_aprovador preenchido; senão fica com o Admin no portal.
// Precisa ficar em sincronia com FUNDO_FIXO_GESTOR_POR_SETOR em src/services/fundo-fixo.service.ts
export const GESTOR_POR_SETOR = {
  'Operação': 'João Nunes',
  'Manutenção': 'Italo Rosse',
  'Infraestrutura': 'Italo Rosse',
};

// E-mail (conta do Teams) de cada gestor fica em variável de ambiente, não no código.
const ENV_EMAIL_GESTOR = {
  'João Nunes': 'FUNDO_FIXO_EMAIL_JOAO',
  'Italo Rosse': 'FUNDO_FIXO_EMAIL_ITALO',
};

export const TOKEN_VALIDADE_DIAS = 15;

// Endereço do portal nos links do card. Não usa ALLOWED_ORIGINS (o padrão de lá,
// portalpptm.com, não resolve) nem o host da requisição (pode ser um deploy de preview).
export function portalUrl(env = process.env) {
  return (env.FUNDO_FIXO_PORTAL_URL || 'https://portalpptm.vercel.app').replace(/\/+$/, '');
}

export function gestorDaSolicitacao(row) {
  return GESTOR_POR_SETOR[row.setor] ?? (ENV_EMAIL_GESTOR[row.gestor_aprovador] ? row.gestor_aprovador : null);
}

export function emailDoGestor(gestor, env = process.env) {
  const chave = ENV_EMAIL_GESTOR[gestor];
  return chave ? (env[chave] || '').trim() || null : null;
}

// O token vai só no link do card; no banco fica o hash (quem lê a tabela não
// consegue montar o link).
export function gerarToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function tokenValido(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function brl(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}

// Adaptive Card montado aqui (e não no fluxo) porque colar texto livre — material com
// aspas, quebra de linha — dentro do JSON do card no Power Automate quebra o card. O
// fluxo só repassa com string(triggerBody()?['card']).
function dataBr(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Faixa do topo: "FUNDO FIXO" + título, num container destacado.
function cabecalho(rotulo, titulo, cor = 'Default') {
  return {
    type: 'Container', style: 'emphasis', bleed: true,
    items: [
      { type: 'TextBlock', text: rotulo, size: 'Small', weight: 'Bolder', color: 'Accent', spacing: 'None', wrap: true },
      { type: 'TextBlock', text: titulo, size: 'Large', weight: 'Bolder', color: cor, wrap: true, maxLines: 3, spacing: 'Small' },
    ],
  };
}

function colunaInfo(rotulo, valor, destaque = false) {
  return {
    type: 'Column', width: 'stretch',
    items: [
      { type: 'TextBlock', text: rotulo, size: 'Small', isSubtle: true, spacing: 'None', wrap: true },
      destaque
        ? { type: 'TextBlock', text: valor, size: 'ExtraLarge', weight: 'Bolder', color: 'Accent', spacing: 'None', wrap: true }
        : { type: 'TextBlock', text: valor, weight: 'Bolder', spacing: 'None', wrap: true },
    ],
  };
}

const SCHEMA = { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4' };

export function montarCardSolicitacao(row, baseUrl, token) {
  const facts = [{ title: 'Solicitante', value: row.solicitante_nome }];
  if (row.fornecedor) facts.push({ title: 'Fornecedor', value: row.fornecedor });
  facts.push({ title: 'Solicitado em', value: dataBr(row.data_solicitacao) });

  const links = (row.link_produto || '').split(/\s+/).filter(l => /^https?:\/\//i.test(l))
    .map((l, i) => `🔗 [Produto ${i + 1}](${l})`);
  if (row.orcamento_url) links.push(`📎 [Orçamento](${row.orcamento_url})`);

  const body = [
    cabecalho('💰 FUNDO FIXO · APROVAÇÃO DE COMPRA', row.material),
    {
      type: 'ColumnSet', spacing: 'Medium',
      columns: [colunaInfo('Valor estimado', brl(row.valor_estimado), true), colunaInfo('Setor', row.setor)],
    },
    { type: 'FactSet', facts, spacing: 'Medium', separator: true },
  ];
  if (row.observacoes) {
    body.push({ type: 'TextBlock', text: `📝 ${row.observacoes}`, wrap: true, isSubtle: true, spacing: 'Small' });
  }
  if (links.length) body.push({ type: 'TextBlock', text: links.join('   '), wrap: true, spacing: 'Small' });
  body.push({
    type: 'TextBlock', text: 'Os botões abrem o portal pra você conferir e confirmar.',
    size: 'Small', isSubtle: true, wrap: true, spacing: 'Medium',
  });

  const url = d => `${baseUrl}/publico/fundo-fixo/decisao?t=${token}&d=${d}`;
  return {
    ...SCHEMA,
    body,
    actions: [
      { type: 'Action.OpenUrl', title: '✅ Aprovar', style: 'positive', url: url('aprovar') },
      { type: 'Action.OpenUrl', title: '❌ Recusar', style: 'destructive', url: url('recusar') },
    ],
  };
}

export function montarCardConfirmacao(row, aprovado, comentario) {
  const body = [
    cabecalho(
      '💰 FUNDO FIXO',
      aprovado ? '✅ Aprovação registrada' : '❌ Recusa registrada',
      aprovado ? 'Good' : 'Attention',
    ),
    { type: 'TextBlock', text: row.material, weight: 'Bolder', wrap: true, maxLines: 3, spacing: 'Medium' },
    {
      type: 'FactSet', spacing: 'Small',
      facts: [
        { title: 'Solicitante', value: row.solicitante_nome },
        { title: 'Valor', value: brl(row.valor_estimado) },
      ],
    },
  ];
  if (comentario) {
    body.push({ type: 'TextBlock', text: `${aprovado ? 'Comentário' : 'Motivo'}: ${comentario}`, isSubtle: true, wrap: true });
  }
  return { ...SCHEMA, body };
}

export function interpretarDecisao(body) {
  const token = body?.token;
  if (!tokenValido(token)) return { erro: 'Link inválido.' };
  const d = String(body?.decisao ?? '').trim().toLowerCase();
  if (d !== 'aprovar' && d !== 'recusar') return { erro: 'Decisão inválida.' };
  const comentario = String(body?.comentario ?? '').trim().slice(0, 1000);
  return { token, aprovado: d === 'aprovar', comentario };
}
