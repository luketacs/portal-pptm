// Painel público: atividades e indicadores; afastamentos individuais ficam no servidor.
import { createRequire } from 'node:module';
import { fetchAllRows } from './_pagination-shared.js';
import { resumirDisponibilidade } from './_indicadores-hh-shared.js';
import { createClient } from '@supabase/supabase-js';
import { ALLOWED_ORIGINS, normalizarNumeroOs, obterCache } from './_sigma-shared.js';

const colaboradores = createRequire(import.meta.url)('../public/matriculas.json');

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

// Mesmo formato de mapFerias, pra atestado médico (manutencao_atestados).
const mapAtestado = mapFerias;

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

    const [ordensRows, feriasRows, atestadosRows, historicoRows, manuaisRows] = await Promise.all([
      fetchAllRows((from, to) => supabase.from('manutencao_programacao').select('*').order('semana_inicio', { ascending: false }).order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('manutencao_ferias').select('id, tecnico_nome, tecnico_matricula, area, data_inicio, data_fim').order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('manutencao_atestados').select('id, tecnico_nome, tecnico_matricula, area, data_inicio, data_fim').order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('manutencao_indicadores_historico').select('*').order('semana_inicio').order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('manutencao_indicadores_manuais').select('ano, chave, valor').order('ano').order('chave').range(from, to)),
    ]);

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

    // "Pessoas vendo agora" — reaproveita o próprio poll de ~3min que a página já faz
    // (sem requisição extra): cada aba manda seu sessaoId (gerado uma vez por
    // carregamento de página, via crypto.randomUUID no cliente) na query string, esta
    // function grava/atualiza o "sinal de vida" dela em manutencao_indicadores_presenca
    // e conta quantas sessões deram sinal nos últimos 6min (2x o intervalo de poll, pra
    // não "piscar" entre uma leva de poll e outra). Limpa sessões velhas (>15min) de
    // passagem, sem precisar de cron/job separado. Best-effort — nunca deve derrubar o
    // resto da resposta.
    let pessoasVendoAgora = null;
    const sessaoId = typeof req.query?.sessaoId === 'string' ? req.query.sessaoId.trim().slice(0, 100) : '';
    try {
      if (sessaoId) {
        await supabase.from('manutencao_indicadores_presenca')
          .upsert({ sessao_id: sessaoId, visto_em: new Date().toISOString() }, { onConflict: 'sessao_id' });
        await supabase.from('manutencao_indicadores_presenca')
          .delete().lt('visto_em', new Date(Date.now() - 15 * 60 * 1000).toISOString());
      }
      const { count } = await supabase.from('manutencao_indicadores_presenca')
        .select('sessao_id', { count: 'exact', head: true })
        .gte('visto_em', new Date(Date.now() - 6 * 60 * 1000).toISOString());
      pessoasVendoAgora = count ?? null;
    } catch (presencaError) {
      console.error('[indicadores-manutencao-publico] Presença indisponível:', presencaError.message);
    }

    const anos = [new Date().getFullYear(), new Date().getFullYear() + 1, ...ordens.map(o => Number(o.semanaInicio.slice(0, 4))), ...historicoRows.map(r => Number(r.semana_inicio.slice(0, 4)))];
    const disponibilidade = resumirDisponibilidade(ordens, [...feriasRows.map(mapFerias), ...atestadosRows.map(mapAtestado)], colaboradores, anos);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      atualizadoEm: Date.now(),
      ordens: ordens.filter(o => o.tipo === 'ordem'),
      disponibilidade,
      historico: historicoRows.map(mapHistorico),
      manuais: manuaisRows.map(mapManual),
      sigmaPorOs,
      pessoasVendoAgora,
    });
  } catch (error) {
    console.error('[indicadores-manutencao-publico] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao carregar os indicadores.' });
  }
}
