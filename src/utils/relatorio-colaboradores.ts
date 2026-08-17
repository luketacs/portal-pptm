// Cruza os "nomes curtos" da planilha de Programação (ex.: "DANIEL", "ANT. JOSÉ")
// com a matrícula de verdade, usando a planilha de Matrículas como referência —
// port fiel de _mapear_nome_programacao_para_matricula (mensal.py). Necessário
// porque a Programação só tem primeiro nome/apelido, não a matrícula.

export interface RegistroMatricula {
  matricula: string;
  funcionario: string;
  area: string;
  email?: string;
  telefone?: string;
}

export type OrigemPrograma = 'MECANICA' | 'ELETRICA';

// Nomes que o casamento automático não resolve (empate ou nome curto demais) —
// mesma lista do original. Pode precisar de novas entradas conforme aparecerem
// mais empates nos dados reais.
export const APELIDOS_PROGRAMACAO_MATRICULA: Record<string, string> = {
  VLAD: '20006009',
  'ALEXANDRE OPE': '20005480',
  WILLIAN: '710624',
  WILLIAM: '710624',
  // "ANT." nunca bate com "ANTONIO" nem "NERI" no fuzzy (ratio < 0.82), então só a
  // palavra "JOSE" pontua -- empata "Antonio Jose" com "José Neri" (os dois da
  // Mecânica). Confirmado contra os dados reais (planilha de Programação real).
  'ANT. JOSE': '20006162',
};

function normalizarAscii(texto: string): string {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function normalizarNomeColaborador(valor: string): string {
  return normalizarAscii(valor).split(/\s+/).filter(Boolean).join(' ');
}

// Últimos 6 dígitos de uma matrícula (ignora prefixos como "01 -" ou "20" na
// frente) — é o que permite cruzar "20006162" (planilha de Matrículas) com
// "006162" (extraído do PDF de ponto).
export function matriculaSuffix6(valor: string | number): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.slice(-6).padStart(6, '0');
}

// Similaridade Ratcliff/Obershelp — mesmo algoritmo do difflib.SequenceMatcher
// (Python) usado no original, pra pegar erros de grafia (ex.: "ALVIMAR"/"ALVEMAR").
// Validado contra o difflib de verdade antes de portar (mesmos valores, casa decimal).
export function sequenceMatcherRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  return (2 * totalCaracteresCombinados(a, b)) / (a.length + b.length);
}

function totalCaracteresCombinados(a: string, b: string): number {
  let total = 0;
  const pilha: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (pilha.length > 0) {
    const [aLo, aHi, bLo, bHi] = pilha.pop()!;
    const [i, j, tamanho] = maiorBlocoComum(a, b, aLo, aHi, bLo, bHi);
    if (tamanho > 0) {
      total += tamanho;
      if (aLo < i && bLo < j) pilha.push([aLo, i, bLo, j]);
      if (i + tamanho < aHi && j + tamanho < bHi) pilha.push([i + tamanho, aHi, j + tamanho, bHi]);
    }
  }
  return total;
}

// Maior substring comum entre a[aLo:aHi] e b[bLo:bHi] — retorna [i, j, tamanho].
function maiorBlocoComum(
  a: string, b: string, aLo: number, aHi: number, bLo: number, bHi: number,
): [number, number, number] {
  let melhorI = aLo, melhorJ = bLo, melhorTamanho = 0;
  let jTamanhoAnterior = new Map<number, number>();

  for (let i = aLo; i < aHi; i++) {
    const jTamanhoAtual = new Map<number, number>();
    for (let j = bLo; j < bHi; j++) {
      if (a[i] === b[j]) {
        const tamanho = (jTamanhoAnterior.get(j - 1) ?? 0) + 1;
        jTamanhoAtual.set(j, tamanho);
        if (tamanho > melhorTamanho) {
          melhorI = i - tamanho + 1;
          melhorJ = j - tamanho + 1;
          melhorTamanho = tamanho;
        }
      }
    }
    jTamanhoAnterior = jTamanhoAtual;
  }

  return [melhorI, melhorJ, melhorTamanho];
}

