// Endpoint público (sem login) pro Kanban da Oficina — pensado pra ficar aberto numa TV
// da Elétrica/Mecânica. Só leitura: atividades (tipo='ordem') do dia, Elétrica e
// Mecânica, agrupadas por status. O RLS de manutencao_programacao continua exigindo
// sessão (auth.uid() IS NOT NULL), então quem decide o que sai daqui é esta function,
// com a service_role key (só no servidor, nunca chega no cliente) — mesmo padrão de
// api/fundo-fixo-public-request.js.
//
// A coluna `status` da tabela é sempre 'PEND' pra qualquer OS criada pelo Portal — quem
// sabe o andamento de verdade é o SIGMA (ver _sigma-shared.js), por isso a consulta ao
// cache de OS do SIGMA pra decidir a coluna do Kanban.
import { createClient } from '@supabase/supabase-js';
import { ALLOWED_ORIGINS, normalizarNumeroOs, obterCache } from './_sigma-shared.js';

// Mapeamento do Status Código do SIGMA pra coluna do Kanban — melhor entendimento dos
// códigos observados (PEND, CANC, EXEC, ETEX, EXPA, NEXE, ETNE, CONC, AREC); sem OS ou
// sem status ainda cai em "pendente". CANC (cancelada) não entra no quadro.
const STATUS_PARA_COLUNA = {
  PEND: 'pendente', EXPA: 'pendente', NEXE: 'pendente', ETNE: 'pendente',
  EXEC: 'emExecucao', ETEX: 'emExecucao',
  CONC: 'concluida', AREC: 'concluida',
};

// Data de "hoje" no fuso de Pecém/CE (America/Fortaleza, sem horário de verão) — a
// Vercel roda em UTC, então "new Date()" sozinho vira o dia errado à noite.
function hojeBrasilIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[kanban-atividades-publico] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const hoje = hojeBrasilIso();

    const { data, error } = await supabase
      .from('manutencao_programacao')
      .select('numero_os, descricao, equipamento, tecnico_nome, area, duracao_horas, loto')
      .eq('tipo', 'ordem')
      .in('area', ['ELETRICA', 'MECANICA'])
      .contains('dias_previstos', [hoje]);
    if (error) return res.status(500).json({ success: false, error: error.message });

    let osPorNumero = new Map();
    try {
      osPorNumero = (await obterCache()).osPorNumero;
    } catch (sigmaError) {
      // Best-effort — se o SIGMA estiver fora do ar, tudo cai em "pendente" (melhor
      // mostrar o quadro sem status do que quebrar tudo numa TV sem ninguém pra ver erro).
      console.error('[kanban-atividades-publico] SIGMA indisponível:', sigmaError.message);
    }

    const colunas = { pendente: [], emExecucao: [], concluida: [] };
    for (const o of data) {
      const info = o.numero_os ? osPorNumero.get(normalizarNumeroOs(o.numero_os)) : null;
      const statusCodigo = (info?.statusCodigo || '').toUpperCase();
      if (statusCodigo === 'CANC') continue;
      const coluna = STATUS_PARA_COLUNA[statusCodigo] || 'pendente';
      colunas[coluna].push({
        numeroOs: o.numero_os,
        descricao: o.descricao,
        equipamento: o.equipamento,
        tecnico: o.tecnico_nome,
        area: o.area,
        duracaoHoras: o.duracao_horas,
        loto: o.loto,
      });
    }

    return res.status(200).json({ success: true, atualizadoEm: Date.now(), colunas });
  } catch (error) {
    console.error('[kanban-atividades-publico] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao carregar o quadro.' });
  }
}
