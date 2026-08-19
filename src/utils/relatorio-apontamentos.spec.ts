import { RegistroMatricula } from './relatorio-colaboradores';
import { HorasPontoPagina } from './relatorio-ponto';
import {
  ColaboradorHoras, calcularHorasEOrdensApontadas, colaboradoresOperacaoEmManutencao,
  mapearHorasDisponiveisPonto, mapearHorasProgramadasParaMatricula,
} from './relatorio-apontamentos';

// Cabeçalho no mesmo formato real da aba "Apontamentos" (Fechamento Semanal.2.xlsx) --
// inclui colunas que não usamos (ID, Área Manutenção etc.) pra provar que a busca é
// por rótulo, não por posição.
function header(): unknown[] {
  return [
    'ID', 'Data/Hora Registro', 'ID Sigma OS', 'Registrador', 'Executante', 'Solicitante',
    'Área Manutenção', 'Número PT', 'Status Operação', 'Data', 'Hora Inicial', 'Hora Final',
    'Intervalo Almoço', 'Feedback', 'Status Usuário', 'Equipe', 'Supervisor',
    'Operador Sala', 'Operador Campo', 'Empresa', 'OS Protheus', 'Coluna1',
  ];
}

// Monta uma linha no mesmo layout de header(), preenchendo só o que os testes usam.
function linha(opts: {
  executante: unknown; data: unknown; horaInicial: unknown; horaFinal: unknown;
  almoco?: unknown; osProtheus?: unknown; areaManutencao?: unknown;
}): unknown[] {
  const row = new Array(22).fill('');
  row[4] = opts.executante;
  row[6] = opts.areaManutencao ?? '';
  row[9] = opts.data;
  row[10] = opts.horaInicial;
  row[11] = opts.horaFinal;
  row[12] = opts.almoco ?? 0;
  row[20] = opts.osProtheus ?? '';
  return row;
}

// Serial Excel real (dias desde 1899-12-30) -- 45600 = 04/11/2024, verificado contra
// o range de datas real da planilha antes de escrever os testes.
const SERIAL_04_11 = 45600;
const SERIAL_05_11 = 45601;

const PERIODO_NOV_2024 = { dataInicio: new Date(Date.UTC(2024, 10, 1)), dataFim: new Date(Date.UTC(2024, 10, 30)) };

function matriculasFixture(): RegistroMatricula[] {
  return [
    { matricula: '708125', funcionario: 'Anderson Souza', area: 'Mecânica' },
    { matricula: '20006102', funcionario: 'Israel de Sousa', area: 'Mecânica' },
    { matricula: '20005301', funcionario: 'Francisco Eduardo', area: 'Operação' },
  ];
}

