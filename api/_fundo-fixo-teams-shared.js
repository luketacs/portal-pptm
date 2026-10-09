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

export function resumoSolicitacao(row) {
  return `${row.solicitante_nome} — ${row.material.slice(0, 80)} (${brl(row.valor_estimado)})`;
}

// Adaptive Card montado aqui (e não no fluxo) porque colar texto livre — material com
// aspas, quebra de linha — dentro do JSON do card no Power Automate quebra o card. O
// fluxo só repassa com string(triggerBody()?['card']).
export function montarCardSolicitacao(row, portalUrl, token) {
  const facts = [
    { title: 'Solicitante', value: row.solicitante_nome },
    { title: 'Setor', value: row.setor },
    { title: 'Material', value: row.material },
    { title: 'Valor estimado', value: brl(row.valor_estimado) },
  ];
  if (row.fornecedor) facts.push({ title: 'Fornecedor', value: row.fornecedor });
  if (row.observacoes) facts.push({ title: 'Observações', value: row.observacoes });

  const links = (row.link_produto || '').split(/\s+/).filter(l => /^https?:\/\//i.test(l))
    .map((l, i) => `[Produto ${i + 1}](${l})`);
  if (row.orcamento_url) links.push(`[Orçamento](${row.orcamento_url})`);

  const body = [
    { type: 'TextBlock', text: 'Fundo Fixo — aprovação de compra', weight: 'Bolder', size: 'Medium', wrap: true },
    { type: 'FactSet', facts },
  ];
  if (links.length) body.push({ type: 'TextBlock', text: links.join(' · '), wrap: true });
  body.push({ type: 'TextBlock', text: 'Os botões abrem o portal pra você confirmar.', isSubtle: true, size: 'Small', wrap: true });

  const url = d => `${portalUrl}/publico/fundo-fixo/decisao?t=${token}&d=${d}`;
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    actions: [
      { type: 'Action.OpenUrl', title: 'Aprovar', style: 'positive', url: url('aprovar') },
      { type: 'Action.OpenUrl', title: 'Recusar', style: 'destructive', url: url('recusar') },
    ],
  };
}

export function montarCardConfirmacao(row, aprovado, comentario) {
  const body = [
    {
      type: 'TextBlock', weight: 'Bolder', wrap: true, color: aprovado ? 'Good' : 'Attention',
      text: aprovado ? '✅ Aprovação registrada no portal' : '❌ Recusa registrada no portal',
    },
    { type: 'TextBlock', text: `Fundo Fixo: ${resumoSolicitacao(row)}`, wrap: true },
  ];
  if (comentario) body.push({ type: 'TextBlock', text: `Comentário: ${comentario}`, isSubtle: true, wrap: true });
  return { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4', body };
}

export function interpretarDecisao(body) {
  const token = body?.token;
  if (!tokenValido(token)) return { erro: 'Link inválido.' };
  const d = String(body?.decisao ?? '').trim().toLowerCase();
  if (d !== 'aprovar' && d !== 'recusar') return { erro: 'Decisão inválida.' };
  const comentario = String(body?.comentario ?? '').trim().slice(0, 1000);
  return { token, aprovado: d === 'aprovar', comentario };
}
