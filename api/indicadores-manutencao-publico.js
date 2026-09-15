// Endpoint público (sem login) pro Acompanhamento de Indicadores de Manutenção —
// pensado pra ficar aberto num monitor do setor por horas. Só leitura: devolve os
// mesmos dados brutos que a tela autenticada já carrega (ManutencaoProgramacaoService.
// load()/loadFerias(), ManutencaoIndicadoresHistoricoService.load(), mais o cache do
// SIGMA), sem agregar nada aqui — quem faz a conta (calcularIndicadoresSemana,
// hhPorEquipamento, calcularHhTecnico etc.) é o componente público, reimportando as
// MESMAS funções puras de src/utils/ que a tela autenticada usa, pra não duplicar
// lógica de negócio em dois lugares (e arriscar divergir). O RLS de
// manutencao_programacao/manutencao_ferias/manutencao_indicadores_historico continua
// exigindo sessão (auth.uid() IS NOT NULL) — quem decide o que sai daqui é esta
// function, com a service_role key (só no servidor, nunca chega no cliente), mesmo
// padrão de api/kanban-atividades-publico.js e api/fundo-fixo-public-request.js.
import { createClient } from '@supabase/supabase-js';
import { ALLOWED_ORIGINS, normalizarNumeroOs, obterCache } from './_sigma-shared.js';

// Mesmo mapeamento snake_case -> camelCase de ManutencaoProgramacaoService.mapRow()
// (src/services/manutencao-programacao.service.ts) — troca de nome de campo, não
// lógica de negócio, então replicar aqui não arrisca divergir do cálculo em si.
function mapOrdem(r) {
  return {
    id: r.id,
    tipo: r.tipo || 'ordem',
    area: r.area,
    categoriaIndicador: r.categoria_indicador,
    semanaInicio: r.semana_inicio,
    numeroOs: r.numero_os,
    semOs: r.sem_os,
    descricao: r.descricao,
    equipamento: r.equipamento,
    duracaoHoras: r.duracao_horas !== null ? Number(r.duracao_horas) : null,
    tipoServico: r.tipo_servico,
    tecnicoNome: r.tecnico_nome,
    tecnicoMatricula: r.tecnico_matricula,
    diasPrevistos: r.dias_previstos ?? [],
    status: r.status,
    planoPreventivoId: r.plano_preventivo_id,
  };
}

function mapFerias(r) {
  return {
    id: r.id,
    tecnicoNome: r.tecnico_nome,
    tecnicoMatricula: r.tecnico_matricula,
    area: r.area,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
  };
}

// Mesmo mapeamento de ManutencaoIndicadoresHistoricoService.mapRow() (src/services/
// manutencao-indicadores-historico.service.ts).
function mapHistorico(r) {
  return {
    id: r.id,
    semanaInicio: r.semana_inicio,
    categoria: r.categoria,
    programadas: Number(r.programadas),
    executadas: Number(r.executadas),
    naoExecutadas: Number(r.nao_executadas),
    planejadasPlano: Number(r.planejadas_plano),
    executadasPlano: Number(r.executadas_plano),
    naoExecutadasPlano: Number(r.nao_executadas_plano),
    atendimento: Number(r.atendimento),
    cumprimento: Number(r.cumprimento),
  };
}

// Indicadores anuais de input manual (Disponibilidade Global Anual, Dias/Navio) — só
// leitura aqui (edição é Admin-only, na tela autenticada). Mesmo mapeamento de
// ManutencaoIndicadoresManuaisService.mapRow() (src/services/
// manutencao-indicadores-manuais.service.ts).
function mapManual(r) {
  return { ano: r.ano, chave: r.chave, valor: Number(r.valor) };
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
    console.error('[indicadores-manutencao-publico] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const [
      { data: ordensRows, error: erroOrdens },
      { data: feriasRows, error: erroFerias },
      { data: historicoRows, error: erroHistorico },
      { data: manuaisRows, error: erroManuais },
    ] = await Promise.all([
      supabase.from('manutencao_programacao').select('*').order('semana_inicio', { ascending: false }),
      supabase.from('manutencao_ferias').select('id, tecnico_nome, tecnico_matricula, area, data_inicio, data_fim').order('data_inicio'),
      supabase.from('manutencao_indicadores_historico').select('*').order('semana_inicio'),
      supabase.from('manutencao_indicadores_manuais').select('ano, chave, valor'),
    ]);
    if (erroOrdens) return res.status(500).json({ success: false, error: erroOrdens.message });
    if (erroFerias) return res.status(500).json({ success: false, error: erroFerias.message });
    if (erroHistorico) return res.status(500).json({ success: false, error: erroHistorico.message });
    if (erroManuais) return res.status(500).json({ success: false, error: erroManuais.message });

    const ordens = ordensRows.map(mapOrdem);

    // SIGMA é best-effort — se estiver fora do ar, a tela mostra tudo em 0%/pendente em
    // vez de quebrar a página inteira (mesmo princípio de kanban-atividades-publico.js).
    let sigmaPorOs = {};
    try {
      const { osPorNumero, apontamentosPorOs } = await obterCache();
      const numeros = [...new Set(ordens.map(o => o.numeroOs).filter(n => n?.trim()).map(normalizarNumeroOs))];
      for (const numeroOs of numeros) {
        sigmaPorOs[numeroOs] = {
          os: osPorNumero.get(numeroOs) ?? null,
          apontamentos: apontamentosPorOs.get(numeroOs) ?? [],
        };
      }
    } catch (sigmaError) {
      console.error('[indicadores-manutencao-publico] SIGMA indisponível:', sigmaError.message);
    }

    return res.status(200).json({
      success: true,
      atualizadoEm: Date.now(),
      ordens,
      ferias: feriasRows.map(mapFerias),
      historico: historicoRows.map(mapHistorico),
      manuais: manuaisRows.map(mapManual),
      sigmaPorOs,
    });
  } catch (error) {
    console.error('[indicadores-manutencao-publico] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao carregar os indicadores.' });
  }
}
