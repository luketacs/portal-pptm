import { calcularProximaData, dataLimiteComTolerancia, periodicidadeEfetiva, periodicidadeEmDias, preventivaVencendo } from './manutencao-preventivas';

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
    expect(periodicidadeEfetiva(1, 'Semana(s)', false)).toEqual({ valor: 1, unidade: 'Semana(s)' });
    expect(periodicidadeEfetiva(6, 'Mes(es)', false)).toEqual({ valor: 6, unidade: 'Mes(es)' });
  });

  it('planta parada: ciclo curto (dias/semanas) vira mensal', () => {
    expect(periodicidadeEfetiva(2, 'Semana(s)', true)).toEqual({ valor: 1, unidade: 'Mes(es)' });
    expect(periodicidadeEfetiva(7, 'Dia(s)', true)).toEqual({ valor: 1, unidade: 'Mes(es)' });
  });

  it('planta parada: ciclo já mensal (ou mais longo) não muda', () => {
    expect(periodicidadeEfetiva(3, 'Mes(es)', true)).toEqual({ valor: 3, unidade: 'Mes(es)' });
    expect(periodicidadeEfetiva(12, 'Mes(es)', true)).toEqual({ valor: 12, unidade: 'Mes(es)' });
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
