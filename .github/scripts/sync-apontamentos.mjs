// Sync automático: baixa do SIGMA e salva direto no Supabase (sem Vercel)
import { createHash } from 'crypto';

const SIGMA_URL    = 'https://utepecem.com.br/sigma/export/?dados=apontamentos&empresa=PTPC';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH        = 500;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados.');
  process.exit(1);
}

const COLS = {
  id_sigma_os: 2, registrador: 3, executante: 4, solicitante: 5,
  area_manutencao: 6, numero_pt: 7, status_operacao: 8, data: 9,
  hora_inicial: 10, hora_final: 11, intervalo: 12, feedback: 13,
  status_usuario: 14, equipe: 15, supervisor: 16,
  operador_sala: 17, operador_campo: 18, empresa: 19, os_protheus: 20,
};

function calcHoras(hi, hf, inv) {
  if (!hi || !hf) return 0;
  const m = h => { const p = String(h).split(':'); return (parseInt(p[0])||0)*60+(parseInt(p[1])||0); };
  let mins = m(hf) - m(hi);
  if (inv) mins -= m(inv);
  return Math.max(0, parseFloat((mins/60).toFixed(2)));
}

function parseDateStr(str) {
  if (!str) return null;
  const s = String(str).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}

async function sbFetch(method, path, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path}: HTTP ${resp.status} - ${txt.substring(0, 200)}`);
  }
}

async function getUltimoHash() {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/apontamentos_importacoes?select=nome_arquivo&order=importado_em.desc&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await resp.json().catch(() => []);
  const nome = data?.[0]?.nome_arquivo ?? '';
  return nome.startsWith('hash:') ? nome.replace('hash:', '') : null;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Verificando apontamentos...`);

  const sigmaResp = await fetch(SIGMA_URL);
  if (!sigmaResp.ok) throw new Error(`SIGMA HTTP ${sigmaResp.status}`);

  const buffer = Buffer.from(await sigmaResp.arrayBuffer());
  const hashAtual = createHash('md5').update(buffer).digest('hex');
  const hashAnterior = await getUltimoHash();

  if (hashAtual === hashAnterior) {
    console.log(`Arquivo nao mudou (${hashAtual.substring(0,8)}...). Nada a importar.`);
    return;
  }

  console.log(`Arquivo alterado - ${(buffer.length/1024/1024).toFixed(1)} MB - processando...`);

  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder('latin1').decode(buffer); }

  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  const sep   = lines[0]?.includes('\t') ? '\t' : ',';

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(sep);
    if (!v[COLS.executante]?.trim()) continue;
    records.push({
      id_sigma_os:     v[COLS.id_sigma_os]?.trim()     || null,
      registrador:     v[COLS.registrador]?.trim()     || null,
      executante:      v[COLS.executante]?.trim()      || null,
      solicitante:     v[COLS.solicitante]?.trim()     || null,
      area_manutencao: v[COLS.area_manutencao]?.trim() || null,
      numero_pt:       v[COLS.numero_pt]?.trim()       || null,
      status_operacao: v[COLS.status_operacao]?.trim() || null,
      data:            parseDateStr(v[COLS.data]),
      hora_inicial:    v[COLS.hora_inicial]?.trim()    || null,
      hora_final:      v[COLS.hora_final]?.trim()      || null,
      intervalo:       v[COLS.intervalo]?.trim()       || null,
      feedback:        v[COLS.feedback]?.trim()        || null,
      status_usuario:  v[COLS.status_usuario]?.trim()  || null,
      equipe:          v[COLS.equipe]?.trim()          || null,
      supervisor:      v[COLS.supervisor]?.trim()      || null,
      operador_sala:   v[COLS.operador_sala]?.trim()   || null,
      operador_campo:  v[COLS.operador_campo]?.trim()  || null,
      empresa:         v[COLS.empresa]?.trim()         || null,
      os_protheus:     v[COLS.os_protheus]?.trim()     || null,
      horas: calcHoras(v[COLS.hora_inicial], v[COLS.hora_final], v[COLS.intervalo]),
    });
  }

  // Filtra apenas os últimos 90 dias
  const limite90 = new Date();
  limite90.setDate(limite90.getDate() - 90);
  const dataLimite = limite90.toISOString().split('T')[0];
  const recordsFiltrados = records.filter(r => r.data && r.data >= dataLimite);

  console.log(`${records.length} parseados, ${recordsFiltrados.length} nos últimos 90 dias.`);

  await sbFetch('DELETE', 'apontamentos?importado_em=gte.1900-01-01');

  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    await sbFetch('POST', 'apontamentos', records.slice(i, i + BATCH));
    inserted += Math.min(BATCH, records.length - i);
  }

  await sbFetch('POST', 'apontamentos_importacoes', {
    nome_arquivo:    `hash:${hashAtual}`,
    total_registros: inserted,
  });

  console.log(`${inserted} registros salvos. Hash: ${hashAtual.substring(0,8)}...`);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
