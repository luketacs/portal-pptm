// Serverless function: as duas ações do formulário público do Fundo Fixo (sem login),
// num arquivo só — dispatcha por `body.action` ('upload-url' | 'request', default
// 'request'). Juntadas pra não estourar o limite de 12 Serverless Functions por
// deployment do plano Hobby da Vercel (cada arquivo em api/ conta como uma function
// separada) — duas rotas pequenas e do mesmo formulário, sem motivo pra ficarem em
// arquivos/deploys separados.
//
// 'request' cria a solicitação de compra em si. É a única forma de gravar sem sessão —
// o RLS da tabela (auth.uid() IS NOT NULL) continua bloqueando insert anônimo direto no
// banco; aqui a validação de quem pode escrever o quê é feita nesta function, com os
// mesmos limites usados no formulário interno.
//
// 'upload-url' gera uma signed upload URL para o anexo de orçamento. O upload do
// arquivo em si acontece direto do navegador pro Supabase Storage usando essa URL
// assinada — não passa pelo corpo desta function, então não esbarra no limite de
// payload do Vercel. O token assinado autoriza o upload sozinho, então a política do
// bucket continua só permitindo INSERT autenticado — ninguém anônimo ganha acesso de
// escrita direta.
//
// 'teams-notificar' manda a solicitação pendente pro fluxo do Power Automate, que posta
// o card de aprovação no chat do Teams do gestor do setor. Chamada aqui mesmo depois do
// 'request' e pelo portal depois de criar pelo formulário interno. Não precisa de login:
// só envia uma vez por solicitação (teams_enviado_em) e só se ainda estiver pendente — o
// pior que alguém consegue é disparar um aviso que já ia ser disparado.
//
// 'decisao-ver' / 'decisao-confirmar' atendem a página /publico/fundo-fixo/decisao, que
// os botões do card abrem. A autorização é o token do link (só o hash fica no banco),
// que vale só pra aquela solicitação, expira e só grava se ainda estiver pendente — se o
// Admin já decidiu no portal, vale a dele.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { createRateLimiter } from './_rate-limit-shared.js';
import {
  TOKEN_VALIDADE_DIAS, emailDoGestor, gerarToken, gestorDaSolicitacao, hashToken, interpretarDecisao,
  montarCardConfirmacao, montarCardSolicitacao, tokenValido,
} from './_fundo-fixo-teams-shared.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const BUCKET = 'fundo-fixo-anexos';

// Precisam ficar em sincronia com src/services/fundo-fixo.service.ts
const SETORES = ['Manutenção', 'Operação', 'Infraestrutura', 'Outros'];
const LIMITE_POR_COMPRA = 500;

const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Um rate limit por ação — mesmos limites de cada function original (request: 5/min,
// upload-url: 8/min, a URL assinada sozinha não grava nada, só "reserva" um caminho).
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const checkRateLimitRequest = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: 5 });
const checkRateLimitUploadUrl = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: 8 });
const checkRateLimitTeams = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: 10 });
const FLOW_TIMEOUT_MS = 8000;