// `rows` = planilha de Matrículas lida sem cabeçalho (header:1) — acha as colunas
// pelo rótulo (a real tem "Área " com espaço sobrando, então não dá pra confiar em
// nome exato).
export function parseMatriculas(rows: unknown[][]): RegistroMatricula[] {
  if (rows.length === 0) return [];

  const header = rows[0] ?? [];
  let colFuncionario = -1, colMatricula = -1, colArea = -1, colEmail = -1, colTelefone = -1;
  for (let c = 0; c < header.length; c++) {
    const rotulo = normalizarAscii(String(header[c] ?? '')).trim();
    if (rotulo.startsWith('FUNCIONARIO')) colFuncionario = c;
    else if (rotulo.startsWith('MATRICULA')) colMatricula = c;
    else if (rotulo.startsWith('AREA')) colArea = c;
    else if (rotulo.startsWith('E-MAIL') || rotulo.startsWith('EMAIL')) colEmail = c;
    else if (rotulo.startsWith('TELEFONE')) colTelefone = c;
  }

  if (colFuncionario === -1 || colMatricula === -1) {
    throw new Error('Não foi possível localizar as colunas "Funcionário" e "Matrícula" na planilha.');
  }

  const registros: RegistroMatricula[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const funcionario = String(row[colFuncionario] ?? '').trim();
    const matriculaRaw = row[colMatricula];
    if (!funcionario || matriculaRaw === undefined || matriculaRaw === '') continue;

    registros.push({
      funcionario,
      matricula: String(matriculaRaw).trim(),
      area: colArea >= 0 ? String(row[colArea] ?? '').trim() : '',
      email: colEmail >= 0 ? (String(row[colEmail] ?? '').trim() || undefined) : undefined,
      telefone: colTelefone >= 0 ? (String(row[colTelefone] ?? '').trim() || undefined) : undefined,
    });
  }
  return registros;
}

// Casa um nome curto da Programação com uma matrícula. Retorna null quando não
// acha nenhum candidato plausível OU quando há empate entre dois ou mais
// candidatos igualmente prováveis (de propósito — não arrisca um match errado).
export function mapearNomeProgramacaoParaMatricula(
  nomeProgramacaoNorm: string, origem: OrigemPrograma, matriculas: RegistroMatricula[],
): string | null {
  if (!nomeProgramacaoNorm) return null;

  const alias = APELIDOS_PROGRAMACAO_MATRICULA[nomeProgramacaoNorm];
  if (alias) return alias;

  const palavrasProg = nomeProgramacaoNorm.split(' ').filter(Boolean);
  const candidatos: { score: number; matricula: string }[] = [];

  for (const registro of matriculas) {
    const matricula = String(registro.matricula ?? '').trim();
    if (!matricula) continue;

    const nomeFunc = normalizarNomeColaborador(registro.funcionario ?? '');
    const areaFunc = normalizarNomeColaborador(registro.area ?? '');
    if (!nomeFunc) continue;

    const palavrasFunc = new Set(nomeFunc.split(' ').filter(Boolean));

    let score = 0;
    if (nomeFunc === nomeProgramacaoNorm) {
      score = 100;
    } else if (palavrasProg.length > 0 && palavrasProg.every(p => palavrasFunc.has(p))) {
      score = 80;
    } else if (palavrasProg.length > 0 && palavrasFunc.has(palavrasProg[0])) {
      score = 50;
    } else {
      busca: for (const pProg of palavrasProg) {
        if (pProg.length < 4) continue;
        for (const pFunc of palavrasFunc) {
          if (pFunc.length < 4) continue;
          if (sequenceMatcherRatio(pProg, pFunc) >= 0.82) {
            score = 35;
            break busca;
          }
        }
      }
    }

    if (score === 0) continue;

    if (origem === 'MECANICA') {
      if (areaFunc.includes('MECANICA')) score += 20;
      else if (areaFunc.includes('OPERACAO')) score += 10;
    } else if (origem === 'ELETRICA') {
      if (areaFunc.includes('ELETRICA')) score += 20;
      else if (areaFunc.includes('OPERACAO')) score += 10;
    }

    candidatos.push({ score, matricula });
  }

  if (candidatos.length === 0) return null;

  const melhorScore = Math.max(...candidatos.map(c => c.score));
  const melhores = candidatos.filter(c => c.score === melhorScore);

  return melhores.length === 1 ? melhores[0].matricula : null;
}
