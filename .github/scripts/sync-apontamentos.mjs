// Script executado pelo GitHub Actions a cada hora
// Só importa se o arquivo do SIGMA tiver mudado desde a última importação

import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SIGMA_URL    = 'https://utepecem.com.br/sigma/export/?dados=apontamentos&empresa=PTPC';
const PORTAL_URL   = process.env.PORTAL_URL   || 'https://portalpptm.vercel.app';
const CRON_SECRET  = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CRON_SECRET) { console.error('❌ CRON_SECRET não configurado.'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ Variáveis do Supabase não configuradas.'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getUltimoHash() {
  const { data } = await supabase
    .from('apontamentos_importacoes')
    .select('nome_arquivo')
    .order('importado_em', { ascending: false })
    .limit(1)
    .single();
  // Armazenamos o hash no campo nome_arquivo como "hash:xxxx"
  if (data?.nome_arquivo?.startsWith('hash:')) {
    return data.nome_arquivo.replace('hash:', '');
  }
  return null;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Verificando apontamentos...`);

  // 1. Baixa o arquivo do SIGMA
  const sigmaResp = await fetch(SIGMA_URL);
  if (!sigmaResp.ok) throw new Error(`SIGMA HTTP ${sigmaResp.status}`);

  const buffer = await sigmaResp.arrayBuffer();
  const bytes  = Buffer.from(buffer);

  // 2. Calcula hash do arquivo para detectar mudanças
  const hashAtual   = createHash('md5').update(bytes).digest('hex');
  const hashAnterior = await getUltimoHash();

  if (hashAtual === hashAnterior) {
    console.log(`✅ Arquivo não mudou (hash ${hashAtual.substring(0,8)}...). Nada a importar.`);
    return;
  }

  console.log(`🔄 Arquivo alterado. Importando ${(bytes.length / 1024 / 1024).toFixed(1)} MB...`);

  // 3. Envia para a API de importação
  const base64 = bytes.toString('base64');
  const resp   = await fetch(`${PORTAL_URL}/api/import-apontamentos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cron-Secret': CRON_SECRET,
    },
    body: JSON.stringify({
      fileData: base64,
      fileName: `hash:${hashAtual}`,  // armazena o hash como "nome" para próxima verificação
    }),
  });

  const result = await resp.json();
  if (!result.success) throw new Error(result.error || `Import falhou HTTP ${resp.status}`);

  console.log(`✅ ${result.inseridos} registros importados. Hash: ${hashAtual.substring(0,8)}...`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
