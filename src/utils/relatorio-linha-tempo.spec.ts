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

  it('gera 5 linhas guia no eixo Y (0/25/50/75/100%)', () => {
    const geo = calcularLinhaTempo([{ label: 'S1', atendimento: 50, cumprimento: 50 }])!;
    expect(geo.eixoY.map(g => g.label)).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('mantem os rotulos do eixo X na mesma ordem e texto dos pontos de entrada', () => {
    const geo = calcularLinhaTempo([
      { label: 'JAN', atendimento: 90, cumprimento: 90 },
      { label: 'FEV', atendimento: 95, cumprimento: 95 },
    ])!;
    expect(geo.eixoX.map(e => e.label)).toEqual(['JAN', 'FEV']);
  });
});
