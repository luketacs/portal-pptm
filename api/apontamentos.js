import { fetchAllRows } from './_pagination-shared.js';
// Serverless: lê apontamentos do Supabase (importados via upload)
import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Autenticação obrigatória.' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Token inválido.' });
    }

    const data = await fetchAllRows((from, to) => supabase.from('apontamentos')
      .select('*').not('data', 'is', null).order('data').order('id').range(from, to));

    // Última importação
    const { data: ultImp } = await supabase
      .from('apontamentos_importacoes')
      .select('importado_em, total_registros, profiles:importado_por(name)')
      .order('importado_em', { ascending: false })
      .limit(1)
      .single();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      data: data ?? [],
      total: data?.length ?? 0,
      ultima_importacao: ultImp ?? null,
    });
  } catch (err) {
    console.error('[apontamentos]', err?.message);
    return res.status(500).json({ success: false, error: err?.message });
  }
}
