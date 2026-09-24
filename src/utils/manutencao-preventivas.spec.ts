import {
  calcularProximaData, dataLimiteComTolerancia, periodicidadeEfetiva, periodicidadeEmDias,
  preventivaVencendo, proximaDataFixa,
} from './manutencao-preventivas';

describe('calcularProximaData', () => {
  it('soma dias quando a unidade é Dia(s)', () => {
    expect(calcularProximaData('2026-09-01', 7, 'Dia(s)')).toBe('2026-09-08');
  });

  it('soma semanas (x7 dias) quando a unidade é Semana(s)', () => {
    expect(calcularProximaData('2026-09-01', 2, 'Semana(s)')).toBe('2026-09-15');
  });

  it('soma meses quando a unidade é Mes(es)', () => {
    expect(calcularProximaData('2026-01-15', 3, 'Mes(es)')).toBe('2026-04-15');
  });

  it('vira o ano corretamente ao somar meses (dez + 2 = fevereiro do ano seguinte)', () => {
    expect(calcularProximaData('2025-12-10', 2, 'Mes(es)')).toBe('2026-02-10');
  });

  it('retorna null quando nunca foi executada (ultimaExecucao=null) — sempre vencido', () => {
    expect(calcularProximaData(null, 6, 'Mes(es)')).toBeNull();
  });

  it('reproduz o plano real AC90EAD01AH015 (ciclo de 1 mês)', () => {
    expect(calcularProximaData('2025-08-09', 1, 'Mes(es)')).toBe('2025-09-09');
  });
});

describe('proximaDataFixa', () => {
  it('âncora já no futuro: retorna a própria âncora, sem avançar', () => {
    expect(proximaDataFixa('2026-10-01', 1, 'Mes(es)', '2026-09-16')).toBe('2026-10-01');
  });

  it('âncora no passado: avança ciclo a ciclo até a primeira ocorrência >= referência', () => {
    expect(proximaDataFixa('2026-01-01', 1, 'Mes(es)', '2026-09-16')).toBe('2026-10-01');
  });

  it('não depende de execução real nenhuma — mesma âncora e referência sempre dão o mesmo resultado, ao contrário de calcularProximaData (completion-based)', () => {
    const a = proximaDataFixa('2026-01-15', 1, 'Mes(es)', '2026-09-16');
    const b = proximaDataFixa('2026-01-15', 1, 'Mes(es)', '2026-09-16');
    expect(a).toBe(b);
    expect(a).toBe('2026-10-15');
  });

  it('funciona com ciclo trimestral, mantendo o dia do mês da âncora', () => {
    expect(proximaDataFixa('2026-01-15', 3, 'Mes(es)', '2026-09-16')).toBe('2026-10-15');
  });

  it('referência exatamente igual à âncora: não avança (é a própria ocorrência)', () => {
    expect(proximaDataFixa('2026-09-16', 1, 'Mes(es)', '2026-09-16')).toBe('2026-09-16');
  });

  it('sem ultimoCicloIso (padrão), comportamento não muda — ocorrência atual repete até a referência passar dela', () => {
    expect(proximaDataFixa('2026-09-14', 1, 'Semana(s)', '2026-09-17')).toBe('2026-09-21');
  });

  it('ocorrência atual já tem ciclo registrado: pula pra próxima, mesmo com a referência ainda dentro dela', () => {
    expect(proximaDataFixa('2026-09-14', 1, 'Semana(s)', '2026-09-17', '2026-09-21')).toBe('2026-09-28');
  });

  it('ciclo registrado é ANTERIOR à ocorrência atual: não pula (ocorrência ainda não foi coberta)', () => {
    expect(proximaDataFixa('2026-09-14', 1, 'Semana(s)', '2026-09-17', '2026-09-14')).toBe('2026-09-21');
  });

  it('ciclo registrado cobre mais de uma ocorrência de uma vez (ex.: técnico adiantou serviço)', () => {
    expect(proximaDataFixa('2026-09-01', 1, 'Semana(s)', '2026-09-02', '2026-09-22')).toBe('2026-09-29');
  });

  it('ultimoCicloIso null (nunca programado) equivale a não passar o argumento', () => {
    expect(proximaDataFixa('2026-09-14', 1, 'Semana(s)', '2026-09-17', null)).toBe('2026-09-21');
  });

  // Reportado: P-R-6M do Prédio 25 antecipado pelo alinhamento (ciclo gravado 21/09,
  // ocorrência real 05/10) voltava a aparecer sozinho na semana de 05/10.
  it('ciclo antecipado pelo alinhamento (até 21 dias antes) cobre a ocorrência', () => {
    expect(proximaDataFixa('2026-10-05', 6, 'Mes(es)', '2026-09-21', '2026-09-21')).toBe('2027-04-05');
  });

  it('ciclo mais de 21 dias antes da ocorrência não cobre ela', () => {
    expect(proximaDataFixa('2026-10-05', 6, 'Mes(es)', '2026-09-07', '2026-09-07')).toBe('2026-10-05');
  });

  it('agenda rígida não tem folga: ciclo de 21/09 não cobre a ocorrência de 06/10', () => {
    expect(proximaDataFixa('2026-10-06', 1, 'Mes(es)', '2026-09-21', '2026-09-21', true)).toBe('2026-10-06');
  });

  it('folga nunca engole a ocorrência seguinte de um plano mensal', () => {
    expect(proximaDataFixa('2026-09-21', 1, 'Mes(es)', '2026-09-21', '2026-09-21')).toBe('2026-10-21');
  });
});

