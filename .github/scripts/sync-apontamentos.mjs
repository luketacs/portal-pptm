// Sync automático: baixa do SIGMA e salva direto no Supabase
// Usa a mesma lógica de parsing do browser (xlsx library)
import { createHash } from 'crypto';
import XLSX from 'xlsx';

const SIGMA_URL    = 'https://utepecem.com.br/sigma/export/?dados=apontamentos&empresa=PTPC';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH        = 500;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  process.exit(1);
}

// Mesmos mapeamentos de coluna do browser
const FIXED_COLS = {
  id_sigma_os: 2, registrador: 3, executante: 4, solicitante: 5,
  area_manutencao: 6, numero_pt: 7, status_operacao: 8, data: 9,
  hora_inicial: 10, hora_final: 11, intervalo: 12, feedback: 13,
  status_usuario: 14, equipe: 15, supervisor: 16,
  operador_sala: 17, operador_campo: 18, empresa: 19, os_protheus: 20,
};

function parseDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  // Formato SIGMA: "M/D/YY" americano
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const m = br[1].padStart(2, '0');
    const d = br[2].padStart(2, '0');
    let y = parseInt(br[3]);
    if (y < 100) y += 2000;
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}

function extrairHora(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return `${String(val.getHours()).padStart(2,'0')}:${String(val.getMinutes()).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2,'0')}:${m[2]}` : s;
}

