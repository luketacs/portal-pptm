export interface NcmEntry {
  codigo: string;      // 8 dígitos, sem pontuação
  descricao: string;   // hierarquia completa (capítulo > posição > ... > item)
}

export interface NcmEntryIndexado extends NcmEntry {
  descricaoNorm: string;
  folhaNorm: string;  // só o último trecho da hierarquia (o mais específico)
  restoNorm: string;  // tudo, exceto o 1º trecho (o capítulo)
}

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

export function normalizarTexto(str: string): string {
  return String(str ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(DIACRITICOS, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Prepara um item cru (código + descrição completa) pra busca: normaliza e separa
// a "folha" (trecho mais específico) do "resto" (tudo, menos o capítulo — que
// costuma listar várias famílias de produto bem diferentes numa frase só).
export function indexarNcm(codigo: string, descricao: string): NcmEntryIndexado {
  const descricaoNorm = normalizarTexto(descricao);
  const segmentos = descricaoNorm.split(' > ');
  return {
    codigo,
    descricao,
    descricaoNorm,
    folhaNorm: segmentos[segmentos.length - 1],
    restoNorm: segmentos.length > 1 ? segmentos.slice(1).join(' > ') : descricaoNorm,
  };
}

// Busca por palavra-chave (com ranking por especificidade) ou por prefixo de código.
export function buscarNcm(codigos: NcmEntryIndexado[], termo: string, limite = 40): NcmEntry[] {
  const alvo = termo.trim();
  if (!alvo) return [];

  const apenasDigitos = alvo.replace(/\D/g, '');
  if (apenasDigitos.length >= 4) {
    const porCodigo = codigos.filter(e => e.codigo.startsWith(apenasDigitos));
    if (porCodigo.length > 0) return porCodigo.slice(0, limite).map(({ codigo, descricao }) => ({ codigo, descricao }));
  }

  const palavras = normalizarTexto(alvo).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];

  // Início de palavra (\b), não qualquer trecho — senão "rolamento" bate dentro de
  // "enrolamento", "parafuso" dentro de "aparafusado", etc.
  const regexes = palavras.map(p => new RegExp(`\\b${escapeRegex(p)}`));

  // Relevância: 2 = bate no trecho mais específico (a "folha"); 1 = bate em algum
  // trecho intermediário; 0 = só bate no título do capítulo (1º trecho), que costuma
  // listar várias famílias de produto bem diferentes numa frase só — nesse caso o termo
  // buscado geralmente não tem nada a ver com o item em si, é só menção de passagem.
  const bons: { item: NcmEntryIndexado; relevancia: number }[] = [];
  const somenteCapitulo: NcmEntryIndexado[] = [];
  for (const item of codigos) {
    if (!regexes.every(r => r.test(item.descricaoNorm))) continue;
    if (regexes.every(r => r.test(item.folhaNorm))) {
      bons.push({ item, relevancia: 2 });
    } else if (regexes.every(r => r.test(item.restoNorm))) {
      bons.push({ item, relevancia: 1 });
    } else {
      somenteCapitulo.push(item);
    }
  }

  bons.sort((a, b) => b.relevancia - a.relevancia);
  // Só cai pros resultados "só bate no capítulo" se não achou nada melhor — mais vale
  // isso do que dizer que não encontrou nada.
  const fonte = bons.length > 0 ? bons.map(b => b.item) : somenteCapitulo;
  return fonte.slice(0, limite).map(item => ({ codigo: item.codigo, descricao: item.descricao }));
}

// Formata visualmente como "0000.00.00" enquanto digita — o valor guardado no
// formulário continua só com os 8 dígitos (é o que o banco espera).
export function formatarNcmExibicao(digits: string): string {
  const limpo = (digits ?? '').replace(/\D/g, '').slice(0, 8);
  let out = limpo.slice(0, 4);
  if (limpo.length > 4) out += '.' + limpo.slice(4, 6);
  if (limpo.length > 6) out += '.' + limpo.slice(6, 8);
  return out;
}
