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

  // Indicadores de PCM costumam ficar sempre entre ~85-100% — numa escala fixa
  // 0-100%, toda a variação real fica espremida numa faixinha no topo do gráfico e
  // a linha vira um risco quase reto (ilegível). Em vez disso, "dá zoom": o piso do
  // eixo Y acompanha o menor valor da série (arredondado pra baixo, de 10 em 10,
  // com uma folga de 5 pontos), sempre com o teto fixo em 100%. Quando os valores
  // caem bem abaixo (ex: uma semana ruim), o piso volta pra 0% naturalmente.
  const valores = pontos.flatMap(p => [p.atendimento, p.cumprimento]);
  const menorValor = Math.min(100, ...valores);
  const eixoYMinimo = Math.max(0, Math.floor((menorValor - 5) / 10) * 10);
  const faixaY = 100 - eixoYMinimo;

  // 100% fica no topo do gráfico, eixoYMinimo embaixo.
  const escalaY = (valor: number): number => {
    const limitado = Math.max(eixoYMinimo, Math.min(100, valor));
    return margem.topo + (1 - (limitado - eixoYMinimo) / faixaY) * areaAltura;
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
  // Qualquer gap menor que um passo inteiro ainda fica visualmente colado (ex.: passo=2,
  // gap=1 — pontos adjacentes, ~17px de distância num gráfico de 38 semanas) — por isso
  // "< passo", não "< passo/2" (que deixava passar gap=1 quando passo=2, grudando os dois
  // últimos rótulos, ex. "S37S38").
  if (indices.length === 0 || n - 1 - indices[indices.length - 1] < passo) {
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
    eixoY: [0, 1, 2, 3, 4].map(i => {
      const valor = eixoYMinimo + (faixaY * i) / 4;
      return { posicao: escalaY(valor), label: `${Math.round(valor)}%` };
    }),
  };
}

// Mesmos pontos de calcularLinhaTempo, só como atributo "d" de <path> (segmento reto
// entre cada par, igual ao <polyline> original) em vez de "points" — usado pela tela
// de Indicadores Semanais, que precisa de <path> (não <polyline>) pro truque de
// animação de "desenhar a linha" via pathLength/stroke-dashoffset.
export function linhaRetaPath(pontos: CoordenadaSvg[]): string {
  if (pontos.length === 0) return '';
  return `M ${pontos[0].x},${pontos[0].y}` + pontos.slice(1).map(p => ` L ${p.x},${p.y}`).join('');
}

// Mesma linha reta acima, fechada descendo até `baseY` — pra preencher com gradiente
// por baixo da linha (visual de "area chart").
export function linhaRetaAreaPath(pontos: CoordenadaSvg[], baseY: number): string {
  if (pontos.length === 0) return '';
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  return `${linhaRetaPath(pontos)} L ${ultimo.x},${baseY} L ${primeiro.x},${baseY} Z`;
}
