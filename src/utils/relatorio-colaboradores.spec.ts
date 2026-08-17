import {
  RegistroMatricula, mapearNomeProgramacaoParaMatricula, matriculaSuffix6,
  normalizarNomeColaborador, parseMatriculas, sequenceMatcherRatio,
} from './relatorio-colaboradores';

describe('matriculaSuffix6', () => {
  it('pega os ultimos 6 digitos, ignorando prefixos', () => {
    expect(matriculaSuffix6('20006162')).toBe('006162');
    expect(matriculaSuffix6('01 - 006162')).toBe('006162');
  });

  it('mantem o numero como esta quando ja tem 6 digitos', () => {
    expect(matriculaSuffix6(707765)).toBe('707765');
  });

  it('completa com zeros a esquerda quando tem menos de 6 digitos', () => {
    expect(matriculaSuffix6('123')).toBe('000123');
  });

  it('retorna vazio quando nao ha nenhum digito', () => {
    expect(matriculaSuffix6('abc')).toBe('');
  });
});

describe('sequenceMatcherRatio', () => {
  // Valores conferidos direto contra o difflib.SequenceMatcher do Python antes de
  // portar (mesmo algoritmo Ratcliff/Obershelp) -- ver notas da sessao.
  it.each([
    ['ALVIMAR', 'ALVEMAR', 0.8571428571428571],
    ['CLAUDINEI', 'CLAUDINEY', 0.8888888888888888],
    ['MICAEL', 'MICAEL', 1],
    ['DANIEL', 'DANIELA', 0.9230769230769231],
    ['JOSE', 'JOSUE', 0.8888888888888888],
  ])('%s vs %s => %f (igual ao difflib real)', (a, b, esperado) => {
    expect(sequenceMatcherRatio(a, b)).toBeCloseTo(esperado, 10);
  });

  it('e simetrica (a,b) === (b,a)', () => {
    expect(sequenceMatcherRatio('ALVIMAR', 'ALVEMAR')).toBeCloseTo(sequenceMatcherRatio('ALVEMAR', 'ALVIMAR'), 10);
  });

  it('retorna 1 quando as duas strings estao vazias', () => {
    expect(sequenceMatcherRatio('', '')).toBe(1);
  });
});

describe('normalizarNomeColaborador', () => {
  it('remove acentos, coloca em caixa alta e colapsa espacos duplicados', () => {
    expect(normalizarNomeColaborador('  Antônio   José  ')).toBe('ANTONIO JOSE');
  });
});

function planilhaMatriculas(): unknown[][] {
  return [
    ['Funcionario', 'Matricula', 'Área ', 'e-mail', 'Telefone'],
    ['Daniel Moura', '20000384', 'Mecânica', 'daniel@x.com', '85 1111'],
    ['Claudiney Jules', '20006221', 'Mecânica', 'claudiney@x.com', ''],
    ['Antonio Jose', '20006162', 'Mecânica', '', ''],
    ['Micael Smicht', 703016, 'Mecânica', '', ''],
    ['Xavier Bruno', 707860, 'Elétrica', '', ''],
    ['Anderson Souza', 708125, 'Mecânica', '', ''],
    ['Anderson Costa', 708200, 'Elétrica', '', ''], // homonimo de primeiro nome, area diferente
  ];
}

describe('parseMatriculas', () => {
  it('acha as colunas pelo rotulo, mesmo com espaco sobrando ("Área ")', () => {
    const registros = parseMatriculas(planilhaMatriculas());
    expect(registros).toHaveLength(7);
    expect(registros[0]).toEqual({
      funcionario: 'Daniel Moura', matricula: '20000384', area: 'Mecânica',
      email: 'daniel@x.com', telefone: '85 1111',
    });
  });

  it('trata matricula numerica (sem prefixo) igual a matricula em texto', () => {
    const registros = parseMatriculas(planilhaMatriculas());
    const micael = registros.find(r => r.funcionario === 'Micael Smicht');
    expect(micael?.matricula).toBe('703016');
  });

  it('lanca erro quando nao acha as colunas essenciais', () => {
    expect(() => parseMatriculas([['Nome', 'Codigo']])).toThrow(/Funcionário.*Matrícula/);
  });
});

describe('mapearNomeProgramacaoParaMatricula', () => {
  const matriculas = parseMatriculas(planilhaMatriculas());

  it('acha por nome exato (so o primeiro nome ja bate 100% com o unico candidato daquele nome)', () => {
    const r = mapearNomeProgramacaoParaMatricula('DANIEL', 'MECANICA', matriculas);
    expect(r).toBe('20000384');
  });

  it('acha por similaridade fuzzy quando ha erro de grafia (ALVIMAR/ALVEMAR)', () => {
    const comErro = parseMatriculas([
      ['Funcionario', 'Matricula', 'Área '],
      ['Alvemar Silva', '20009999', 'Mecânica'],
    ]);
    const r = mapearNomeProgramacaoParaMatricula('ALVIMAR', 'MECANICA', comErro);
    expect(r).toBe('20009999');
  });

  it('usa o alias manual quando existe, sem nem tentar o casamento automatico', () => {
    const r = mapearNomeProgramacaoParaMatricula('VLAD', 'ELETRICA', []);
    expect(r).toBe('20006009');
  });

  it('desempata usando a area de origem (bonus de pontuacao)', () => {
    // "ANDERSON" bate com dois candidatos por primeiro nome (score 50 cada) --
    // o bonus de area (+20 mecanica) deve desempatar pro da area certa.
    const r = mapearNomeProgramacaoParaMatricula('ANDERSON', 'MECANICA', matriculas);
    expect(r).toBe('708125'); // Anderson Souza, Mecânica
  });

  it('retorna null quando dois candidatos empatam mesmo depois do bonus de area', () => {
    const empatados = parseMatriculas([
      ['Funcionario', 'Matricula', 'Área '],
      ['Anderson Souza', '1', 'Elétrica'],
      ['Anderson Costa', '2', 'Elétrica'],
    ]);
    const r = mapearNomeProgramacaoParaMatricula('ANDERSON', 'ELETRICA', empatados);
    expect(r).toBeNull();
  });

  it('retorna null quando nao acha nenhum candidato plausivel', () => {
    const r = mapearNomeProgramacaoParaMatricula('ZZZXXXYYY', 'MECANICA', matriculas);
    expect(r).toBeNull();
  });

  it('retorna null pra nome vazio', () => {
    expect(mapearNomeProgramacaoParaMatricula('', 'MECANICA', matriculas)).toBeNull();
  });

  it('usa o alias manual pra resolver "ANT. JOSE" -> Antonio Jose (empataria com José Neri sem o alias, ja que so a palavra JOSE bate no fuzzy)', () => {
    const r = mapearNomeProgramacaoParaMatricula('ANT. JOSE', 'MECANICA', matriculas);
    expect(r).toBe('20006162');
  });
});
