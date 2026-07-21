// Serverless: grava apontamentos já parseados no Supabase usando a service role key.
// Permite que o auto-sync funcione tanto para usuários autenticados quanto para o link
// público (que não tem permissão de escrita via RLS). Aplica um cooldown global de 30
// minutos — compartilhado por TODOS os usuários — exceto para administradores autenticados.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const COOLDOWN_MS = 30 * 60 * 1000;
const BATCH = 500;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Identifica se é um Admin autenticado (libera do cooldown global)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  let userId = null;
  let isAdmin = false;

  if (token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      userId = user.id;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      isAdmin = profile?.role === 'Admin';
    }
  }

  // Cooldown global de 30 minutos — vale para todos (público e autenticados), exceto Admin
  if (!isAdmin) {
    const { data: ultima } = await supabase
      .from('apontamentos_importacoes')
      .select('importado_em')
      .order('importado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ultima?.importado_em) {
      const decorrido = Date.now() - new Date(ultima.importado_em).getTime();
      if (decorrido < COOLDOWN_MS) {
        const restante = Math.ceil((COOLDOWN_MS - decorrido) / 1000);
        return res.status(429).json({ success: false, error: 'cooldown', cooldownSegundos: restante });
      }
    }
  }

  const { records, dataLimite, nomeArquivo } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum registro para sincronizar.' });
  }
  if (!dataLimite || !/^\d{4}-\d{2}-\d{2}$/.test(dataLimite)) {
    return res.status(400).json({ success: false, error: 'dataLimite inválida.' });
  }

  try {
    // Substitui os registros do período (garante dados limpos, igual à importação manual)
    await supabase.from('apontamentos').delete().gte('data', dataLimite);

    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await supabase.from('apontamentos').insert(records.slice(i, i + BATCH));
      if (error) throw new Error(`Erro ao inserir lote ${i}: ${error.message}`);
      inserted += Math.min(BATCH, records.length - i);
    }

    await supabase.from('apontamentos_importacoes').insert({
      nome_arquivo: nomeArquivo || 'apontamentos_auto.xlsx',
      total_registros: inserted,
      importado_por: userId,
    });

    return res.status(200).json({ success: true, inseridos: inserted });
  } catch (err) {
    console.error('[sync-apontamentos]', err?.message);
    return res.status(500).json({ success: false, error: err?.message });
  }
}
