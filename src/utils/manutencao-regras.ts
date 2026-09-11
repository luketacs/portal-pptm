// Regras de negócio da Programação de Manutenção extraídas do componente pra funções
// puras testáveis — capacidade semanal, bloqueio de duplicata/folga/férias e o
// espelhamento de "Recursos" (quem entra na cópia da OS pro apoio) são as áreas que
// mais geraram bug nesta funcionalidade (dado sutil errado, direção de checagem
// faltando, recurso incluindo a si mesmo), por isso ganham teste dedicado.
import { FeriasTecnico, ManutencaoOrdem } from '../models/manutencao-programacao.model';

export const HORAS_EXAME_MEDICO = 3.5;
// Treinamento desconta por dia (customizável por lançamento, ver duracaoHoras) — sem
// valor informado (lançamentos antigos, de antes desse campo existir pro tipo
// treinamento, ou quem não preencheu), assume "dia todo".
export const HORAS_TREINAMENTO_DIA_TODO = 6.5;
export const HORAS_TREINAMENTO_MEIO_PERIODO = 3.5;

export interface DiaSemana {
  data: string;
  label: string;
}

export interface CalcularCapacidadeSemanaParams {
  dias: DiaSemana[];
  disponibilidadePorDia: Map<string, number>;
  diasFolga: Set<string>;
  diasExameMedico: Set<string>;
  // Dia -> horas de treinamento a descontar naquele dia (soma se houver mais de um
  // lançamento no mesmo dia). Opcional pra não quebrar quem já chama essa função sem
  // treinamento pra considerar.
  horasTreinamentoPorDia?: Map<string, number>;
  feriasIntervalo: { dataInicio: string; dataFim: string } | null;
}

// Soma a disponibilidade base nos dias úteis (SEG-SEX — fim de semana é DSR, ninguém
// trabalha por padrão). Folga e dias dentro do período de férias tiram o dia inteiro da
// conta; exame médico (ASO) só desconta HORAS_EXAME_MEDICO daquele dia (o exame não toma
// o dia todo); treinamento desconta o valor de horasTreinamentoPorDia daquele dia
// (6,5 = dia todo, 3,5 = meio período, ou outro valor customizado no lançamento);
// reunião não desconta nada (não bloqueia o resto da agenda do dia).
export function calcularCapacidadeSemana(params: CalcularCapacidadeSemanaParams): number {
  const { dias, disponibilidadePorDia, diasFolga, diasExameMedico, horasTreinamentoPorDia, feriasIntervalo } = params;
  let total = 0;
  for (const dia of dias) {
    if (dia.label === 'SAB' || dia.label === 'DOM') continue;
    if (diasFolga.has(dia.data)) continue;
    if (feriasIntervalo && dia.data >= feriasIntervalo.dataInicio && dia.data <= feriasIntervalo.dataFim) continue;
    let disponivel = disponibilidadePorDia.get(dia.data) ?? 0;
    if (diasExameMedico.has(dia.data)) disponivel = Math.max(0, disponivel - HORAS_EXAME_MEDICO);
    const horasTreinamento = horasTreinamentoPorDia?.get(dia.data);
    if (horasTreinamento) disponivel = Math.max(0, disponivel - horasTreinamento);
    total += disponivel;
  }
  return parseFloat(total.toFixed(2));
}

// Período de férias do técnico que toca algum dos dias informados.
export function encontrarFeriasNoIntervalo(ferias: FeriasTecnico[], tecnicoNome: string, diasIso: string[]): FeriasTecnico | null {
  if (diasIso.length === 0) return null;
  return ferias.find(f => f.tecnicoNome === tecnicoNome && diasIso.some(d => d >= f.dataInicio && d <= f.dataFim)) ?? null;
}

// Folga já lançada pro técnico que toca algum dos dias informados — usada nos três
// pontos de criação (form individual, lote de Reunião, lote de Feriado) pra nunca
// lançar nada em cima de um dia de folga já existente, nas duas direções.
export function encontrarFolgaNoIntervalo(
  ordens: ManutencaoOrdem[], tecnicoNome: string, diasIso: string[], idExcluir?: string | null,
): ManutencaoOrdem | null {
  if (diasIso.length === 0) return null;
  return ordens.find(o =>
    o.tipo === 'folga' && o.tecnicoNome === tecnicoNome && o.id !== idExcluir && o.diasPrevistos.some(d => diasIso.includes(d)),
  ) ?? null;
}

// Mesma OS já lançada pro mesmo técnico em algum dos dias informados — `numeroOsNormalizado`
// já deve vir normalizado (ver normalizarNumeroOs no componente) pra "45203" e "045203"
// baterem como a mesma OS.
export function encontrarOrdemDuplicada(
  ordens: ManutencaoOrdem[], numeroOsNormalizado: string, tecnicoNome: string, diasIso: string[],
  normalizar: (v: string) => string, idExcluir?: string | null,
): ManutencaoOrdem | null {
  if (!numeroOsNormalizado.trim() || diasIso.length === 0) return null;
  return ordens.find(o =>
    o.id !== idExcluir && o.tipo === 'ordem' && o.tecnicoNome === tecnicoNome
      && !!o.numeroOs && normalizar(o.numeroOs) === numeroOsNormalizado
      && o.diasPrevistos.some(d => diasIso.includes(d)),
  ) ?? null;
}

// Monta o texto do campo "Recursos" pra cópia espelhada de uma OS: da perspectiva de
// quem recebe a cópia, "Recursos" é quem MAIS está no serviço — o mandante (quem
// lançou a OS original) e os outros ajudantes, nunca a própria pessoa/empresa que está
// recebendo a cópia (senão ela aparece listada como recurso de si mesma). `ehODestinatario`
// deixa o chamador decidir o critério de exclusão: nome exato (espelho pra técnico) ou
// mapeamento pra empresa (espelho pra empresa/equipamento, onde duas opções diferentes
// podem apontar pra mesma empresa).
export function recursosParaEspelho(recursosOriginais: string[], ehODestinatario: (recurso: string) => boolean, mandante: string): string {
  return [...recursosOriginais.filter(r => !ehODestinatario(r)), mandante].join(', ');
}

// Semana fechada (ver "Fechar programação da semana", migration 031) — só Admin
// consegue criar/editar/excluir lançamento numa semana fechada; pra todo mundo mais
// vira somente leitura. Mesma regra usada tanto pro guard que bloqueia a mutação no
// serviço (garantirSemanaAberta) quanto pra decidir se mostra os botões habilitados na
// tela (podeEditarSemana no componente) — uma função só, pra nunca divergir entre os
// dois lugares.
export function podeEditarSemanaFechada(semanaFechada: boolean, ehAdmin: boolean): boolean {
  return !semanaFechada || ehAdmin;
}
