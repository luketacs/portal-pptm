import {
  diasDaSemana, formatarDiaMes, formatarMesLabel, mesDaSemana, numeroSemanaISO,
  paraIso, segundaDaSemanaISO, segundaFeiraDe, semanasDoMes, somarContagem, statusMeta, cssPaginasImpressao,
} from './manutencao-indicadores-periodo';

describe('semanasDoMes', () => {
  it('mês com 4 segundas (fevereiro/2027, sem ano bissexto)', () => {
    // FEV/2027: segundas em 01, 08, 15, 22 — próxima segunda já é 01/03.
    expect(semanasDoMes('2027-02')).toEqual(['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']);
  });

  it('mês com 5 segundas (março/2027)', () => {
    expect(semanasDoMes('2027-03')).toEqual(['2027-03-01', '2027-03-08', '2027-03-15', '2027-03-22', '2027-03-29']);
  });

  it('não vaza a última semana do mês anterior (setembro/2026, 1a segunda não é dia 1)', () => {
    // 2026-09-01 é terça — a 1a segunda de setembro/2026 é 07/09, não deve incluir 31/08.
    const resultado = semanasDoMes('2026-09');
    expect(resultado[0]).toBe('2026-09-07');
    expect(resultado.every(s => s.startsWith('2026-09'))).toBe(true);
  });

  it('virada de ano (dezembro/2026 -> janeiro/2027) fica cada mês no seu próprio grupo', () => {
    const dezembro = semanasDoMes('2026-12');
    const janeiro = semanasDoMes('2027-01');
    expect(dezembro.every(s => s.startsWith('2026-12'))).toBe(true);
    expect(janeiro.every(s => s.startsWith('2027-01'))).toBe(true);
    expect(dezembro.some(s => janeiro.includes(s))).toBe(false);
  });
});

describe('mesDaSemana', () => {
  it('extrai o mês (YYYY-MM) a partir da segunda-feira da semana', () => {
    expect(mesDaSemana('2026-09-14')).toBe('2026-09');
  });
});

describe('formatarMesLabel', () => {
  it('formata "MÊS COMPLETO/ANO"', () => {
    expect(formatarMesLabel('2026-09')).toBe('Setembro/2026');
  });
});

describe('numeroSemanaISO / segundaDaSemanaISO', () => {
  it('são inversas uma da outra pra uma semana conhecida (S37/2026)', () => {
    const segunda = segundaDaSemanaISO(2026, 37);
    expect(numeroSemanaISO(paraIso(segunda))).toBe(37);
  });
});

describe('diasDaSemana', () => {
  it('gera os 7 dias a partir da segunda, com os labels certos', () => {
    const dias = diasDaSemana('2026-09-14');
    expect(dias.map(d => d.label)).toEqual(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']);
    expect(dias[0].data).toBe('2026-09-14');
    expect(dias[6].data).toBe('2026-09-20');
  });
});

describe('segundaFeiraDe / paraIso / formatarDiaMes', () => {
  it('encontra a segunda-feira da semana de uma data qualquer', () => {
    const segunda = segundaFeiraDe(new Date(2026, 8, 17)); // quinta, 17/09/2026
    expect(paraIso(segunda)).toBe('2026-09-14');
    expect(formatarDiaMes(segunda)).toBe('14/09');
  });

  it('domingo pertence à semana que já começou (segunda anterior, não a próxima)', () => {
    const segunda = segundaFeiraDe(new Date(2026, 8, 20)); // domingo, 20/09/2026
    expect(paraIso(segunda)).toBe('2026-09-14');
  });
});

describe('somarContagem', () => {
  it('soma as contagens brutas e deriva o % do total (não faz média de percentuais)', () => {
    const a = { programadas: 2, executadas: 2, naoExecutadas: 0, atendimento: 100 };
    const b = { programadas: 20, executadas: 0, naoExecutadas: 20, atendimento: 0 };
    expect(somarContagem(a, b)).toEqual({ programadas: 22, executadas: 2, naoExecutadas: 20, atendimento: 9.09 });
  });

  it('0 programadas no total não quebra e lê como 100% (nada previsto, nada faltando)', () => {
    const zero = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    expect(somarContagem(zero, zero)).toEqual({ programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 });
  });
});

describe('statusMeta', () => {
  it('maior é melhor: bate a meta = ok, até 5 pontos abaixo = atencao, pior = critico', () => {
    expect(statusMeta(95, 95)).toBe('ok');
    expect(statusMeta(100, 95)).toBe('ok');
    expect(statusMeta(92, 95)).toBe('atencao');
    expect(statusMeta(90, 95)).toBe('atencao');
    expect(statusMeta(89.9, 95)).toBe('critico');
  });

  it('menor é melhor (Dias/Navio): até a meta = ok, até 10% acima = atencao, pior = critico', () => {
    expect(statusMeta(4.5, 4.5, { menorMelhor: true })).toBe('ok');
    expect(statusMeta(4.9, 4.5, { menorMelhor: true })).toBe('atencao');
    expect(statusMeta(8.64, 4.5, { menorMelhor: true })).toBe('critico');
  });

  it('sem valor = sem status', () => {
    expect(statusMeta(null, 95)).toBeUndefined();
  });
});

describe('cssPaginasImpressao', () => {
  const css = cssPaginasImpressao({ titulo: 'Acompanhamento de Indicadores Semanais', periodo: 'SEMANA 39 · 21/09 a 27/09/2026', emitidoEm: new Date(2026, 9, 7, 14, 5) });

  it('rodapé com período, data de emissão e paginação', () => {
    expect(css).toContain('@bottom-left');
    expect(css).toContain('SEMANA 39 · 21/09 a 27/09/2026');
    expect(css).toContain('Emitido em 07/10/2026 14:05');
    expect(css).toContain('counter(page)');
    expect(css).toContain('counter(pages)');
  });

  it('cabeçalho fino some na 1a página (lá já tem o cabeçalho com logo)', () => {
    expect(css).toMatch(/@page\s*:first\s*\{[^}]*@top-left\s*\{\s*content:\s*none/);
  });

  it('escapa aspas e barra invertida do texto', () => {
    const c = cssPaginasImpressao({ titulo: 'a "b" \\ c', periodo: 'x', emitidoEm: new Date(2026, 0, 1) });
    expect(c).toContain('a \\"b\\" \\\\ c');
  });
});
