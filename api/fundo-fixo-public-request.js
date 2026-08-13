// Serverless function: cria uma solicitação de compra do Fundo Fixo enviada pelo
// formulário público (sem login). É a única forma de gravar sem sessão — o RLS
// da tabela (auth.uid() IS NOT NULL) continua bloqueando insert anônimo direto no
// banco; aqui a validação de quem pode escrever o quê é feita nesta função, com
// os mesmos limites usados no formulário interno.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const BUCKET = 'fundo-fixo-anexos';

// Precisam ficar em sincronia com src/services/fundo-fixo.service.ts
const SETORES = ['Manutenção', 'Operação', 'Infraestrutura', 'Outros'];
const LIMITE_POR_COMPRA = 500;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

function sanitize(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[fundo-fixo-public-request] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
