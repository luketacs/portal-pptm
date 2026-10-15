// Helpers puros de data/período do Acompanhamento de Indicadores (Semanal/Mensal) —
// extraídos do componente autenticado (manutencao-indicadores-semanais.component.ts)
// porque o componente público (manutencao-indicadores-publico.component.ts) também
// precisa deles: em vez de duplicar, as duas telas importam a mesma implementação.
// `semanasDoMes` em especial tem uma regra sutil (evitar vazar a última semana do mês
// anterior) já corrigida numa rodada anterior — vale ficar num lugar só.
import { ImportarIndicadorHistoricoItem } from '../models/manutencao-programacao.model';
import {
  CATEGORIAS_INDICADOR, ContagemExecucao, IndicadorArea, IndicadoresSemana, META_ATENDIMENTO, META_CUMPRIMENTO, StatusGeralSemana,
} from './manutencao-indicadores';
import { MESES_ABREV, MESES_COMPLETO } from './relatorio-mensal-pcm';

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

export function segundaFeiraDe(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return date;
}

export function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatarDiaMes(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function diasDaSemana(segundaIso: string): { data: string; label: string }[] {
  const [ano, mes, dia] = segundaIso.split('-').map(Number);
  return DIAS_SEMANA_LABEL.map((label, i) => {
    const d = new Date(ano, mes - 1, dia + i);
    return { data: paraIso(d), label };
  });
}

export function normalizarTexto(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Mês ('YYYY-MM') a que uma semana pertence — convenção: pela segunda-feira
// (semanaInicio), igual o resto da tela já usa essa data como "identidade" da semana.
export function mesDaSemana(semanaInicioIso: string): string {
  return semanaInicioIso.slice(0, 7);
}

// Toda segunda-feira ('YYYY-MM-DD') dentro do mês 'YYYY-MM' — pro toggle Semana/Mês.
// Avança dia a dia (nunca pra trás) até a 1a segunda do mês, depois +7 em +7, validando
// CADA candidata via paraIso(...).slice(0,7)===mesIso (não confia só na aritmética de
// "primeira segunda") — evita vazar a última semana do mês anterior pra dentro do
// agrupamento caso a fórmula erre por 1.
export function semanasDoMes(mesIso: string): string[] {
  const [ano, mes] = mesIso.split('-').map(Number);
  const cursor = new Date(ano, mes - 1, 1);
  while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() + 1);
  const resultado: string[] = [];
  while (paraIso(cursor).slice(0, 7) === mesIso) {
    resultado.push(paraIso(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return resultado;
}

// Semanas (segundas) que entram no Consolidado do Ano ao vivo: da S37/2026 (início da
// Programação nativa) até o fim do período selecionado (pedido do usuário: setembro
// selecionado = acumulado até setembro), mas NUNCA além da semana de hoje — no modo Mês
// o mês corrente traz semanas futuras já programadas e sem execução, que puxavam o
// consolidado pra baixo.
export function semanasConsolidadoAno(fimPeriodoIso: string, hoje = new Date()): string[] {
  const hojeIso = paraIso(segundaFeiraDe(hoje));
  const fimIso = fimPeriodoIso < hojeIso ? fimPeriodoIso : hojeIso;
  const resultado: string[] = [];
  const cursor = segundaDaSemanaISO(2026, 37);
  while (paraIso(cursor) <= fimIso) {
    resultado.push(paraIso(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return resultado;
}

export function formatarMesLabel(mesIso: string): string {
  const [ano, mes] = mesIso.split('-');
  const abrev = MESES_ABREV[Number(mes) - 1];
  return `${MESES_COMPLETO[abrev]}/${ano}`;
}

// Semana ISO (norma ISO-8601, mesma conta usada no Dashboard da Programação).
export function numeroSemanaISO(dataIso: string): number {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const diaDaSemana = (data.getUTCDay() + 6) % 7;
  data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
  const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
  const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
  return 1 + Math.round(diffDias / 7);
}

export function segundaDaSemanaISO(ano: number, semana: number): Date {
  const referencia = new Date(ano, 0, 4);
  const diaDaSemana = (referencia.getDay() + 6) % 7;
  const segunda = new Date(ano, 0, 4 - diaDaSemana);
  segunda.setDate(segunda.getDate() + (semana - 1) * 7);
  return segunda;
}

// Soma duas contagens brutas e deriva o % do total — nunca faz média de percentuais já
// calculados (um grupo com 2 ordens a 100% e outro com 20 a 0% não é "50%"). 0
// programadas no total = 100%, mesmo critério de contarExecucao() em
// manutencao-indicadores.ts (nada previsto = cumprido por completo, não "0%").
export function somarContagem(a: ContagemExecucao, b: ContagemExecucao): ContagemExecucao {
  const programadas = a.programadas + b.programadas;
  const executadas = a.executadas + b.executadas;
  return {
    programadas, executadas, naoExecutadas: programadas - executadas,
    atendimento: programadas > 0 ? Math.round((executadas / programadas) * 10000) / 100 : 100,
  };
}

// Ano ISO da semana (ano da quinta-feira) — a S1/2026 começa na segunda 29/12/2025, e
// pelo ano da segunda ela ficava fora do Consolidado de 2026.
export function anoDaSemana(semanaInicioIso: string): number {
  const [a, m, d] = semanaInicioIso.split('-').map(Number);
  return new Date(a, m - 1, d + 3).getFullYear();
}

// Mês da semana pro Consolidado do Ano: mês da segunda-feira (mesDaSemana), exceto a
// semana que começa em dezembro mas pertence ao ano seguinte (S1) — essa vai pra
// janeiro, como na planilha do PCM.
function mesDaSemanaNoAno(semanaInicioIso: string): string {
  const ano = anoDaSemana(semanaInicioIso);
  return Number(semanaInicioIso.slice(0, 4)) < ano ? `${ano}-01` : mesDaSemana(semanaInicioIso);
}

type IndicadoresConsolidaveis =Pick<IndicadoresSemana, 'geral' | 'cumprimentoPlano' | 'porArea'>;

// Semanas do histórico importado (planilha, antes da S37/2026) no mesmo formato do
// cálculo ao vivo — GERAL vira geral/cumprimentoPlano, cada área vira um porArea.
export function semanasDoHistorico(itens: ImportarIndicadorHistoricoItem[]): { semana: string; ind: IndicadoresConsolidaveis }[] {
  const contagem = (programadas: number, executadas: number): ContagemExecucao =>
    somarContagem({ programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 }, { programadas, executadas, naoExecutadas: 0, atendimento: 0 });
  const porSemana = new Map<string, IndicadoresConsolidaveis>();
  for (const i of itens) {
    const ind = porSemana.get(i.semanaInicio) ?? { geral: contagem(0, 0), cumprimentoPlano: contagem(0, 0), porArea: [] };
    const geral = contagem(i.programadas, i.executadas);
    const plano = contagem(i.planejadasPlano, i.executadasPlano);
    if (i.categoria === 'GERAL') { ind.geral = geral; ind.cumprimentoPlano = plano; }
    else ind.porArea.push({ categoria: i.categoria, ...geral, cumprimentoPlano: plano });
    porSemana.set(i.semanaInicio, ind);
  }
  return [...porSemana.entries()].map(([semana, ind]) => ({ semana, ind }));
}

// Consolidado do Ano no critério da planilha do PCM (pedido do usuário): o % do ano é a
// MÉDIA SIMPLES dos % de cada mês — todo mês pesa igual, tenha 800 ou 300 ordens — e não
// o total de ordens do ano dividido uma vez. Mês = mês da segunda-feira (mesDaSemanaNoAno),
// mesmo agrupamento do modo Mês da tela; o % de cada mês sai da soma das contagens das
// suas semanas. Mês sem nenhuma ordem prevista fica fora da média (não entra como 100%).
// As contagens devolvidas (executadas/programadas) continuam sendo o total do ano — só
// pra exibição ("X de Y executadas no ano").
export function consolidarAnoPorMediaMensal(semanas: { semana: string; ind: IndicadoresConsolidaveis }[]): IndicadoresSemana {
  const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 };
  const consolidar = (pegar: (ind: IndicadoresConsolidaveis) => ContagemExecucao | undefined): ContagemExecucao => {
    const porMes = new Map<string, ContagemExecucao>();
    for (const { semana, ind } of semanas) {
      const c = pegar(ind);
      if (!c) continue;
      const mes = mesDaSemanaNoAno(semana);
      porMes.set(mes, somarContagem(porMes.get(mes) ?? zero, c));
    }
    const meses = [...porMes.values()];
    const total = meses.reduce((acc, m) => somarContagem(acc, m), zero);
    const comOrdem = meses.filter(m => m.programadas > 0);
    const media = comOrdem.length > 0
      ? Math.round((comOrdem.reduce((s, m) => s + m.atendimento, 0) / comOrdem.length) * 100) / 100
      : 100;
    return { ...total, atendimento: media };
  };

  const geral = consolidar(i => i.geral);
  const cumprimentoPlano = consolidar(i => i.cumprimentoPlano);
  const porArea: IndicadorArea[] = CATEGORIAS_INDICADOR
    .map((categoria): IndicadorArea => ({
      categoria,
      ...consolidar(i => i.porArea.find(a => a.categoria === categoria)),
      cumprimentoPlano: consolidar(i => i.porArea.find(a => a.categoria === categoria)?.cumprimentoPlano),
    }))
    .filter(a => a.programadas > 0);

  let statusGeral: StatusGeralSemana;
  if (geral.atendimento >= META_ATENDIMENTO && cumprimentoPlano.atendimento >= META_CUMPRIMENTO) statusGeral = 'Dentro da Meta';
  else if (geral.atendimento >= META_ATENDIMENTO * 0.9 || cumprimentoPlano.atendimento >= META_CUMPRIMENTO * 0.9) statusGeral = 'Próximo da Meta';
  else statusGeral = 'Abaixo da Meta';

  return { geral, cumprimentoPlano, porArea, statusGeral };
}
