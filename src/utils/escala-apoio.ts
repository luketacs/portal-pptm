// Escala de turno da equipe de Operação/Apoio: rodízio fixo de 8 dias
// (D,D,N,N,F,F,F,F — 2 dias, 2 noites, 4 folgas), com as 4 equipes (A/B/C/D)
// defasadas 2 dias uma da outra, cobrindo o ciclo inteiro. Não é algo editado
// manualmente — dado o padrão e uma data-âncora, dá pra calcular o turno de
// qualquer equipe em qualquer data. Conferido contra "PROGRAMAÇÃO APOIO JUL.xlsx"
// (aba "escala"), que já vem pré-preenchida com esse mesmo padrão pro ano inteiro.
export type EquipeApoio = 'A' | 'B' | 'C' | 'D';
export type Turno = 'D' | 'N' | 'F';

export const TURNO_LABEL: Record<Turno, string> = {
  D: 'Dia',
  N: 'Noite',
  F: 'Folga',
};

const PADRAO: Turno[] = ['D', 'D', 'N', 'N', 'F', 'F', 'F', 'F'];
// Deslocamento de cada equipe dentro do ciclo de 8 dias, relativo à equipe A.
const DESLOCAMENTO: Record<EquipeApoio, number> = { A: 0, B: 2, C: 4, D: 6 };
// Segunda-feira usada como referência (dia 0 do ciclo da equipe A) — 29/12/2025.
const DATA_ANCORA_UTC = Date.UTC(2025, 11, 29);

export function turnoNoDia(equipe: EquipeApoio, dataIso: string): Turno {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const dataUtc = Date.UTC(ano, mes - 1, dia);
  const diasDesdeAncora = Math.round((dataUtc - DATA_ANCORA_UTC) / 86400000);
  const indice = (((diasDesdeAncora - DESLOCAMENTO[equipe]) % 8) + 8) % 8;
  return PADRAO[indice];
}
