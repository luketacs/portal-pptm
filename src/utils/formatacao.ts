// Helpers de formatação genéricos, sem estado — estavam reimplementados idênticos em
// vários módulos de src/utils/ (cada relatorio-*.ts foi criado copiando o anterior).

// Arredonda pra 2 casas decimais — usado em toda conta de hora/percentual dos
// relatórios PCM e dos Indicadores de Manutenção.
export function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Remove acentos e deixa maiúsculo — usado pra comparar/casar texto livre (nome de
// colaborador, área) vindo de fontes diferentes (planilha, SIGMA) sem risco de acento/
// caixa divergente. Aceita null/undefined (vira string vazia) — algumas fontes de dado
// (planilha) podem ter célula vazia nessa coluna.
export function normalizarAscii(texto: string | null | undefined): string {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