describe('calcularHorasEOrdensApontadas', () => {
  it('lança erro quando não acha as colunas essenciais', () => {
    expect(() => calcularHorasEOrdensApontadas([['Nome', 'Codigo']], {
      ...PERIODO_NOV_2024, matriculas: [], horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    })).toThrow(/Executante.*Data.*Hora Inicial.*Hora Final/);
  });

  it('calcula horas a partir de serial Excel (data) e fração de dia (horário), descontando almoço', () => {
    const rows = [header(), linha({
      executante: 708125, data: SERIAL_04_11, horaInicial: 8 / 24, horaFinal: 17 / 24, almoco: 1, osProtheus: 100,
    })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    // 08:00 as 17:00 = 9h - 1h almoco = 8h
    expect(r.horasGeral).toBeCloseTo(8, 2);
    expect(r.horasPorColaborador[0].funcionario).toBe('Anderson Souza');
  });

  it('aceita data em string dd/mm/aaaa e horário em string HH:MM', () => {
    const rows = [header(), linha({
      executante: 708125, data: '04/11/2024', horaInicial: '08:00', horaFinal: '12:00', almoco: 0,
    })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasGeral).toBeCloseTo(4, 2);
  });

  it('calcula virada de meia-noite (hora final menor que hora inicial)', () => {
    const rows = [header(), linha({
      executante: 708125, data: SERIAL_04_11, horaInicial: 22 / 24, horaFinal: 6 / 24, almoco: 0,
    })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    // 22:00 ate 06:00 do dia seguinte = 8h
    expect(r.horasGeral).toBeCloseTo(8, 2);
  });

  it('ignora apontamentos fora do período informado', () => {
    const rows = [header(), linha({
      executante: 708125, data: new Date(Date.UTC(2024, 11, 25)), horaInicial: 8 / 24, horaFinal: 12 / 24,
    })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasGeral).toBe(0);
    expect(r.totalApontamentos).toBe(0);
  });

  it('remove apontamentos duplicados (mesma matrícula, data e horário) e registra ocorrência', () => {
    const linhaBase = linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 8 / 24, horaFinal: 12 / 24 });
    const rows = [header(), linhaBase, [...linhaBase]];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.totalApontamentos).toBe(1);
    expect(r.ocorrenciasNaoContabilizadas).toHaveLength(1);
    expect(r.ocorrenciasNaoContabilizadas[0].tipo).toBe('Duplicado');
  });

  it('descarta apontamento individual com mais de 24h (valor impossível)', () => {
    const rows = [header(), linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 26 / 24 })];
    // horaFinal representa fração > 1 dia inteiro, forçando 26h de span (> 24h)
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasGeral).toBe(0);
    expect(r.ocorrenciasNaoContabilizadas.some(o => o.tipo === 'Valor impossível')).toBe(true);
  });

  it('escala proporcionalmente quando o total do dia de um colaborador excede 24h', () => {
    const rows = [
      header(),
      linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 12 / 24 }), // 12h
      linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 12 / 24, horaFinal: 12 / 24 + 18 / 24 }), // 18h -> total 30h no dia
    ];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    // 30h escalado pra 24h (fator 24/30 = 0.8): 12h->9.6h, 18h->14.4h
    expect(r.horasGeral).toBeCloseTo(24, 1);
    const ocorrenciasExcesso = r.ocorrenciasNaoContabilizadas.filter(o => o.tipo === 'Excesso diário');
    expect(ocorrenciasExcesso).toHaveLength(2);
  });

  it('conta ordens Protheus únicas por colaborador, ignorando valores inválidos', () => {
    const rows = [
      header(),
      linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24, osProtheus: 100 }),
      linha({ executante: 708125, data: SERIAL_05_11, horaInicial: 0, horaFinal: 4 / 24, osProtheus: 100 }), // mesma OS, dia diferente
      linha({ executante: 708125, data: SERIAL_05_11, horaInicial: 4 / 24, horaFinal: 8 / 24, osProtheus: 200 }),
      linha({ executante: 708125, data: SERIAL_05_11, horaInicial: 8 / 24, horaFinal: 12 / 24, osProtheus: 'N/A' }),
    ];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador[0].qtdOrdens).toBe(2);
    expect(r.horasPorColaborador[0].ordensLista).toEqual(['100', '200']);
    expect(r.ordensUnicasPeriodo).toBe(2);
    expect(r.colaboradoresComOrdens).toBe(1);
  });

  it('traduz as abreviacoes MEC/MECA e ELE/ELET pra Mecanica/Eletrica', () => {
    const rows = [
      header(),
      linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24, areaManutencao: 'MEC' }),
      linha({ executante: 708125, data: SERIAL_05_11, horaInicial: 0, horaFinal: 4 / 24, areaManutencao: 'ELET' }),
    ];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador[0].areasAtuacao).toEqual(['Elétrica', 'Mecânica']);
  });

  it('mantem abreviacoes desconhecidas como vieram, sem arriscar uma traducao errada', () => {
    const rows = [header(), linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24, areaManutencao: 'OFI' })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador[0].areasAtuacao).toEqual(['OFI']);
  });

  it('areasAtuacao fica vazia quando a coluna Área Manutenção não está preenchida', () => {
    const rows = [header(), linha({ executante: 708125, data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador[0].areasAtuacao).toEqual([]);
  });

  it('exclui matrícula da lista de exclusão do relatório (ex.: supervisor)', () => {
    const rows = [header(), linha({ executante: '20006139', data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024,
      matriculas: [...matriculasFixture(), { matricula: '20006139', funcionario: 'Marcio Gleyson', area: 'Elétrica' }],
      horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador).toHaveLength(0);
  });

  it('esconde colaboradores sem matrícula cadastrada (área cai em "OUTROS")', () => {
    const rows = [header(), linha({ executante: '999999', data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador).toHaveLength(0);
  });

  it('área Operação: horas disponíveis viram iguais às horas programadas', () => {
    const rows = [header(), linha({ executante: '20005301', data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(),
      horasProgramadasPorMatricula: { '20005301': 150 },
      horasDisponiveisPorMatricula: { '20005301': 120 }, // deveria ser ignorado por ser Operação
    });
    expect(r.horasPorColaborador[0].horasProgramadas).toBe(150);
    expect(r.horasPorColaborador[0].horasDisponiveis).toBe(150);
  });

  it('fora da área Operação, usa horas disponíveis do Ponto quando houver', () => {
    const rows = [header(), linha({ executante: '20006102', data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(),
      horasProgramadasPorMatricula: { '20006102': 150 },
      horasDisponiveisPorMatricula: { '20006102': 168 },
    });
    expect(r.horasPorColaborador[0].horasProgramadas).toBe(150);
    expect(r.horasPorColaborador[0].horasDisponiveis).toBe(168);
  });

  it('horas programadas/disponíveis ficam null quando não há dado de origem', () => {
    const rows = [header(), linha({ executante: '20006102', data: SERIAL_04_11, horaInicial: 0, horaFinal: 4 / 24 })];
    const r = calcularHorasEOrdensApontadas(rows, {
      ...PERIODO_NOV_2024, matriculas: matriculasFixture(), horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.horasPorColaborador[0].horasProgramadas).toBeNull();
    expect(r.horasPorColaborador[0].horasDisponiveis).toBeNull();
  });

  it('calcula dias do período (inclusive)', () => {
    const r = calcularHorasEOrdensApontadas([header()], {
      dataInicio: new Date(Date.UTC(2024, 10, 1)), dataFim: new Date(Date.UTC(2024, 10, 30)),
      matriculas: [], horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
    });
    expect(r.diasPeriodo).toBe(30);
  });
});

describe('colaboradoresOperacaoEmManutencao', () => {
  function colaborador(overrides: Partial<ColaboradorHoras>): ColaboradorHoras {
    return {
      matricula: '20005480', funcionario: 'Alexandre Gomes', area: 'Operação',
      horasApontadas: 50, horasProgramadas: null, horasDisponiveis: null,
      qtdOrdens: 3, ordensLista: [], areasAtuacao: [],
      ...overrides,
    };
  }

  function matriculasOperacao(): RegistroMatricula[] {
    return [
      { matricula: '20005480', funcionario: 'Alexandre Gomes', area: 'Operação' },
      { matricula: '20006309', funcionario: 'Mauro Teixeira', area: 'Operação' },
      { matricula: '20005985', funcionario: 'Joaquim Neto', area: 'Operação' },
      { matricula: '710624', funcionario: 'William', area: 'Operação' },
      { matricula: '20004578', funcionario: 'Antonio Narcelio', area: 'Operação' }, // Operação, mas NÃO está na manutenção
    ];
  }

  it('so traz quem esta na lista fixa de emprestados pra manutencao, mesmo sendo todos da Operacao', () => {
    const r = colaboradoresOperacaoEmManutencao([colaborador({})], matriculasOperacao());
    expect(r.map(c => c.matricula).sort()).toEqual(['20005480', '20005985', '20006309', '710624']);
  });

  it('usa os dados de horas/ordens de quem apontou algo no periodo', () => {
    const r = colaboradoresOperacaoEmManutencao(
      [colaborador({ matricula: '20005480', horasApontadas: 42, qtdOrdens: 5 })], matriculasOperacao(),
    );
    const alexandre = r.find(c => c.matricula === '20005480')!;
    expect(alexandre.horasApontadas).toBe(42);
    expect(alexandre.qtdOrdens).toBe(5);
  });

  it('zera quem esta na lista mas nao apontou nada no periodo (continua aparecendo)', () => {
    const r = colaboradoresOperacaoEmManutencao([], matriculasOperacao());
    expect(r).toHaveLength(4);
    const mauro = r.find(c => c.matricula === '20006309')!;
    expect(mauro.funcionario).toBe('Mauro Teixeira');
    expect(mauro.horasApontadas).toBe(0);
    expect(mauro.qtdOrdens).toBe(0);
  });
});

describe('mapearHorasProgramadasParaMatricula', () => {
  it('mapeia nomes curtos de cada origem pra matrícula e soma quando repete', () => {
    const matriculas = matriculasFixture();
    const r = mapearHorasProgramadasParaMatricula(
      [
        { origem: 'MECANICA', totais: { ANDERSON: 20 } },
        { origem: 'MECANICA', totais: { ANDERSON: 6 } },
      ],
      matriculas,
    );
    expect(r.horasPorMatricula['708125']).toBe(26);
    expect(r.naoMapeados).toHaveLength(0);
  });

  it('coleta nomes que não conseguiram ser mapeados', () => {
    const r = mapearHorasProgramadasParaMatricula(
      [{ origem: 'MECANICA', totais: { 'ZZZ NAO EXISTE': 10 } }],
      matriculasFixture(),
    );
    expect(r.naoMapeados).toEqual([{ origem: 'MECANICA', nomePrograma: 'ZZZ NAO EXISTE', horas: 10 }]);
  });
});

describe('mapearHorasDisponiveisPonto', () => {
  it('converte matrícula-sufixo(6) do Ponto pra matrícula completa', () => {
    const totaisPonto = new Map<string, HorasPontoPagina>([
      ['006102', { matricula6: '006102', turno: 'ADM_5X2', horas: 170 }],
    ]);
    const r = mapearHorasDisponiveisPonto(totaisPonto, matriculasFixture());
    expect(r['20006102']).toBe(170);
  });

  it('ignora sufixos que não batem com nenhuma matrícula cadastrada', () => {
    const totaisPonto = new Map<string, HorasPontoPagina>([
      ['999999', { matricula6: '999999', turno: 'OUTRO', horas: 50 }],
    ]);
    const r = mapearHorasDisponiveisPonto(totaisPonto, matriculasFixture());
    expect(Object.keys(r)).toHaveLength(0);
  });
});