function sanitize(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function handleRequest(req, res, ip, supabase) {
  if (!checkRateLimitRequest(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }

  const body = req.body || {};

  const nomeSolicitante = sanitize(body.nomeSolicitante, 100);
  const contato = sanitize(body.contato, 60);
  const setor = sanitize(body.setor, 30);
  const fornecedor = sanitize(body.fornecedor, 150);
  const material = sanitize(body.material, 1000);
  // Pode vir mais de um link (um por linha), então precisa de mais espaço que uma URL só.
  const linkProduto = sanitize(body.linkProduto, 2000);
  const observacoesBase = sanitize(body.observacoes, 1000);
  const orcamentoPath = sanitize(body.orcamentoPath, 300);
  const valorEstimado = Number(body.valorEstimado);

  if (!nomeSolicitante) return res.status(400).json({ success: false, error: 'Informe seu nome.' });
  if (!SETORES.includes(setor)) return res.status(400).json({ success: false, error: 'Setor inválido.' });
  if (!material) return res.status(400).json({ success: false, error: 'Descreva o que precisa comprar.' });
  if (!Number.isFinite(valorEstimado) || valorEstimado <= 0) {
    return res.status(400).json({ success: false, error: 'Informe um valor estimado válido.' });
  }
  if (valorEstimado > LIMITE_POR_COMPRA) {
    return res.status(400).json({ success: false, error: `Cada compra do Fundo Fixo tem limite de R$ ${LIMITE_POR_COMPRA.toFixed(2)}.` });
  }
  if (orcamentoPath && !orcamentoPath.startsWith('publico/')) {
    return res.status(400).json({ success: false, error: 'Anexo inválido.' });
  }

  let orcamentoUrl = null;
  if (orcamentoPath) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(orcamentoPath);
    orcamentoUrl = data?.publicUrl ?? null;
  }

  const observacoes = contato
    ? `Contato: ${contato}${observacoesBase ? `\n\n${observacoesBase}` : ''}`
    : (observacoesBase || null);

  const { data: inserted, error } = await supabase
    .from('fundo_fixo_solicitacoes')
    .insert({
      solicitante_id: null,
      solicitante_nome: nomeSolicitante,
      setor,
      fornecedor: fornecedor || null,
      material,
      link_produto: linkProduto || null,
      valor_estimado: valorEstimado,
      orcamento_url: orcamentoUrl,
      observacoes,
      status: 'pendente',
      mes_referencia: mesAtual(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[fundo-fixo-public-request] Insert error:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao registrar solicitação. Tente novamente.' });
  }

  // Fire-and-forget — não bloqueia a resposta de sucesso pro usuário público.
  supabase.from('audit_logs').insert({
    user_id: null,
    user_name: nomeSolicitante,
    event_type: 'fundo_fixo_solicitado_publico',
    resource_type: 'fundo_fixo',
    resource_id: inserted?.id ?? null,
    description: `${nomeSolicitante} solicitou compra via link público do Fundo Fixo: ${material} (R$ ${valorEstimado.toFixed(2)})`,
    metadata: { setor, valor_estimado: valorEstimado },
  }).then(({ error: logError }) => {
    if (logError) console.error('[fundo-fixo-public-request] Audit log error:', logError.message);
  });

  // Antes de responder: a Vercel pode congelar a function depois do res.json.
  if (inserted?.id) await notificarTeams(supabase, inserted.id);

  return res.status(200).json({ success: true });
}

// Envia a solicitação pro fluxo do Teams (card com os links de Aprovar/Recusar). Devolve
// um motivo curto (pra log/resposta); nunca lança — falha aqui não pode derrubar a
// criação da solicitação.
export async function notificarTeams(supabase, id, env = process.env, fetchImpl = fetch) {
  if (!env.FUNDO_FIXO_FLOW_URL) return 'desligado';
  let marcou = false;
  try {
    const { data: row, error } = await supabase
      .from('fundo_fixo_solicitacoes').select('*').eq('id', id).maybeSingle();
    if (error || !row) return 'nao-encontrada';
    if (row.status !== 'pendente') return 'ja-decidida';
    if (row.teams_enviado_em) return 'ja-enviada';
    const gestor = gestorDaSolicitacao(row);
    const email = gestor ? emailDoGestor(gestor, env) : null;
    if (!email) return 'sem-gestor';

    // Marca antes de enviar (só quem conseguir marcar envia) — evita card duplicado
    // se duas chamadas chegarem juntas.
    const token = gerarToken();
    const expira = new Date(Date.now() + TOKEN_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
    const { data: marcadas } = await supabase
      .from('fundo_fixo_solicitacoes')
      .update({
        teams_enviado_em: new Date().toISOString(),
        gestor_aprovador: gestor,
        teams_token_hash: hashToken(token),
        teams_token_expira_em: expira.toISOString(),
      })
      .eq('id', id).is('teams_enviado_em', null)
      .select('id');
    if (!marcadas?.length) return 'ja-enviada';
    marcou = true;

    await postarNoTeams(email, montarCardSolicitacao(row, ALLOWED_ORIGINS[0], token), env, fetchImpl);
    return 'enviada';
  } catch (err) {
    console.error('[fundo-fixo-teams] Falha ao enviar pro Teams:', err?.message || err);
    // Desmarca pra uma próxima chamada poder tentar de novo.
    if (marcou) {
      await supabase.from('fundo_fixo_solicitacoes')
        .update({ teams_enviado_em: null, teams_token_hash: null, teams_token_expira_em: null })
        .eq('id', id);
    }
    return 'falhou';
  }
}

async function postarNoTeams(email, card, env, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLOW_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(env.FUNDO_FIXO_FLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aprovadorEmail: email, card }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`fluxo respondeu ${resp.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function handleTeamsNotificar(req, res, ip, supabase) {
  if (!checkRateLimitTeams(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }
  const id = String(req.body?.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ success: false, error: 'id inválido.' });
  const resultado = await notificarTeams(supabase, id);
  return res.status(200).json({ success: true, resultado });
}

// Só o que a página de decisão precisa mostrar — nada de ids de usuário ou do token.
function solicitacaoPublica(row) {
  return {
    solicitanteNome: row.solicitante_nome,
    setor: row.setor,
    fornecedor: row.fornecedor,
    material: row.material,
    linkProduto: row.link_produto,
    valorEstimado: Number(row.valor_estimado) || 0,
    orcamentoUrl: row.orcamento_url,
    observacoes: row.observacoes,
    dataSolicitacao: row.data_solicitacao,
    status: row.status,
    gestorAprovador: row.gestor_aprovador,
    aprovadorNome: row.aprovador_nome,
    dataAprovacao: row.data_aprovacao,
    motivoRecusa: row.motivo_recusa,
    expirado: row.status === 'pendente' && new Date(row.teams_token_expira_em) <= new Date(),
  };
}

async function buscarPorToken(supabase, token) {
  const { data } = await supabase
    .from('fundo_fixo_solicitacoes').select('*').eq('teams_token_hash', hashToken(token)).maybeSingle();
  return data ?? null;
}

// 'decisao-ver': a página abre e mostra a solicitação. Abrir o link não decide nada — o
// Teams abre os links sozinho pra gerar prévia; só o POST de 'decisao-confirmar' grava.
export async function handleDecisaoVer(req, res, ip, supabase) {
  if (!checkRateLimitTeams(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }
  const token = req.body?.token;
  if (!tokenValido(token)) return res.status(400).json({ success: false, error: 'Link inválido.' });
  const row = await buscarPorToken(supabase, token);
  if (!row) return res.status(404).json({ success: false, error: 'Link inválido ou não encontrado.' });
  return res.status(200).json({ success: true, solicitacao: solicitacaoPublica(row) });
}

export async function handleDecisaoConfirmar(req, res, ip, supabase, env = process.env, fetchImpl = fetch) {
  if (!checkRateLimitTeams(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }
  const d = interpretarDecisao(req.body);
  if (d.erro) return res.status(400).json({ success: false, error: d.erro });

  const agora = new Date().toISOString();
  const row = await buscarPorToken(supabase, d.token);
  if (!row) return res.status(404).json({ success: false, error: 'Link inválido ou não encontrado.' });
  const quem = row.gestor_aprovador || 'Gestor';
  const update = {
    status: d.aprovado ? 'aprovado' : 'recusado',
    aprovador_id: null,
    aprovador_nome: `${quem} (Teams)`,
    data_aprovacao: agora,
    ...(d.aprovado ? {} : { motivo_recusa: d.comentario || null }),
  };

  // Só grava se ainda estiver pendente e o link não venceu — se o Admin decidiu antes
  // no portal, vale a dele.
  const { data: alteradas, error } = await supabase
    .from('fundo_fixo_solicitacoes')
    .update(update)
    .eq('id', row.id).eq('status', 'pendente').gt('teams_token_expira_em', agora)
    .select('*');
  if (error) {
    console.error('[fundo-fixo-teams] Erro ao gravar decisão:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao gravar decisão. Tente novamente.' });
  }
  if (!alteradas?.length) {
    const atual = await buscarPorToken(supabase, d.token);
    return res.status(409).json({
      success: false,
      error: atual?.status === 'pendente' ? 'Este link expirou. Peça a aprovação pelo portal.' : 'Esta solicitação já tinha sido decidida.',
      solicitacao: atual ? solicitacaoPublica(atual) : null,
    });
  }

  const salva = alteradas[0];
  const { error: logError } = await supabase.from('audit_logs').insert({
    user_id: null,
    user_name: quem,
    event_type: d.aprovado ? 'fundo_fixo_aprovado' : 'fundo_fixo_recusado',
    resource_type: 'fundo_fixo',
    resource_id: salva.id,
    description: `${quem} ${d.aprovado ? 'aprovou' : 'recusou'} pelo Teams a solicitação de Fundo Fixo de ${salva.solicitante_nome}: ${salva.material}`,
    metadata: { origem: 'teams', gestor_aprovador: quem, comentario: d.comentario || null },
  });
  if (logError) console.error('[fundo-fixo-teams] Audit log error:', logError.message);

  // Confirmação no chat do gestor. Falhar aqui não desfaz a decisão.
  const email = emailDoGestor(quem, env);
  if (email && env.FUNDO_FIXO_FLOW_URL) {
    try {
      await postarNoTeams(email, montarCardConfirmacao(salva, d.aprovado, d.comentario), env, fetchImpl);
    } catch (err) {
      console.error('[fundo-fixo-teams] Falha ao enviar confirmação:', err?.message || err);
    }
  }

  return res.status(200).json({ success: true, solicitacao: solicitacaoPublica(salva) });
}

async function handleUploadUrl(req, res, ip, supabase) {
  if (!checkRateLimitUploadUrl(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }

  const contentType = String(req.body?.contentType || '');
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return res.status(400).json({ success: false, error: 'Tipo de arquivo não permitido. Use PDF, JPG, PNG ou WEBP.' });
  }

  const path = `publico/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    console.error('[fundo-fixo-public-upload-url] Error:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao preparar upload do anexo.' });
  }

  return res.status(200).json({ success: true, path: data.path, token: data.token });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[fundo-fixo-public-request] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (req.body?.action === 'upload-url') return handleUploadUrl(req, res, ip, supabase);
  if (req.body?.action === 'teams-notificar') return handleTeamsNotificar(req, res, ip, supabase);
  if (req.body?.action === 'decisao-ver') return handleDecisaoVer(req, res, ip, supabase);
  if (req.body?.action === 'decisao-confirmar') return handleDecisaoConfirmar(req, res, ip, supabase);
  return handleRequest(req, res, ip, supabase);
}