describe('preventivaVencendo', () => {
  it('considera vencendo quando a próxima data cai dentro da semana em exibição', () => {
    expect(preventivaVencendo('2026-09-09', '2026-09-07', '2026-09-11')).toBe(true);
  });

  it('não considera vencendo quando a próxima data é de antes do início da semana (pertence à semana em que foi programada, não a todas as seguintes)', () => {
    expect(preventivaVencendo('2026-08-01', '2026-09-07', '2026-09-11')).toBe(false);
  });

  it('não considera vencendo quando a próxima data é depois do fim da semana', () => {
    expect(preventivaVencendo('2026-09-20', '2026-09-07', '2026-09-11')).toBe(false);
  });

  it('nunca executada (proximaData=null) sempre conta como vencendo, em qualquer semana', () => {
    expect(preventivaVencendo(null, '2026-09-07', '2026-09-11')).toBe(true);
  });
});

describe('periodicidadeEfetiva', () => {
  it('planta operando normalmente: mantém a periodicidade original', () => {
    expect(periodicidadeEfetiva(1, 'Semana(s)', false, 'MECANICA')).toEqual({ valor: 1, unidade: 'Semana(s)' });
    expect(periodicidadeEfetiva(6, 'Mes(es)', false, 'ELETRICA')).toEqual({ valor: 6, unidade: 'Mes(es)' });
  });

  it('planta parada: ciclo curto (dias/semanas) de Elétrica/Mecânica vira mensal', () => {
    expect(periodicidadeEfetiva(2, 'Semana(s)', true, 'MECANICA')).toEqual({ valor: 1, unidade: 'Mes(es)' });
    expect(periodicidadeEfetiva(1, 'Semana(s)', true, 'ELETRICA')).toEqual({ valor: 1, unidade: 'Mes(es)' });
    expect(periodicidadeEfetiva(7, 'Dia(s)', true, 'MECANICA')).toEqual({ valor: 1, unidade: 'Mes(es)' });
  });

  it('planta parada: Apoio não é afetado — semanal continua semanal', () => {
    expect(periodicidadeEfetiva(1, 'Semana(s)', true, 'APOIO')).toEqual({ valor: 1, unidade: 'Semana(s)' });
    expect(periodicidadeEfetiva(7, 'Dia(s)', true, 'APOIO')).toEqual({ valor: 7, unidade: 'Dia(s)' });
  });

  it('planta parada: ciclo longo cadastrado em dias (90/180/365) não vira mensal', () => {
    expect(periodicidadeEfetiva(180, 'Dia(s)', true, 'ELETRICA')).toEqual({ valor: 180, unidade: 'Dia(s)' });
    expect(periodicidadeEfetiva(30, 'Dia(s)', true, 'MECANICA')).toEqual({ valor: 30, unidade: 'Dia(s)' });
    expect(periodicidadeEfetiva(20, 'Dia(s)', true, 'MECANICA')).toEqual({ valor: 1, unidade: 'Mes(es)' });
  });

  it('planta parada: ciclo já mensal (ou mais longo) não muda', () => {
    expect(periodicidadeEfetiva(3, 'Mes(es)', true, 'ELETRICA')).toEqual({ valor: 3, unidade: 'Mes(es)' });
    expect(periodicidadeEfetiva(12, 'Mes(es)', true, 'MECANICA')).toEqual({ valor: 12, unidade: 'Mes(es)' });
  });
});

describe('periodicidadeEmDias', () => {
  it('Dia(s): retorna o próprio valor', () => {
    expect(periodicidadeEmDias(1, 'Dia(s)')).toBe(1);
    expect(periodicidadeEmDias(45, 'Dia(s)')).toBe(45);
  });

  it('Semana(s): multiplica por 7', () => {
    expect(periodicidadeEmDias(2, 'Semana(s)')).toBe(14);
  });

  it('Mes(es): multiplica por 30 (aproximação usada em todo o app)', () => {
    expect(periodicidadeEmDias(1, 'Mes(es)')).toBe(30);
    expect(periodicidadeEmDias(6, 'Mes(es)')).toBe(180);
    expect(periodicidadeEmDias(12, 'Mes(es)')).toBe(360);
  });
});

describe('dataLimiteComTolerancia', () => {
  it('proximaData=null (nunca executada) não tem prazo de tolerância — retorna null', () => {
    expect(dataLimiteComTolerancia(null, 1, 'Mes(es)')).toBeNull();
  });

  it('plano mensal: tolerância de 1/3 de 30 dias = 10 dias após o vencimento', () => {
    expect(dataLimiteComTolerancia('2026-09-16', 1, 'Mes(es)')).toBe('2026-09-26');
  });

  it('plano de 45 dias: tolerância de 1/3 = 15 dias após o vencimento', () => {
    expect(dataLimiteComTolerancia('2026-09-17', 45, 'Dia(s)')).toBe('2026-10-02');
  });

  it('plano semanal: tolerância arredonda pro dia mais próximo (7/3 = 2,33 → 2 dias)', () => {
    expect(dataLimiteComTolerancia('2026-09-01', 1, 'Semana(s)')).toBe('2026-09-03');
  });

  it('atravessa virada de mês corretamente (setembro tem 30 dias)', () => {
    expect(dataLimiteComTolerancia('2026-09-25', 1, 'Mes(es)')).toBe('2026-10-05');
  });

  it('plano diário (1 dia): tolerância arredonda pra 0 — prazo é o próprio dia do vencimento', () => {
    expect(dataLimiteComTolerancia('2026-09-16', 1, 'Dia(s)')).toBe('2026-09-16');
  });
});
