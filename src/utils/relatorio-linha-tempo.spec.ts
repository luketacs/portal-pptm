import { calcularLinhaTempo, linhaRetaAreaPath, linhaRetaPath, posicionarRotulosFinais } from './relatorio-linha-tempo';

describe('calcularLinhaTempo', () => {
  it('retorna null quando nao ha pontos', () => {
    expect(calcularLinhaTempo([])).toBeNull();
  });

  it('centraliza o unico ponto horizontalmente quando so ha 1 periodo', () => {
    const geo = calcularLinhaTempo([{ label: 'S1', atendimento: 100, cumprimento: 100 }], { largura: 400 })!;
    const areaLargura = 400 - geo.margem.esquerda - geo.margem.direita;
    expect(geo.pontosAtendimento[0].x).toBeCloseTo(geo.margem.esquerda + areaLargura / 2);
  });

  it('posiciona o primeiro ponto na margem esquerda e o ultimo na borda direita da area util', () => {
    const geo = calcularLinhaTempo([
      { label: 'S1', atendimento: 50, cumprimento: 50 },
      { label: 'S2', atendimento: 60, cumprimento: 60 },
      { label: 'S3', atendimento: 70, cumprimento: 70 },
    ], { largura: 400 })!;
    expect(geo.pontosAtendimento[0].x).toBeCloseTo(geo.margem.esquerda);
    expect(geo.pontosAtendimento[2].x).toBeCloseTo(400 - geo.margem.direita);
  });

  it('100% fica no topo (y menor) e 0% embaixo (y maior)', () => {
    const geo = calcularLinhaTempo([
      { label: 'S1', atendimento: 100, cumprimento: 0 },
    ], { altura: 200 })!;
    expect(geo.pontosAtendimento[0].y).toBeCloseTo(geo.margem.topo);
    expect(geo.pontosCumprimento[0].y).toBeCloseTo(200 - geo.margem.baixo);
  });

  it('valores fora de 0-100 ficam limitados (clamp) na area do grafico', () => {
    const geo = calcularLinhaTempo([{ label: 'S1', atendimento: 150, cumprimento: -20 }], { altura: 200 })!;
    expect(geo.pontosAtendimento[0].y).toBeCloseTo(geo.margem.topo);
    expect(geo.pontosCumprimento[0].y).toBeCloseTo(200 - geo.margem.baixo);
  });

  it('monta o atributo "points" pronto pro polyline, na mesma ordem dos pontos', () => {
    const geo = calcularLinhaTempo([
      { label: 'S1', atendimento: 50, cumprimento: 50 },
      { label: 'S2', atendimento: 60, cumprimento: 60 },
    ])!;
    const partes = geo.linhaAtendimento.split(' ');
    expect(partes).toHaveLength(2);
    expect(partes[0]).toBe(`${geo.pontosAtendimento[0].x},${geo.pontosAtendimento[0].y}`);
  });

  it('gera 5 linhas guia no eixo Y, com piso ajustado ao menor valor da serie', () => {
    // menor valor 50 -> piso arredondado pra baixo de 10 em 10 com folga de 5 = 40
    const geo = calcularLinhaTempo([{ label: 'S1', atendimento: 50, cumprimento: 50 }])!;
    expect(geo.eixoY.map(g => g.label)).toEqual(['40%', '55%', '70%', '85%', '100%']);
  });

  it('da zoom no eixo Y quando os valores ficam sempre proximos de 100%, pra nao achatar a linha', () => {
    const geo = calcularLinhaTempo([
      { label: 'S1', atendimento: 92, cumprimento: 96 },
      { label: 'S2', atendimento: 100, cumprimento: 100 },
      { label: 'S3', atendimento: 88, cumprimento: 95 },
    ])!;
    expect(geo.eixoY[0].label).toBe('80%');
    expect(geo.eixoY[geo.eixoY.length - 1].label).toBe('100%');
  });

  it('mantem a escala cheia (piso 0%) quando algum valor cai bem abaixo', () => {
    const geo = calcularLinhaTempo([
      { label: 'S1', atendimento: 100, cumprimento: 100 },
      { label: 'S2', atendimento: 10, cumprimento: 90 },
    ])!;
    expect(geo.eixoY[0].label).toBe('0%');
  });

  it('mantem os rotulos do eixo X na mesma ordem e texto dos pontos de entrada', () => {
    const geo = calcularLinhaTempo([
      { label: 'JAN', atendimento: 90, cumprimento: 90 },
      { label: 'FEV', atendimento: 95, cumprimento: 95 },
    ])!;
    expect(geo.eixoX.map(e => e.label)).toEqual(['JAN', 'FEV']);
  });

  function pontosSemanas(qtd: number) {
    return Array.from({ length: qtd }, (_, i) => ({ label: `S${i + 1}`, atendimento: 90, cumprimento: 90 }));
  }

  it('nao afina o eixo X quando os pontos cabem dentro do maximo (comportamento igual a antes)', () => {
    const geo = calcularLinhaTempo(pontosSemanas(10))!;
    expect(geo.eixoX).toHaveLength(10);
  });

  it('afina o eixo X quando ha mais pontos que o maximo, mas mantem a linha inteira (todos os pontos do grafico)', () => {
    const geo = calcularLinhaTempo(pontosSemanas(33), { maxRotulosEixoX: 10 })!;
    expect(geo.eixoX.length).toBeLessThanOrEqual(10 + 1); // +1 porque sempre inclui o ultimo
    expect(geo.pontosAtendimento).toHaveLength(33); // a linha em si nao perde nenhum ponto
  });

  it('sempre mantem o rotulo do ultimo periodo, mesmo afinado', () => {
    const geo = calcularLinhaTempo(pontosSemanas(33), { maxRotulosEixoX: 10 })!;
    expect(geo.eixoX[geo.eixoX.length - 1].label).toBe('S33');
  });

  it('respeita um maxRotulosEixoX customizado (grafico menor precisa de menos rotulos)', () => {
    const geo = calcularLinhaTempo(pontosSemanas(20), { maxRotulosEixoX: 5 })!;
    expect(geo.eixoX.length).toBeLessThanOrEqual(6);
  });

  it('nunca deixa os dois ultimos rotulos em pontos adjacentes (ficariam colados, ex. "S37S38")', () => {
    // Regressão: com 38 pontos e maxRotulosEixoX padrão (20), passo=2 fazia o penúltimo
    // rótulo cair no índice 36 (S37) e o último no 37 (S38) — só 1 índice de distância,
    // ilegível lado a lado num gráfico estreito.
    const geo = calcularLinhaTempo(pontosSemanas(38))!;
    const penultimo = geo.eixoX[geo.eixoX.length - 2];
    const ultimo = geo.eixoX[geo.eixoX.length - 1];
    const indicePenultimo = Number(penultimo.label.replace('S', ''));
    const indiceUltimo = Number(ultimo.label.replace('S', ''));
    expect(indiceUltimo - indicePenultimo).toBeGreaterThanOrEqual(2);
  });
});

