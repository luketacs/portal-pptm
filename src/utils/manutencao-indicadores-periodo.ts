// Helpers puros de data/período do Acompanhamento de Indicadores (Semanal/Mensal) —
// extraídos do componente autenticado (manutencao-indicadores-semanais.component.ts)
// porque o componente público (manutencao-indicadores-publico.component.ts) também
// precisa deles: em vez de duplicar, as duas telas importam a mesma implementação.
// `semanasDoMes` em especial tem uma regra sutil (evitar vazar a última semana do mês
// anterior) já corrigida numa rodada anterior — vale ficar num lugar só.
import { ContagemExecucao } from './manutencao-indicadores';
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
// calculados (um grupo com 2 ordens a 100% e outro com 20 a 0% não é "50%").
export function somarContagem(a: ContagemExecucao, b: ContagemExecucao): ContagemExecucao {
  const programadas = a.programadas + b.programadas;
  const executadas = a.executadas + b.executadas;
  return {
    programadas, executadas, naoExecutadas: programadas - executadas,
    atendimento: programadas > 0 ? Math.round((executadas / programadas) * 10000) / 100 : 0,
  };
}
