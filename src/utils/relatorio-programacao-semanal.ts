// Extrai horas programadas por colaborador a partir da planilha semanal de
// programação (ex.: "PROGRAMAÇÃO MANUTENÇÃO PPTM S34.xlsx") — usada na reconciliação
// de horas do Relatório Mensal PCM (Fase 3). Formato atual: um arquivo por semana,
// com uma aba por área (ex.: ELÉTRICA, MECÂNICA); cada linha é uma Ordem de Serviço
// (OS) atribuída a um executante, com colunas "EXECUTANTE" e "DURAÇÃO" (horas).
// Soma-se a duração de TODAS as linhas do executante na aba, independente do que a
// coluna "SEMANA" da linha diz (ela mistura OS da semana atual e carregadas de
// semanas anteriores — o arquivo inteiro é o plano de trabalho da semana, então tudo
// conta). Diferente do formato antigo (um arquivo por mês/área, com abas por semana
// "S1".."S5" e duração numa coluna fixa) que o gerador Python original esperava.

export interface HorasProgramadasPorColaborador {
  [nomeNormalizado: string]: number;
}

function normalizarRotulo(valor: unknown): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Acha a linha de cabeçalho de uma aba procurando as colunas "EXECUTANTE" e
// "DURAÇÃO" — não por posição fixa, já que o layout pode variar entre arquivos.
// Abas sem essas duas colunas (ex.: uma aba "APOIO" vazia) retornam null e são
// ignoradas, em vez de precisar de uma lista de nomes de aba pra excluir.
function localizarColunasCabecalho(rows: unknown[][]): { colExecutante: number; colDuracao: number } | null {
  for (const row of rows) {
    if (!row) continue;
    let colExecutante = -1;
    let colDuracao = -1;
    for (let c = 0; c < row.length; c++) {
      const rotulo = normalizarRotulo(row[c]);
      if (rotulo === 'EXECUTANTE') colExecutante = c;
      if (rotulo === 'DURAÇÃO' || rotulo === 'DURACAO') colDuracao = c;
    }
    if (colExecutante >= 0 && colDuracao >= 0) return { colExecutante, colDuracao };
  }
  return null;
}

// `abas` = uma matriz de linhas (unknown[][]) por aba relevante da planilha —
// normalmente ELÉTRICA e MECÂNICA, já filtradas pelo chamador.
export function extrairHorasProgramadasSemana(abas: unknown[][][]): HorasProgramadasPorColaborador {
  const totais: HorasProgramadasPorColaborador = {};

  for (const rows of abas) {
    const cabecalho = localizarColunasCabecalho(rows);
    if (!cabecalho) continue;

    for (const row of rows) {
      const nomeRaw = row?.[cabecalho.colExecutante];
      if (typeof nomeRaw !== 'string') continue;
      const nome = normalizarRotulo(nomeRaw);
      if (!nome || nome === 'EXECUTANTE') continue;

      const duracaoRaw = row?.[cabecalho.colDuracao];
      const duracao = typeof duracaoRaw === 'number'
        ? duracaoRaw
        : parseFloat(String(duracaoRaw ?? '').trim().replace(',', '.'));
      if (!Number.isFinite(duracao)) continue;

      totais[nome] = round2((totais[nome] ?? 0) + duracao);
    }
  }

  return totais;
}
