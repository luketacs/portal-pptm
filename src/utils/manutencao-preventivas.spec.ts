import { calcularProximaData, preventivaVencendo } from './manutencao-preventivas';

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
  it('considera vencendo quando a próxima data já passou (antes do fim da semana)', () => {
    expect(preventivaVencendo('2026-08-01', '2026-09-11')).toBe(true);
  });

  it('considera vencendo quando a próxima data cai dentro da semana em exibição', () => {
    expect(preventivaVencendo('2026-09-10', '2026-09-11')).toBe(true);
  });

  it('não considera vencendo quando a próxima data é depois do fim da semana', () => {
    expect(preventivaVencendo('2026-09-20', '2026-09-11')).toBe(false);
  });

  it('nunca executada (proximaData=null) sempre conta como vencendo', () => {
    expect(preventivaVencendo(null, '2026-09-11')).toBe(true);
  });
});
