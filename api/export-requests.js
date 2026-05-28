// Serverless function: exporta solicitações de compra como arquivo Excel
// Recebe filtros no body (POST) e retorna arquivo .xlsx

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
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

const IN_PROGRESS_STATUSES = [
  'Aprovado no Portal', 'Aprovado no MRP', 'SC Criada',
  'Em Cotação', 'Aprovado em RD', 'Pedido Criado', 'Material Recebido',
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit excedido. Tente em instantes.' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Verificar usuário autenticado e permissão
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Token inválido.' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) return res.status(403).json({ error: 'Perfil não encontrado.' });
  if (!['Admin', 'Visualizador'].includes(profile.role)) {
    return res.status(403).json({ error: 'Sem permissão para exportar.' });
  }

  const { mode, userId, search, status, materialType, materialCode, dateFrom, dateTo } = req.body || {};

  // Construir query
  let query = supabase
    .from('purchase_requests')
    .select('*, requester:profiles!purchase_requests_requester_id_fkey(id,name,email,role)')
    .order('requestdate', { ascending: false })
    .limit(5000);

  if (mode === 'my' && userId) query = query.eq('requester_id', userId);
  if (mode === 'in-progress') query = query.in('status', IN_PROGRESS_STATUSES);
  if (status && status !== 'all' && mode !== 'in-progress') query = query.eq('status', status);
  if (materialType && materialType !== 'all') query = query.eq('material_type', materialType);
  if (materialCode) query = query.ilike('material_code', `%${materialCode}%`);
  if (search) {
    query = query.or(`material_code.ilike.%${search}%,description.ilike.%${search}%,workorder.ilike.%${search}%`);
  }
  if (dateFrom) query = query.gte('requestdate', dateFrom);
  if (dateTo) query = query.lte('requestdate', new Date(dateTo + 'T23:59:59').toISOString());

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Erro ao buscar dados.' });

  const rows = (data || []).map(r => ({
    'ID da Solicitação': r.id,
    'Data da Solicitação': r.requestdate ? new Date(r.requestdate).toLocaleDateString('pt-BR') : '',
    'Código do Material': r.material_code,
    'Descrição': r.description,
    'Solicitante': r.requester?.name || '',
    'Quantidade': r.quantity,
    'Unidade': r.unit,
    'Prioridade': r.priority,
    'Status': r.status,
    'Ordem de Serviço': r.workorder || '',
    'Justificativa': r.justification || '',
    'Fornecedor': r.supplier || '',
    'Valor Unitário': r.unitvalue || 0,
    'Valor Total': r.totalvalue || 0,
    'Número da SC': r.scnumber || '',
    'Comprador': r.responsiblebuyer || '',
    'Número do Pedido': r.ordernumber || '',
    'Data de Entrega': r.deliverydate ? new Date(r.deliverydate).toLocaleDateString('pt-BR') : '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Solicitações');

  // Auto-fit colunas
  if (rows.length > 0) {
    const colWidths = Object.keys(rows[0]).map(key => {
      const maxData = Math.max(...rows.map(r => String(r[key] || '').length));
      return { wch: Math.max(key.length, maxData) + 2 };
    });
    worksheet['!cols'] = colWidths;
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Solicitacoes_de_Compra_${today}.xlsx`;
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.status(200).send(buffer);
}
