// Serverless: importa CSV/TSV de apontamentos do SIGMA para o Supabase
// Admin faz upload do arquivo exportado de:
// https://utepecem.com.br/sigma/export/?dados=apontamentos&empresa=PTPC

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const BATCH = 500;

const COLS = {
  id: 0, data_registro: 1, id_sigma_os: 2, registrador: 3, executante: 4,
  solicitante: 5, area_manutencao: 6, numero_pt: 7, status_operacao: 8,
  data: 9, hora_inicial: 10, hora_final: 11, intervalo_almoco: 12,
  feedback: 13, status_usuario: 14, equipe: 15, supervisor: 16,
  operador_sala: 17, operador_campo: 18, empresa: 19, os_protheus: 20,
};

function calcHoras(hi, hf, inv) {
  if (!hi || !hf) return 0;
  const toMin = h => { const p = String(h).split(':'); return (parseInt(p[0])||0)*60+(parseInt(p[1])||0); };
  let m = toMin(hf) - toMin(hi);
  if (inv) m -= toMin(inv);
  return Math.max(0, parseFloat((m/60).toFixed(2)));
}

function parseDate(str) {
  if (!str) return null;
  const br = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(str))) return String(str).substring(0, 10);
  return null;
}

function parseRows(buffer) {
  // Tenta parsear como XLSX/CSV usando a biblioteca xlsx
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i];
    if (!v[COLS.executante]) continue;

    records.push({
      id_sigma_os:     String(v[COLS.id_sigma_os]    || '').trim() || null,
      registrador:     String(v[COLS.registrador]    || '').trim() || null,
      executante:      String(v[COLS.executante]     || '').trim() || null,
      solicitante:     String(v[COLS.solicitante]    || '').trim() || null,
      area_manutencao: String(v[COLS.area_manutencao]|| '').trim() || null,
      numero_pt:       String(v[COLS.numero_pt]      || '').trim() || null,
      status_operacao: String(v[COLS.status_operacao]|| '').trim() || null,
      data:            parseDate(v[COLS.data]),
      hora_inicial:    String(v[COLS.hora_inicial]   || '').trim() || null,
      hora_final:      String(v[COLS.hora_final]     || '').trim() || null,
      intervalo:       String(v[COLS.intervalo_almoco]||'').trim() || null,
      feedback:        String(v[COLS.feedback]       || '').trim() || null,
      status_usuario:  String(v[COLS.status_usuario] || '').trim() || null,
      equipe:          String(v[COLS.equipe]         || '').trim() || null,
      supervisor:      String(v[COLS.supervisor]     || '').trim() || null,
      operador_sala:   String(v[COLS.operador_sala]  || '').trim() || null,
      operador_campo:  String(v[COLS.operador_campo] || '').trim() || null,
      empresa:         String(v[COLS.empresa]        || '').trim() || null,
      os_protheus:     String(v[COLS.os_protheus]    || '').trim() || null,
      horas: calcHoras(v[COLS.hora_inicial], v[COLS.hora_final], v[COLS.intervalo_almoco]),
    });
  }
  return records;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Aceita autenticação via JWT (admin) OU chave secreta do cron (GitHub Actions)
  const cronSecret  = req.headers['x-cron-secret'] || '';
  const authHeader  = req.headers.authorization || '';
  const token       = authHeader.replace('Bearer ', '').trim();

  const isCronCall  = process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  if (!isCronCall) {
    if (!token) return res.status(401).json({ error: 'Token não fornecido.' });
    const { data: { user }, error: ue } = await supabase.auth.getUser(token);
    if (ue || !user) return res.status(401).json({ error: 'Token inválido.' });
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'Admin') return res.status(403).json({ error: 'Apenas administradores podem importar.' });
  }

  const { fileData, fileName } = req.body || {};
  if (!fileData) return res.status(400).json({ error: 'fileData obrigatório (base64).' });

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const records = parseRows(buffer);

    if (records.length === 0) {
      return res.status(400).json({ error: 'Nenhum registro encontrado no arquivo. Verifique o formato.' });
    }

    // Substitui todos os dados anteriores
    await supabase.from('apontamentos').delete().gte('importado_em', '1900-01-01');

    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error: ie } = await supabase.from('apontamentos').insert(records.slice(i, i + BATCH));
      if (ie) throw new Error(`Erro ao inserir lote ${i}: ${ie.message}`);
      inserted += Math.min(BATCH, records.length - i);
    }

    await supabase.from('apontamentos_importacoes').insert({
      nome_arquivo: fileName || 'apontamentos.xlsx',
      total_registros: inserted,
      importado_por: user.id,
    });

    return res.status(200).json({ success: true, inseridos: inserted });
  } catch (err) {
    console.error('[import-apontamentos]', err?.message);
    return res.status(500).json({ success: false, error: err?.message });
  }
}
