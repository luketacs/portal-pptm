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

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { createRateLimiter } from './_rate-limit-shared.js';

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

  return res.status(200).json({ success: true });
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
  return handleRequest(req, res, ip, supabase);
}
