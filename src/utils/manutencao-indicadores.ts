// Fórmulas puras do Acompanhamento de Indicadores Semanais — substitui a leitura de
// planilha do antigo Relatório Semanal PCM (src/utils/relatorio-semanal-pcm.ts) por
// cálculo ao vivo em cima das ordens do Portal. Reaproveita a mesma metas/regra de
// status daquele relatório e o mesmo critério de "executada" (ordemExecutadaAgrupada,
// que considera qualquer apontamento do técnico dentro da SEMANA da ordem, não só nos
// dias originalmente previstos), sem duplicar nenhum dos dois.
import { CategoriaIndicador, ConsultaSigmaResultado, ManutencaoOrdem } from '../models/manutencao-programacao.model';
import { ordemExecutadaAgrupada } from './manutencao-dashboard';

export type StatusGeralSemana = 'Dentro da Meta' | 'Próximo da Meta' | 'Abaixo da Meta';

export const META_ATENDIMENTO = 91.0;
export const META_CUMPRIMENTO = 93.0;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type MatchColaborador = (matricula: string | null, nome: string) => { matricula: string } | null;

export interface ContagemExecucao {
  programadas: number;
  executadas: number;
  naoExecutadas: number;
  atendimento: number;
}

function contarExecucao(
  ordens: ManutencaoOrdem[], sigmaPorOs: Record<string, ConsultaSigmaResultado>,
  matchColaborador: MatchColaborador,
): ContagemExecucao {
  const executadaPorGrupo = ordemExecutadaAgrupada(ordens, sigmaPorOs, matchColaborador);
  const programadas = executadaPorGrupo.length;
  const executadas = executadaPorGrupo.filter(Boolean).length;
  return {
    programadas, executadas, naoExecutadas: programadas - executadas,
    atendimento: programadas > 0 ? round2((executadas / programadas) * 100) : 0,
  };
}

export const CATEGORIAS_INDICADOR: CategoriaIndicador[] = ['MECANICA', 'ELETRICA', 'LIMP_OPERACIONAL', 'REFRIGERACAO', 'SPCI'];

export const CATEGORIA_LABEL: Record<CategoriaIndicador, string> = {
  MECANICA: 'Mecânica',
  ELETRICA: 'Elétrica',
  LIMP_OPERACIONAL: 'Limp Operacional',
  REFRIGERACAO: 'Refrigeração',
  SPCI: 'SPCI',
};

export interface IndicadorArea extends ContagemExecucao {
  categoria: CategoriaIndicador | null; // null = "Não classificado" (Apoio sem categoria escolhida)
  cumprimentoPlano: ContagemExecucao; // mesmo recorte de cumprimentoPlano da semana, só que restrito a essa área
}

export interface IndicadoresSemana {
  geral: ContagemExecucao;
  cumprimentoPlano: ContagemExecucao; // "atendimento" aqui é o Cumprimento do Plano
  porArea: IndicadorArea[];
  statusGeral: StatusGeralSemana;
}

// `ordens` já deve vir filtrada (tipo==='ordem' e semana selecionada) — esta função só
// agrega, não decide o que faz parte da semana.
export function calcularIndicadoresSemana(params: {
  ordens: ManutencaoOrdem[];
  sigmaPorOs: Record<string, ConsultaSigmaResultado>;
  matchColaborador: MatchColaborador;
}): IndicadoresSemana {
  const { ordens, sigmaPorOs, matchColaborador } = params;
  const calc = (subset: ManutencaoOrdem[]) => contarExecucao(subset, sigmaPorOs, matchColaborador);

  const geral = calc(ordens);

  // Cumprimento do Plano = plano de manutenção PREVENTIVA (tipoServico), não o vínculo
  // opcional com um registro de Plano cadastrado (planoPreventivoId) — nem toda
  // preventiva nasce de um Plano formal, mas todas contam pro cumprimento do plano.
  const doPlano = ordens.filter(o => o.tipoServico?.trim().toUpperCase() === 'PREVENTIVA');
  const porArea: IndicadorArea[] = [...CATEGORIAS_INDICADOR, null]
    .map(categoria => ({
      categoria,
      ...calc(ordens.filter(o => o.categoriaIndicador === categoria)),
      cumprimentoPlano: calc(doPlano.filter(o => o.categoriaIndicador === categoria)),
    }))
    .filter(a => a.programadas > 0);

  const cumprimentoPlano = calc(doPlano);

  let statusGeral: StatusGeralSemana;
  if (geral.atendimento >= META_ATENDIMENTO && cumprimentoPlano.atendimento >= META_CUMPRIMENTO) {
    statusGeral = 'Dentro da Meta';
  } else if (geral.atendimento >= META_ATENDIMENTO * 0.9 || cumprimentoPlano.atendimento >= META_CUMPRIMENTO * 0.9) {
    statusGeral = 'Próximo da Meta';
  } else {
    statusGeral = 'Abaixo da Meta';
  }

  return { geral, cumprimentoPlano, porArea, statusGeral };
}
