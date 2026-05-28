// Serverless: lê Matriculas.xlsx do projeto e retorna a lista de colaboradores
import { readFileSync } from 'fs';
import { join } from 'path';
import XLSX from 'xlsx';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');

let _cache = null;

function lerMatriculas() {
  if (_cache) return _cache;

  const filePath = join(process.cwd(), 'Matriculas.xlsx');
  const buffer   = readFileSync(filePath);
  const wb       = XLSX.read(buffer, { type: 'buffer' });
  const sheet    = wb.Sheets[wb.SheetNames[0]];
  const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Colunas (0-indexed): Funcionario | Matricula | Área | e-mail | Telefone
  const colaboradores = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nome      = String(r[0] || '').trim();
    const matricula = String(r[1] || '').trim();
    const area      = String(r[2] || '').trim();
    const email     = String(r[3] || '').trim();
    if (!nome || !matricula) continue;

    colaboradores.push({
      nome,
      matricula,
      area,            // "Elétrica", "Mecânica" ou "Operação"
      email,
      // Nome normalizado para matching com Executante do SIGMA
      nomeNorm: normalizar(nome),
    });
  }

  _cache = colaboradores;
  return colaboradores;
}

function normalizar(str) {
  return String(str)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const colaboradores = lerMatriculas();
    return res.status(200).json({ success: true, data: colaboradores });
  } catch (err) {
    console.error('[matriculas] Erro ao ler arquivo:', err?.message);
    return res.status(500).json({ success: false, error: 'Erro ao ler Matriculas.xlsx: ' + err?.message });
  }
}