describe('linhaRetaPath', () => {
  it('retorna vazio sem pontos', () => {
    expect(linhaRetaPath([])).toBe('');
  });

  it('com 1 ponto, so move pra ele', () => {
    expect(linhaRetaPath([{ x: 5, y: 10 }])).toBe('M 5,10');
  });

  it('comeca com M no primeiro ponto e usa um segmento L reto por par de pontos', () => {
    const path = linhaRetaPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]);
    expect(path).toBe('M 0,0 L 10,5 L 20,0');
  });
});

describe('linhaRetaAreaPath', () => {
  it('retorna vazio sem pontos', () => {
    expect(linhaRetaAreaPath([], 100)).toBe('');
  });

  it('fecha o path descendo do ultimo ponto ate a base, voltando ao X do primeiro ponto, e fecha com Z', () => {
    const path = linhaRetaAreaPath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 100);
    expect(path).toContain('L 10,100'); // desce do ultimo ponto ate a base
    expect(path).toContain('L 0,100');  // volta pro X do primeiro ponto, na base
    expect(path.endsWith('Z')).toBe(true);
  });
});

describe('posicionarRotulosFinais', () => {
  const BOUNDS = { margemTopo: 16, alturaUtil: 192 }; // altura 220 - margem.baixo 28, mesmo padrão do relatório

  it('pontos bem separados: cada rótulo fica perto do próprio ponto (comportamento de sempre)', () => {
    const r = posicionarRotulosFinais({ yPontoAtendimento: 40, yPontoCumprimento: 140, ...BOUNDS });
    expect(r.yRotuloAtendimento).toBeCloseTo(30); // 40 - 10
    expect(r.yRotuloCumprimento).toBeCloseTo(157); // 140 + 17
  });

  it('valores próximos (pontos com Y quase igual): afasta os dois pra não colidir', () => {
    const r = posicionarRotulosFinais({ yPontoAtendimento: 100, yPontoCumprimento: 100, ...BOUNDS });
    expect(r.yRotuloCumprimento - r.yRotuloAtendimento).toBeGreaterThanOrEqual(18);
  });

  it('cumprimento fisicamente acima de atendimento (valores cruzados): ainda afasta o suficiente', () => {
    // Regressão do relatado: cumprimento com valor bem maior que atendimento faz o
    // ponto dele ficar bem mais alto (Y menor) — sem a separação mínima, o rótulo
    // "abaixo do ponto de cumprimento" colide com o "acima do ponto de atendimento".
    const r = posicionarRotulosFinais({ yPontoAtendimento: 100, yPontoCumprimento: 60, ...BOUNDS });
    expect(r.yRotuloCumprimento - r.yRotuloAtendimento).toBeGreaterThanOrEqual(18);
  });

  it('ponto no topo do gráfico (valor em 100%): rótulo de atendimento não vaza pra cima da margem', () => {
    const r = posicionarRotulosFinais({ yPontoAtendimento: 16, yPontoCumprimento: 16, ...BOUNDS });
    expect(r.yRotuloAtendimento).toBeGreaterThanOrEqual(BOUNDS.margemTopo);
  });

  it('ponto na base do gráfico: rótulo de cumprimento não vaza pra baixo da área útil', () => {
    const r = posicionarRotulosFinais({ yPontoAtendimento: 192, yPontoCumprimento: 192, ...BOUNDS });
    expect(r.yRotuloCumprimento).toBeLessThanOrEqual(BOUNDS.alturaUtil);
  });

  it('mesmo nos dois extremos ao mesmo tempo (topo/base apertados), mantém alguma separação', () => {
    const r = posicionarRotulosFinais({ yPontoAtendimento: 16, yPontoCumprimento: 16, margemTopo: 16, alturaUtil: 34 });
    expect(r.yRotuloCumprimento).toBeGreaterThan(r.yRotuloAtendimento);
  });
});
