// Calcula a geometria (coordenadas SVG) da linha do tempo do acumulado, usada pelos
// relatórios Semanal e Mensal PCM. Fica em pure function pra ser testável — o
// componente só liga os pontos calculados aqui num <polyline>/<circle> declarativo.

export interface PontoLinhaTempo {
  label: string;       // ex: "S1", "S2"... (semanal) ou "JAN", "FEV"... (mensal)
  atendimento: number; // 0-100
  cumprimento: number; // 0-100
}

export interface CoordenadaSvg {
  x: number;
  y: number;
}

export interface RotuloEixo {
  posicao: number;
  label: string;
}

export interface LinhaTempoGeometria {
  largura: number;
  altura: number;
  margem: { topo: number; direita: number; baixo: number; esquerda: number };
  pontosAtendimento: CoordenadaSvg[];
  pontosCumprimento: CoordenadaSvg[];
  linhaAtendimento: string; // atributo "points" pronto pro <polyline>
  linhaCumprimento: string;
  eixoX: RotuloEixo[];
  eixoY: RotuloEixo[];
}

const LARGURA_PADRAO = 720;
const ALTURA_PADRAO = 220;
const MARGEM_PADRAO = { topo: 16, direita: 16, baixo: 28, esquerda: 36 };

const MAX_ROTULOS_EIXO_X_PADRAO = 20;

export function calcularLinhaTempo(
  pontos: PontoLinhaTempo[], opts: { largura?: number; altura?: number; maxRotulosEixoX?: number } = {},
): LinhaTempoGeometria | null {
  if (pontos.length === 0) return null;

  const largura = opts.largura ?? LARGURA_PADRAO;
  const altura = opts.altura ?? ALTURA_PADRAO;
  const maxRotulos = opts.maxRotulosEixoX ?? MAX_ROTULOS_EIXO_X_PADRAO;
  const margem = MARGEM_PADRAO;
  const areaLargura = largura - margem.esquerda - margem.direita;
  const areaAltura = altura - margem.topo - margem.baixo;
  const n = pontos.length;

  const escalaX = (i: number): number =>
    n <= 1 ? margem.esquerda + areaLargura / 2 : margem.esquerda + (i / (n - 1)) * areaLargura;

  // 100% fica no topo do gráfico, 0% embaixo.
  const escalaY = (valor: number): number => {
    const limitado = Math.max(0, Math.min(100, valor));
    return margem.topo + (1 - limitado / 100) * areaAltura;
  };

  const pontosAtendimento = pontos.map((p, i) => ({ x: escalaX(i), y: escalaY(p.atendimento) }));
  const pontosCumprimento = pontos.map((p, i) => ({ x: escalaX(i), y: escalaY(p.cumprimento) }));
  const paraAtributoPoints = (pts: CoordenadaSvg[]): string => pts.map(p => `${p.x},${p.y}`).join(' ');

  // Com muitos pontos, mostrar o rótulo de todos deixa o eixo X ilegível (rótulos
  // colados uns nos outros) — afina pra no máximo maxRotulos, sempre mantendo o
  // primeiro e o último período (mais relevante pra leitura da tendência). Se o
  // último ponto cair muito perto do penúltimo rótulo já escolhido (quando n não é
  // múltiplo exato do passo), troca o penúltimo pelo último em vez de mostrar os
  // dois quase colados.
  const passo = Math.max(1, Math.ceil(n / maxRotulos));
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i += passo) indices.push(i);
  if (indices.length === 0 || n - 1 - indices[indices.length - 1] < passo / 2) {
    if (indices.length > 0) indices.pop();
  }
  indices.push(n - 1);
  const eixoX = indices.map(i => ({ posicao: escalaX(i), label: pontos[i].label }));

  return {
    largura, altura, margem,
    pontosAtendimento, pontosCumprimento,
    linhaAtendimento: paraAtributoPoints(pontosAtendimento),
    linhaCumprimento: paraAtributoPoints(pontosCumprimento),
    eixoX,
    eixoY: [0, 25, 50, 75, 100].map(v => ({ posicao: escalaY(v), label: `${v}%` })),
  };
}
