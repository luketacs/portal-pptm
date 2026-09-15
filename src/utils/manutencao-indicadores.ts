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
// indiceAtingimentoMeta() abaixo. Usado por Atendimento à Programação e Cumprimento do
// Plano (os dois indicadores calculados ao vivo desta tela).
export const PISO_INDICE_META = 92.0;
export const TETO_INDICE_META = 100.0;

// Régua dos indicadores de input MANUAL (não calculados a partir de ordens — digitados
// à mão, ver ManutencaoIndicadoresManuaisService/manutencao_indicadores_manuais).
// "Quanto maior, melhor": Disponibilidade Global Anual. "Quanto menor, melhor": Dias/
// Navio (menos dias parado é melhor) — piso > meta > teto de propósito, é isso que faz
// indiceAtingimentoMeta() entrar no ramo invertido da régua (ver comentário lá).
export const PISO_DISPONIBILIDADE_GLOBAL = 72.0;
export const META_DISPONIBILIDADE_GLOBAL = 81.0;
export const TETO_DISPONIBILIDADE_GLOBAL = 90.0;
export const PISO_DIAS_NAVIO = 5.0;
export const META_DIAS_NAVIO = 4.5;
export const TETO_DIAS_NAVIO = 4.0;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Índice de atingimento de meta em 3 trechos (0-75%, 75-100%, 100-125%), mesma régua da
// planilha de PLR do Corporativo. Cobre os dois sentidos, decididos pela ordem de
// piso/teto — mesmo critério `SE(H6>F6;...)` da fórmula original de Excel:
//
// "Quanto maior, melhor" (teto > piso — caso de Atendimento à Programação, Cumprimento
// do Plano, Disponibilidade Global Anual):
//   valor <= piso            -> rampa 0% a 75%   (interpolação entre (0,0%) e (piso,75%))
//   piso < valor < meta      -> rampa 75% a 100%
//   meta <= valor < teto     -> rampa 100% a 125%
//   valor >= teto            -> trava em 125%
//
// "Quanto menor, melhor" (teto < piso — caso de Dias/Navio, onde menos é melhor):
//   valor <= teto             -> trava em 125%
//   teto < valor < meta       -> rampa 125% a 100%
//   meta <= valor < piso      -> rampa 100% a 75%
//   valor >= piso             -> rampa 75% a 0%  (interpolação entre (piso,75%) e
//                                (2×piso,0%) — mesmo "dobro do piso = pior caso
//                                possível" da planilha original, único ponto sem uma
//                                quarta referência explícita pra ancorar a reta)
// Retorna em pontos percentuais (125 = 125%), não fração.
export function indiceAtingimentoMeta(valor: number, piso: number, meta: number, teto: number): number {
  let indice: number;
  if (teto > piso) {
    // Quanto maior, melhor.
    if (valor <= piso) {
      indice = piso > 0 ? 0.75 * (valor / piso) : 0;
    } else if (valor < meta) {
      indice = 0.75 + 0.25 * ((valor - piso) / (meta - piso));
    } else if (valor < teto) {
      indice = 1 + 0.25 * ((valor - meta) / (teto - meta));
    } else {
      indice = 1.25;
    }
  } else {
    // Quanto menor, melhor (piso > meta > teto).
    if (valor <= teto) {
      indice = 1.25;
    } else if (valor < meta) {
      indice = 1.25 - 0.25 * ((valor - teto) / (meta - teto));
    } else if (valor < piso) {
      indice = 1 - 0.25 * ((valor - meta) / (piso - meta));
    } else {
      indice = piso > 0 ? 0.75 * (2 - valor / piso) : 0;
    }
  }
  return Math.max(0, round2(indice * 100));
}

export type MatchColaborador = (matricula: string | null, nome: string) => { matricula: string } | null;

export interface ContagemExecucao {
  programadas: number;
  executadas: number;
  parciais: number;
  naoExecutadas: number;
  atendimento: number;
}

function contarExecucao(
  ordens: ManutencaoOrdem[], sigmaPorOs: Record<string, ConsultaSigmaResultado>,
  matchColaborador: MatchColaborador,
): ContagemExecucao {
  const statusPorGrupo = ordemExecutadaAgrupada(ordens, sigmaPorOs, matchColaborador);
  const programadas = statusPorGrupo.length;
  const executadas = statusPorGrupo.filter(s => s === 'executada').length;
  // 'parcial' (OS dividida entre técnicos, só alguns apontaram) não conta como
  // executada nem como não-executada — fica numa contagem própria pra não inflar
  // nenhuma das duas nem embaralhar o percentual de atendimento (que continua medindo
  // "% totalmente concluída").
  const parciais = statusPorGrupo.filter(s => s === 'parcial').length;
  return {
    programadas, executadas, parciais, naoExecutadas: programadas - executadas - parciais,
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
  LIMP_OPERACIONAL: 'Limpeza Operacional',
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
