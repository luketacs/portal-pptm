// Extrai horas programadas por colaborador a partir da planilha de programação —
// usada na reconciliação de horas do Relatório Mensal PCM (Fase 3). Suporta dois
// layouts, detectados automaticamente por aba:
//
// 1. "simples" (ex.: um arquivo antigo "PROGRAMAÇÃO MANUTENÇÃO PPTM S34.xlsx" que
//    circulou nesta sessão, mas acabou não sendo o formato real usado): cabeçalho
//    com "EXECUTANTE" e "DURAÇÃO" rotulados, uma linha por Ordem de Serviço (OS),
//    executante repetido em toda linha.
//
// 2. "mesclado" (o formato real, usado tanto nos arquivos por semana — ex.:
//    "PROGRAMAÇÃO MANUTENÇÃO ELÉTRICA S27.xlsx" — quanto nos arquivos por mês com
//    uma aba por semana — ex.: "PROGRAMAÇÃO ELÉTRICA JUL.xlsx", abas "S19".."S31"):
//    não tem rótulo "EXECUTANTE" — o nome fica na coluna imediatamente à esquerda de
//    "ORDEM", só na primeira linha do bloco daquele colaborador (célula mesclada no
//    Excel); as linhas seguintes do mesmo bloco ficam com essa coluna em branco até
//    o próximo nome. Cada bloco termina com uma linha de "mini-cabeçalho" repetido
//    ("ORDEM"/"DURAÇÃO" de novo, sem dado), que é ignorada. Linhas de afastamento/
//    férias (ex.: ordem = "FÉRIAS 29/07 - 10/07") não têm duração numérica e são
//    puladas naturalmente, sem precisar de detecção especial.

export interface HorasProgramadasPorColaborador {
  [nomeNormalizado: string]: number;
}

interface CabecalhoSimples {
  tipo: 'simples';
  colExecutante: number;
  colDuracao: number;
}

interface CabecalhoMesclado {
  tipo: 'mesclado';
  colExecutante: number;
  colOrdem: number;
  colDuracao: number;
}

function normalizarRotulo(valor: unknown): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseDuracao(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Acha o período (início/fim) de uma aba a partir do título (ex.: "PROGRAMAÇÃO
// MANUTENÇÃO ELÉTRICA - S27 2026 (29/06 À 05/07)") — usado pelo chamador pra
// decidir quais abas de um arquivo com várias semanas (ex.: um arquivo por
// mês/área, com uma aba por semana "S19".."S31") caem dentro do período do
// relatório. Retorna null se não achar o padrão (ex.: título em outro formato) —
// nesse caso o chamador deve tratar a aba como sempre incluída.
const REGEX_PERIODO_ABA = /S\d+\s+(\d{4})[^(]*\((\d{2})\/(\d{2})\s*[ÀA]\s*(\d{2})\/(\d{2})\)/i;

export function extrairPeriodoAba(rows: unknown[][]): { inicio: Date; fim: Date } | null {
  for (const row of rows) {
    if (!row) continue;
    for (const celula of row) {
      if (typeof celula !== 'string') continue;
      const m = REGEX_PERIODO_ABA.exec(celula);
      if (!m) continue;

      const [, anoStr, dIni, mIni, dFim, mFim] = m;
      const ano = Number(anoStr);
      const inicio = new Date(Date.UTC(ano, Number(mIni) - 1, Number(dIni)));
      const anoFim = Number(mFim) < Number(mIni) ? ano + 1 : ano; // virada de ano (ex.: DEZ->JAN)
      const fim = new Date(Date.UTC(anoFim, Number(mFim) - 1, Number(dFim)));
      return { inicio, fim };
    }
  }
  return null;
}

// Acha a linha de cabeçalho de uma aba e detecta qual dos dois layouts ela usa —
// não por posição fixa, já que o layout pode variar entre arquivos. Abas sem
// nenhum dos dois (ex.: uma aba "APOIO"/"backlog" vazia ou de outro formato)
// retornam null e são ignoradas, em vez de precisar de uma lista de nomes pra
// excluir.
function localizarColunasCabecalho(rows: unknown[][]): CabecalhoSimples | CabecalhoMesclado | null {
  for (const row of rows) {
    if (!row) continue;
    let colExecutanteRotulado = -1;
    let colOrdem = -1;
    let colDuracao = -1;
    for (let c = 0; c < row.length; c++) {
      const rotulo = normalizarRotulo(row[c]);
      if (rotulo === 'EXECUTANTE') colExecutanteRotulado = c;
      if (rotulo === 'ORDEM') colOrdem = c;
      if (rotulo === 'DURAÇÃO' || rotulo === 'DURACAO') colDuracao = c;
    }
    if (colExecutanteRotulado >= 0 && colDuracao >= 0) {
      return { tipo: 'simples', colExecutante: colExecutanteRotulado, colDuracao };
    }
    // Sem "EXECUTANTE" rotulado: no layout mesclado o nome fica na coluna
    // imediatamente antes de "ORDEM" — precisa ter pelo menos uma coluna à
    // esquerda (colOrdem >= 1), senão não haveria onde o nome caber.
    if (colOrdem >= 1 && colDuracao >= 0) {
      return { tipo: 'mesclado', colExecutante: colOrdem - 1, colOrdem, colDuracao };
    }
  }
  return null;
}

function extrairAbaSimples(rows: unknown[][], cabecalho: CabecalhoSimples, totais: HorasProgramadasPorColaborador): void {
  for (const row of rows) {
    const nomeRaw = row?.[cabecalho.colExecutante];
    if (typeof nomeRaw !== 'string') continue;
    const nome = normalizarRotulo(nomeRaw);
    if (!nome || nome === 'EXECUTANTE') continue;

    const duracao = parseDuracao(row?.[cabecalho.colDuracao]);
    if (duracao === null) continue;

    totais[nome] = round2((totais[nome] ?? 0) + duracao);
  }
}

function extrairAbaMesclada(rows: unknown[][], cabecalho: CabecalhoMesclado, totais: HorasProgramadasPorColaborador): void {
  let executanteAtual = '';
  for (const row of rows) {
    const nomeRaw = row?.[cabecalho.colExecutante];
    if (typeof nomeRaw === 'string') {
      const nome = normalizarRotulo(nomeRaw);
      if (nome) executanteAtual = nome;
    }
    if (!executanteAtual) continue;

    // Pula a linha de mini-cabeçalho repetido entre blocos (ex.: "ORDEM"/"DURAÇÃO"
    // de novo, sem dado nenhum na linha).
    if (normalizarRotulo(row?.[cabecalho.colOrdem]) === 'ORDEM') continue;

    const duracao = parseDuracao(row?.[cabecalho.colDuracao]);
    if (duracao === null) continue; // também cobre linhas de férias/afastamento

    totais[executanteAtual] = round2((totais[executanteAtual] ?? 0) + duracao);
  }
}

// `abas` = uma matriz de linhas (unknown[][]) por aba relevante da planilha —
// pode ser um mix de abas em qualquer um dos dois layouts.
export function extrairHorasProgramadasSemana(abas: unknown[][][]): HorasProgramadasPorColaborador {
  const totais: HorasProgramadasPorColaborador = {};

  for (const rows of abas) {
    const cabecalho = localizarColunasCabecalho(rows);
    if (!cabecalho) continue;

    if (cabecalho.tipo === 'simples') {
      extrairAbaSimples(rows, cabecalho, totais);
    } else {
      extrairAbaMesclada(rows, cabecalho, totais);
    }
  }

  return totais;
}
