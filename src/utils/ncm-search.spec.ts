import { buscarNcm, formatarNcmExibicao, indexarNcm, normalizarTexto } from './ncm-search';

describe('normalizarTexto', () => {
  it('coloca em caixa alta', () => {
    expect(normalizarTexto('parafuso')).toBe('PARAFUSO');
  });

  it('remove acentos', () => {
    expect(normalizarTexto('Óleos lubrificantes — não contém água')).toBe('OLEOS LUBRIFICANTES — NAO CONTEM AGUA');
  });

  it('lida com valor vazio/undefined sem quebrar', () => {
    expect(normalizarTexto('')).toBe('');
    expect(normalizarTexto(undefined as unknown as string)).toBe('');
  });
});

describe('formatarNcmExibicao', () => {
  it('formata progressivamente enquanto os dígitos chegam', () => {
    expect(formatarNcmExibicao('7')).toBe('7');
    expect(formatarNcmExibicao('7318')).toBe('7318');
    expect(formatarNcmExibicao('73181')).toBe('7318.1');
    expect(formatarNcmExibicao('731812')).toBe('7318.12');
    expect(formatarNcmExibicao('7318120')).toBe('7318.12.0');
    expect(formatarNcmExibicao('73181200')).toBe('7318.12.00');
  });

  it('ignora caracteres não numéricos', () => {
    expect(formatarNcmExibicao('7318.12.00')).toBe('7318.12.00');
  });

  it('trunca em 8 dígitos', () => {
    expect(formatarNcmExibicao('731812001234')).toBe('7318.12.00');
  });
});

describe('buscarNcm', () => {
  // Réplica em miniatura do problema real encontrado na tabela oficial: o título do
  // capítulo cita várias famílias de produto numa frase só, o que gera falso positivo
  // se qualquer trecho da hierarquia contar como igualmente relevante.
  const base = [
    indexarNcm(
      '84821010',
      'Reatores nucleares, caldeiras, máquinas e instrumentos mecânicos. > Rolamentos de esferas, de roletes ou de agulhas. > Rolamentos de esferas > De carga radial',
    ),
    indexarNcm(
      '56050010',
      'Pastas, feltros e falsos tecidos; fios especiais; cordéis, cordas e cabos, do tipo utilizado para enrolamento de fios têxteis. > Revestidos por enrolamento',
    ),
    indexarNcm(
      '34011110',
      'Sabões, agentes orgânicos de superfície, preparações para lavagem, preparações lubrificantes, ceras artificiais. > Sabões de toucador > Sabões medicinais',
    ),
    indexarNcm(
      '27101931',
      'Combustíveis minerais, óleos minerais. > Óleos de petróleo. > Óleos de petróleo (exceto brutos). > Outros > Óleos lubrificantes > Sem aditivos',
    ),
    indexarNcm('73181200', 'Obras de ferro fundido, ferro ou aço. > Parafusos, pinos ou pernos, roscados. > Artigos roscados: > Outros parafusos para madeira'),
  ];

  it('não confunde "rolamento" com uma ocorrência no meio de "enrolamento"', () => {
    const resultado = buscarNcm(base, 'rolamento');
    const codigos = resultado.map(r => r.codigo);
    expect(codigos).toContain('84821010');
    expect(codigos).not.toContain('56050010');
  });

  it('prioriza o item cujo trecho mais específico bate com o termo', () => {
    const resultado = buscarNcm(base, 'parafuso');
    expect(resultado[0].codigo).toBe('73181200');
  });

  it('não deixa um item cujo termo só aparece no título genérico do capítulo empurrar pra frente um item realmente relevante', () => {
    const resultado = buscarNcm(base, 'lubrificante');
    const codigos = resultado.map(r => r.codigo);
    const posOleo = codigos.indexOf('27101931');   // óleo lubrificante de verdade
    const posSabao = codigos.indexOf('34011110');  // só cita "preparações lubrificantes" no título do capítulo
    expect(posOleo).toBeGreaterThanOrEqual(0);
    expect(posSabao === -1 || posOleo < posSabao).toBe(true);
  });

  it('só recorre a um item que bate apenas no título do capítulo quando não há opção melhor', () => {
    const somenteCapitulo = [
      indexarNcm('34011110', 'Sabões, preparações lubrificantes e ceras. > Sabões de toucador > Sabões medicinais'),
    ];
    const resultado = buscarNcm(somenteCapitulo, 'lubrificante');
    expect(resultado.map(r => r.codigo)).toEqual(['34011110']);
  });

  it('busca por prefixo de código quando o termo tem 4+ dígitos', () => {
    const resultado = buscarNcm(base, '8482');
    expect(resultado.map(r => r.codigo)).toEqual(['84821010']);
  });

  it('exige todas as palavras da busca, não só uma delas', () => {
    const resultado = buscarNcm(base, 'oleo aditivos');
    expect(resultado.map(r => r.codigo)).toEqual(['27101931']);
  });

  it('ignora acentuação e caixa na busca', () => {
    const resultado = buscarNcm(base, 'ROLAMÉNTO');
    expect(resultado.map(r => r.codigo)).toContain('84821010');
  });

  it('retorna lista vazia para termo vazio', () => {
    expect(buscarNcm(base, '')).toEqual([]);
    expect(buscarNcm(base, '   ')).toEqual([]);
  });

  it('retorna lista vazia quando nada bate', () => {
    expect(buscarNcm(base, 'xenônio criogênico inexistente')).toEqual([]);
  });

  it('respeita o limite de resultados', () => {
    const muitos = Array.from({ length: 10 }, (_, i) => indexarNcm(`0000000${i}`, `Capítulo. > Parafuso número ${i}`));
    expect(buscarNcm(muitos, 'parafuso', 3)).toHaveLength(3);
  });
});
