// Fórmulas puras do Acompanhamento de Indicadores Semanais — substitui a leitura de
// planilha do antigo Relatório Semanal PCM (src/utils/relatorio-semanal-pcm.ts) por
// cálculo ao vivo em cima das ordens do Portal. Reaproveita a mesma metas/regra de
// status daquele relatório e o mesmo critério de "executada" (ordemExecutadaAgrupada,
// que considera qualquer apontamento do técnico dentro da SEMANA da ordem, não só nos
// dias originalmente previstos), sem duplicar nenhum dos dois.
import { CategoriaIndicador, ConsultaSigmaResultado, ManutencaoOrdem } from '../models/manutencao-programacao.model';
import { ordemExecutadaAgrupada } from './manutencao-dashboard';

export type StatusGeralSemana = 'Dentro da Meta' | 'Próximo da Meta' | 'Abaixo da Meta';

export const META_ATENDIMENTO = 95.0;
export const META_CUMPRIMENTO = 95.0;

// Régua do índice de atingimento da meta (PLR) — mesma planilha usada pro Corporativo:
// piso (92%) -> índice 75%; meta (95%) -> índice 100%; teto (100%) -> índice 125%,
// travado em 125% dali pra cima. Interpolação linear dentro de cada trecho — ver
// indiceAtingimentoMeta() abaixo.
export const PISO_INDICE_META = 92.0;
export const TETO_INDICE_META = 100.0;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Índice de atingimento de meta em 3 trechos (0-75%, 75-100%, 100-125%), mesma fórmula
// da planilha de PLR do Corporativo (célula com o MÁXIMO/SE encadeado) — só a metade
// "quanto maior, melhor" (piso < meta < teto), que é o caso dos dois indicadores desta
// tela (Atendimento à Programação e Cumprimento do Plano, ambos "mais é melhor"). Não
// implementa a metade invertida da fórmula original (pra indicadores "quanto menor,
// melhor", tipo Custo/Turnover) porque esta tela não tem nenhum indicador desse tipo.
//   valor <= piso            -> rampa 0% a 75%
//   piso < valor < meta      -> rampa 75% a 100%
//   meta <= valor < teto     -> rampa 100% a 125%
//   valor >= teto            -> trava em 125%
// Retorna em pontos percentuais (125 = 125%), não fração.
export function indiceAtingimentoMeta(valor: number, piso: number, meta: number, teto: number): number {
  let indice: number;
  if (valor <= piso) {
    indice = piso > 0 ? 0.75 * (valor / piso) : 0;
  } else if (valor < meta) {
    indice = 0.75 + 0.25 * ((valor - piso) / (meta - piso));
  } else if (valor < teto) {
    indice = 1 + 0.25 * ((valor - meta) / (teto - meta));
  } else {
    indice = 1.25;
  }
  return Math.max(0, round2(indice * 100));
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
    // 0 programadas = 100%, não 0% — nada previsto pro período é, por definição,
    // cumprido por completo (nada ficou faltando). Pedido do usuário: uma área como
    // SPCI sem nenhuma ordem do plano numa semana não deve aparecer como "0%" de
    // Cumprimento do Plano (lê como falha total), e sim 100%.
    atendimento: programadas > 0 ? round2((executadas / programadas) * 100) : 100,
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
