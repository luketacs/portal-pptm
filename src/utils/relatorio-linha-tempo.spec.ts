import { calcularLinhaTempo } from './relatorio-linha-tempo';

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
});