function calcHoras(hi, hf, inv) {
  if (!hi || !hf) return 0;
  const toMin = h => { const p = String(h).split(':'); return (parseInt(p[0])||0)*60+(parseInt(p[1])||0); };
  let mins = toMin(hf) - toMin(hi);
  if (mins < 0) mins += 24 * 60; // turno noturno
  if (inv) mins -= toMin(inv);
  return Math.max(0, parseFloat((mins/60).toFixed(2)));
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

function detectarColunas(headers) {
  const h = headers.map(x => String(x ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const byH = nomes => { for (const n of nomes) { const i = h.findIndex(x => x === n || x.includes(n)); if (i >= 0) return i; } return -1; };
  return {
    id_sigma_os:     byH(['id sigma os', 'sigma os'])  !== -1 ? byH(['id sigma os'])  : FIXED_COLS.id_sigma_os,
    registrador:     byH(['registrador'])              !== -1 ? byH(['registrador'])  : FIXED_COLS.registrador,
    executante:      byH(['executante'])               !== -1 ? byH(['executante'])   : FIXED_COLS.executante,
    solicitante:     byH(['solicitante'])              !== -1 ? byH(['solicitante'])  : FIXED_COLS.solicitante,
    area_manutencao: byH(['area manutencao'])          !== -1 ? byH(['area manutencao']) : FIXED_COLS.area_manutencao,
    numero_pt:       byH(['numero pt', 'nr pt'])       !== -1 ? byH(['numero pt'])   : FIXED_COLS.numero_pt,
    status_operacao: byH(['status operacao'])          !== -1 ? byH(['status operacao']) : FIXED_COLS.status_operacao,
    data:            h.findIndex(x => x === 'data')    !== -1 ? h.findIndex(x => x === 'data') : FIXED_COLS.data,
    hora_inicial:    byH(['hora inicial'])             !== -1 ? byH(['hora inicial']) : FIXED_COLS.hora_inicial,
    hora_final:      byH(['hora final'])               !== -1 ? byH(['hora final'])  : FIXED_COLS.hora_final,
    intervalo:       byH(['intervalo', 'intervalo almoco']) !== -1 ? byH(['intervalo almoco', 'intervalo']) : FIXED_COLS.intervalo,
    feedback:        byH(['feedback'])                 !== -1 ? byH(['feedback'])    : FIXED_COLS.feedback,
    status_usuario:  byH(['status usuario'])           !== -1 ? byH(['status usuario']) : FIXED_COLS.status_usuario,
    equipe:          byH(['equipe'])                   !== -1 ? byH(['equipe'])      : FIXED_COLS.equipe,
    supervisor:      byH(['supervisor'])               !== -1 ? byH(['supervisor'])  : FIXED_COLS.supervisor,
    operador_sala:   byH(['operador sala'])            !== -1 ? byH(['operador sala']) : FIXED_COLS.operador_sala,
    operador_campo:  byH(['operador campo'])           !== -1 ? byH(['operador campo']) : FIXED_COLS.operador_campo,
    empresa:         byH(['empresa'])                  !== -1 ? byH(['empresa'])     : FIXED_COLS.empresa,
    os_protheus:     byH(['os protheus', 'protheus'])  !== -1 ? byH(['os protheus']) : FIXED_COLS.os_protheus,
  };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Verificando apontamentos...`);

  const sigmaResp = await fetch(SIGMA_URL);
  if (!sigmaResp.ok) throw new Error(`SIGMA HTTP ${sigmaResp.status}`);

  const buffer = Buffer.from(await sigmaResp.arrayBuffer());
  const hashAtual = createHash('md5').update(buffer).digest('hex');
  const hashAnterior = await getUltimoHash();

  if (hashAtual === hashAnterior) {
    console.log(`Arquivo não mudou (${hashAtual.substring(0,8)}...). Nada a importar.`);
    return;
  }

  console.log(`Arquivo alterado — ${(buffer.length/1024/1024).toFixed(1)} MB — processando...`);

  // Parseia com XLSX (mesma abordagem do browser)
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });

  if (rows.length < 2) throw new Error('Arquivo sem dados.');

  const COLS = detectarColunas(rows[0]);

  // Filtro: 1º dia do mês de 3 meses atrás + mês atual
  const inicio = new Date();
  inicio.setMonth(inicio.getMonth() - 3);
  inicio.setDate(1);
  inicio.setHours(0, 0, 0, 0);
  const dataLimite = inicio.toISOString().split('T')[0];

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i];
    if (!v[COLS.executante]) continue;
    const hi  = extrairHora(v[COLS.hora_inicial]);
    const hf  = extrairHora(v[COLS.hora_final]);
    const inv = extrairHora(v[COLS.intervalo]);
    const data = parseDateStr(v[COLS.data]);
    if (!data || data < dataLimite) continue; // filtra aqui para não inserir fora do período

    records.push({
      id_sigma_os:     String(v[COLS.id_sigma_os]     ?? '').trim() || null,
      registrador:     String(v[COLS.registrador]     ?? '').trim() || null,
      executante:      String(v[COLS.executante]      ?? '').trim() || null,
      solicitante:     String(v[COLS.solicitante]     ?? '').trim() || null,
      area_manutencao: String(v[COLS.area_manutencao] ?? '').trim() || null,
      numero_pt:       String(v[COLS.numero_pt]       ?? '').trim() || null,
      status_operacao: String(v[COLS.status_operacao] ?? '').trim() || null,
      data,
      hora_inicial:    hi  || null,
      hora_final:      hf  || null,
      intervalo:       inv || null,
      feedback:        String(v[COLS.feedback]        ?? '').trim() || null,
      status_usuario:  String(v[COLS.status_usuario]  ?? '').trim() || null,
      equipe:          String(v[COLS.equipe]          ?? '').trim() || null,
      supervisor:      String(v[COLS.supervisor]      ?? '').trim() || null,
      operador_sala:   String(v[COLS.operador_sala]   ?? '').trim() || null,
      operador_campo:  String(v[COLS.operador_campo]  ?? '').trim() || null,
      empresa:         String(v[COLS.empresa]         ?? '').trim() || null,
      os_protheus:     String(v[COLS.os_protheus]     ?? '').trim() || null,
      horas: calcHoras(hi, hf, inv),
    });
  }

  console.log(`${records.length} registros desde ${dataLimite}.`);

  if (records.length === 0) {
    console.log('Nenhum registro no período. Encerrando.');
    return;
  }

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

  console.log(`✅ ${inserted} registros salvos.`);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
