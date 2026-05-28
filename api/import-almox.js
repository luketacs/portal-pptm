// Serverless function: importa Excel do almoxarifado para o Supabase
// Recebe arquivo em base64 + tipo via POST (Admin only)
// Estratégia: substitui todos os dados existentes do tipo informado

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const BATCH_SIZE = 500;

// ── Mapeamento de colunas (índice 0) ──────────────────────────────────────
// Movimentações - 2026.xlsx  (sheet "1-Movimentação dos produtos")
const MOV_COLS = { codigo: 0, descricao: 1, unidade: 2, grupo: 4, custo_medio: 5, saldo_qtd: 6, data: 10, documento: 14, entrada: 16, saida: 22, referencia: 30 };
// Solicitacoes.xlsx (sheet "Listagem do Browse")
const SA_COLS  = { sa_numero: 0, codigo: 2, qtd_solicitada: 5, ordem_produto: 7, qtd_atendida: 11, recebedor: 12 };
// Relatorio Ary.xlsx
const ARY_COLS = { sa_numero: 1, codigo: 3, status: 17 };
// ──────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Verificar usuário e role Admin
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Token inválido.' });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'Admin') return res.status(403).json({ error: 'Apenas administradores podem importar dados.' });

  const { tipo, fileData, fileName } = req.body || {};
  if (!tipo || !fileData) return res.status(400).json({ error: 'Campos obrigatórios: tipo, fileData.' });
  if (!['movimentacoes', 'solicitacoes', 'status_sas'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido. Use: movimentacoes | solicitacoes | status_sas' });
  }

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    let rows = [];
    let tabela = '';

    if (tipo === 'movimentacoes') {
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      rows = data
        .slice(2) // pula 2 linhas de cabeçalho
        .filter(r => r[MOV_COLS.codigo])
        .map(r => ({
          produto_codigo: String(r[MOV_COLS.codigo] || '').trim(),
          produto_desc:   String(r[MOV_COLS.descricao] || '').trim() || null,
          unidade:        String(r[MOV_COLS.unidade] || '').trim() || null,
          grupo:          String(r[MOV_COLS.grupo] || '').trim() || null,
          custo_medio:    parseFloat(r[MOV_COLS.custo_medio]) || 0,
          saldo_qtd:      parseFloat(r[MOV_COLS.saldo_qtd]) || 0,
          data_operacao:  formatDate(r[MOV_COLS.data]),
          documento_num:  String(r[MOV_COLS.documento] || '').trim() || null,
          qtd_entrada:    parseFloat(r[MOV_COLS.entrada]) || 0,
          qtd_saida:      parseFloat(r[MOV_COLS.saida]) || 0,
          referencia:     String(r[MOV_COLS.referencia] || '').trim() || null,
        }));

      tabela = 'almox_movimentacoes';

    } else if (tipo === 'solicitacoes') {
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      rows = data
        .slice(2) // Python usa rows_sol[2:] — pula 2 linhas (título + cabeçalho)
        .filter(r => r[SA_COLS.sa_numero] && r[SA_COLS.codigo])
        .map(r => {
          const ordemProd   = String(r[SA_COLS.ordem_produto] || '').trim();
          const qtdSol      = parseFloat(r[SA_COLS.qtd_solicitada]) || 0;
          const qtdAtendida = parseFloat(r[SA_COLS.qtd_atendida])   || 0;
          // SA já atendida = qtd_atendida >= qtd_solicitada (e qtd_sol > 0)
          const status = qtdSol > 0 && qtdAtendida >= qtdSol ? 'atendida' : 'aberta';

          return {
            sa_numero:      String(r[SA_COLS.sa_numero] || '').trim(),
            produto_codigo: String(r[SA_COLS.codigo] || '').trim(),
            qtd_solicitada: qtdSol,
            qtd_atendida:   qtdAtendida,
            ordem_produto:  ordemProd || null,
            ordem_id:       ordemProd ? ordemProd.substring(0, 6) : null,
            recebedor:      String(r[SA_COLS.recebedor] || '').trim() || null,
            status,
          };
        });

      tabela = 'almox_solicitacoes';

    } else if (tipo === 'status_sas') {
      // Relatório Ary — atualiza status das SAs encerradas
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      // Replica lógica Python: só encerra um par (sa, produto) se TODOS os itens forem 'E'
      // pares[(sa, produto)] = conjunto de status encontrados
      const pares = {};
      for (const r of data.slice(1)) {
        if (!r[ARY_COLS.sa_numero]) continue;
        const sa      = String(r[ARY_COLS.sa_numero] || '').trim().padStart(6, '0');
        const produto = String(r[ARY_COLS.codigo]    || '').trim();
        const status  = String(r[ARY_COLS.status]    || '').trim();
        const key = `${sa}|${produto}`;
        if (!pares[key]) pares[key] = new Set();
        pares[key].add(status);
      }

      // Apenas pares onde TODOS os status são 'E'
      const encerradas = Object.entries(pares)
        .filter(([, statuses]) => [...statuses].every(s => s === 'E'))
        .map(([key]) => {
          const [sa_numero, produto_codigo] = key.split('|');
          return { sa_numero, produto_codigo };
        });

      // Passo 1: Reseta apenas as 'encerradas' de volta para 'aberta'
      // NÃO toca as 'atendidas' (qtd_atendida >= qtd_solicitada — já foram atendidas)
      await supabase
        .from('almox_solicitacoes')
        .update({ status: 'aberta' })
        .eq('status', 'encerrada');

      // Passo 2: Marca como encerradas apenas os pares confirmados
      if (encerradas.length > 0) {
        await Promise.all(
          encerradas.map(e =>
            supabase
              .from('almox_solicitacoes')
              .update({ status: 'encerrada' })
              .eq('sa_numero', e.sa_numero)
              .eq('produto_codigo', e.produto_codigo)
          )
        );
      }

      await supabase.from('almox_importacoes').insert({
        tipo: 'status_sas',
        nome_arquivo: fileName || 'relatorio_ary.xlsx',
        total_registros: encerradas.length, // pares (sa+produto) efetivamente encerrados
        importado_por: user.id,
      });

      return res.status(200).json({ success: true, tipo: 'status_sas', encerradas: encerradas.length });
    }

    // Substituição completa: apaga e reinsere
    await supabase.from(tabela).delete().gte('created_at', '1900-01-01');

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase.from(tabela).insert(chunk);
      if (insertError) throw new Error(`Erro ao inserir lote ${i}: ${insertError.message}`);
      inserted += chunk.length;
    }

    await supabase.from('almox_importacoes').insert({
      tipo,
      nome_arquivo: fileName || `${tipo}.xlsx`,
      total_registros: inserted,
      importado_por: user.id,
    });

    return res.status(200).json({ success: true, tipo, inseridos: inserted });

  } catch (err) {
    console.error('[import-almox] Erro:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Erro ao processar o arquivo.' });
  }
}

function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value).trim();
  if (!s) return null;
  // DD/MM/YYYY
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // YYYY-MM-DD or ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}
