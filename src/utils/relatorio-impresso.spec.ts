import {
  ContagemImpressa, PontoTendencia, eixoMinimo, frase, geometriaLinhas, intervaloSemana, ledeResumo,
  ledeTendencia, montarDadosRelatorioImpresso, num, pct, tituloResumo, tituloTendencia,
} from './relatorio-impresso';
import { ContagemExecucao, IndicadoresSemana } from './manutencao-indicadores';

describe('montarDadosRelatorioImpresso', () => {
  const ind = (exe: number, prog: number): ContagemExecucao =>
    ({ programadas: prog, executadas: exe, naoExecutadas: prog - exe, atendimento: prog ? Math.round(exe / prog * 10000) / 100 : 100 });
  const semana: IndicadoresSemana = {
    geral: ind(106, 106), cumprimentoPlano: ind(80, 80), statusGeral: 'Dentro da Meta' as IndicadoresSemana['statusGeral'],
    porArea: [
      { categoria: 'ELETRICA', ...ind(36, 36), cumprimentoPlano: ind(24, 24) },
      { categoria: 'MECANICA', ...ind(60, 60), cumprimentoPlano: ind(46, 46) },
    ],
  };
  const fonte = {
    modo: 'semana' as const, periodoIso: '2026-09-28', semanasDoPeriodo: ['2026-09-28'], emitidoEm: new Date(2026, 9, 7),
    meta: 95, indicadores: semana,
    corretivas: { executadas: 25, programadas: 25, percentual: 100 }, preventivas: { executadas: 80, programadas: 80, percentual: 100 },
    hh: { disponivel: 559, indisponivel: 156 }, folgas: 7, exames: 0,
    ano: { ...semana, geral: ind(5024, 5216), cumprimentoPlano: ind(3893, 4039), porArea: [] },
    anoNumero: 2026, disponibilidade: 84.14, metaDisponibilidade: 81, diasNavio: 8.64, metaDiasNavio: 4.5,
    equipamentos: [{ equipamento: 'TC 05', horas: 100 }], atividades: [{ atividade: 'MANUTENÇÃO CHUTE EAC05', horas: 64.5 }],
    tecnicos: [{ area: 'Elétrica', itens: [] }],
    tendencia: Array.from({ length: 15 }, (_, i) => ({ chave: `2026-07-${String(i + 1).padStart(2, '0')}`, atendimento: 100, cumprimento: 100 })),
    tendenciaAreas: new Map(),
  };

  it('rótulo, intervalo, áreas na ordem fixa e janela de 13', () => {
    const d = montarDadosRelatorioImpresso(fonte);
    expect(d.rotulo).toBe('Semana 40');
    expect(d.intervalo).toBe('28 set a 4 out 2026');
    expect(d.areas.map(a => a.nome)).toEqual(['Mecânica', 'Elétrica']);
    expect(d.tendencia.length).toBe(13);
    expect(d.tendenciaAreas[0].pontos.every(v => v === 100)).toBe(true);
    expect(d.atividades[0].nome).toBe('Manutenção chute EAC05');
    expect(d.tecnicos).toEqual([]);
  });

  it('modo mês', () => {
    const d = montarDadosRelatorioImpresso({ ...fonte, modo: 'mes', periodoIso: '2026-09', semanasDoPeriodo: ['2026-09-07', '2026-09-28'] });
    expect(d.rotulo).toBe('Setembro de 2026');
    expect(d.intervalo).toBe('semanas 37 a 40');
    expect(d.unidadeTendencia).toBe('meses');
  });
});

const c = (executadas: number, programadas: number): ContagemImpressa =>
  ({ executadas, programadas, percentual: programadas > 0 ? Math.round(executadas / programadas * 10000) / 100 : 100 });

describe('formatação pt-BR', () => {
  it('percentual com vírgula e no máximo 1 casa', () => {
    expect(pct(96.32)).toBe('96,3%');
    expect(pct(100)).toBe('100%');
    expect(pct(15.12)).toBe('15,1%');
  });

  it('milhar com ponto', () => {
    expect(num(5216)).toBe('5.216');
    expect(num(32.5)).toBe('32,5');
  });

  it('intervalo da semana em texto corrido', () => {
    expect(intervaloSemana('2026-09-28')).toBe('28 set a 4 out 2026');
    expect(intervaloSemana('2026-10-05')).toBe('5 a 11 out 2026');
    expect(intervaloSemana('2026-12-28')).toBe('28 dez 2026 a 3 jan 2027');
  });

  it('frase: só a 1a letra maiúscula, preservando códigos com número', () => {
    expect(frase('MANUTENÇÃO CHUTE EAC05')).toBe('Manutenção chute EAC05');
    expect(frase('SUBSTITUIR TRAVA DISJ 90BLG SL46')).toBe('Substituir trava disj 90BLG SL46');
    expect(frase('"susbtituir atuadores da mesa')).toBe('Susbtituir atuadores da mesa');
  });
});

describe('tituloResumo', () => {
  const base = { rotulo: 'Semana 40', meta: 95 };

  it('100% nos dois = programação cumprida por completo', () => {
    expect(tituloResumo({ ...base, atendimento: c(106, 106), cumprimento: c(80, 80) }))
      .toBe('Semana 40 fechou com a programação cumprida por completo');
  });

  it('dentro da meta sem ser 100%', () => {
    expect(tituloResumo({ ...base, atendimento: c(97, 100), cumprimento: c(96, 100) }))
      .toBe('Semana 40 fechou dentro da meta, com 97% de atendimento à programação');
  });

  it('atendimento abaixo da meta', () => {
    expect(tituloResumo({ ...base, atendimento: c(20, 111), cumprimento: c(13, 86) }))
      .toBe('Semana 40 fechou com 18% de atendimento à programação, abaixo da meta de 95%');
  });

  it('só o plano abaixo da meta', () => {
    expect(tituloResumo({ ...base, atendimento: c(98, 100), cumprimento: c(91, 100) }))
      .toBe('Semana 40 cumpriu a programação, mas o plano de manutenção ficou em 91%');
  });
});

describe('ledeResumo', () => {
  const areas = [
    { nome: 'Mecânica', atendimento: c(60, 60), cumprimento: c(46, 46) },
    { nome: 'Elétrica', atendimento: c(36, 36), cumprimento: c(24, 24) },
  ];

  it('tudo executado', () => {
    expect(ledeResumo({ meta: 95, atendimento: c(96, 96), cumprimento: c(70, 70), areas, atendimentoAno: 96.32 }))
      .toBe('As 96 ordens programadas foram executadas, entre elas as 70 do plano de manutenção. '
        + 'Nenhuma das 2 áreas ficou abaixo da meta de 95%. No acumulado do ano, o atendimento à programação está em 96,3%.');
  });

  it('com áreas abaixo e a que concentra as não executadas', () => {
    const ruins = [
      { nome: 'Mecânica', atendimento: c(10, 65), cumprimento: c(5, 55) },
      { nome: 'Elétrica', atendimento: c(36, 37), cumprimento: c(20, 20) },
      { nome: 'SPCI', atendimento: c(0, 3), cumprimento: c(0, 3) },
    ];
    expect(ledeResumo({ meta: 95, atendimento: c(46, 105), cumprimento: c(25, 78), areas: ruins, atendimentoAno: 96.32 }))
      .toBe('Foram executadas 46 das 105 ordens programadas (43,8%) e 25 das 78 do plano de manutenção (32,1%). '
        + 'Mecânica e SPCI ficaram abaixo da meta de 95%; a mecânica concentra 55 das 59 ordens não executadas. '
        + 'No acumulado do ano, o atendimento à programação está em 96,3%.');
  });
});

describe('ledeResumo (casos de área)', () => {
  const area = (nome: string, e: number, pr: number) => ({ nome, atendimento: c(e, pr), cumprimento: c(e, pr) });

  it('uma área abaixo que também concentra as não executadas: sem repetir o nome', () => {
    const areas = [area('Mecânica', 172, 172), area('Limpeza Operacional', 17, 22), area('Refrigeração', 26, 27)];
    expect(ledeResumo({ meta: 95, atendimento: c(215, 221), cumprimento: c(215, 221), areas, atendimentoAno: 98 }))
      .toContain('Só a limpeza operacional ficou abaixo da meta, com 77,3%, e concentra 5 das 6 ordens não executadas.');
  });

  it('todas abaixo: conta em vez de listar', () => {
    const areas = [area('Mecânica', 1, 10), area('Elétrica', 1, 10), area('SPCI', 0, 3)];
    expect(ledeResumo({ meta: 95, atendimento: c(2, 23), cumprimento: c(2, 23), areas, atendimentoAno: 98 }))
      .toContain('Todas as 3 áreas ficaram abaixo da meta de 95%');
  });
});

describe('ledeTendencia', () => {
  const p = (rotulo: string, nomeFrase: string, atendimento: number, cumprimento: number): PontoTendencia =>
    ({ rotulo, nomeFrase, atendimento, cumprimento });

  it('tudo acima, exceto uma semana do plano, com a área que zerou', () => {
    const pontos = [p('S37', 'semana 37', 98.8, 100), p('S38', 'semana 38', 95.2, 91.2), p('S39', 'semana 39', 100, 100)];
    const areas = [
      { nome: 'Mecânica', pontos: [100, 100, 100] },
      { nome: 'Limpeza Operacional', pontos: [100, 0, 100] },
    ];
    expect(ledeTendencia({ meta: 95, pontos, areas, unidade: 'semanas' }))
      .toBe('O atendimento ficou acima da meta em todas as 3 semanas. No plano, a única abaixo da meta foi a semana 38 (91,2%), '
        + 'quando a limpeza operacional não executou nenhuma ordem.');
  });

  it('várias abaixo', () => {
    const pontos = [p('S39', 'semana 39', 90, 100), p('S40', 'semana 40', 100, 100), p('S41', 'semana 41', 18, 15.1)];
    expect(ledeTendencia({ meta: 95, pontos, areas: [], unidade: 'semanas' }))
      .toBe('O atendimento ficou acima da meta em 1 das 3 semanas; abaixo na semana 39 (90%) e na semana 41 (18%). '
        + 'No plano, a única abaixo da meta foi a semana 41 (15,1%).');
  });
});

describe('tituloTendencia', () => {
  it('concorda com a unidade', () => {
    expect(tituloTendencia(13, 'semanas')).toBe('Últimas 13 semanas');
    expect(tituloTendencia(10, 'meses')).toBe('Últimos 10 meses');
  });
});

describe('geometria dos gráficos', () => {
  it('piso do eixo em degraus redondos', () => {
    expect(eixoMinimo([91.2, 100])).toBe(80);
    expect(eixoMinimo([18, 100])).toBe(0);
    expect(eixoMinimo([66, 100])).toBe(60);
  });

  it('pontos nas pontas do eixo X e altura proporcional', () => {
    const g = geometriaLinhas({ series: [[80, 100]], largura: 100, altura: 60, margem: { esq: 10, dir: 10, topo: 10, base: 10 }, ymin: 80, meta: 90 });
    expect(g.series[0]).toEqual([{ x: 10, y: 50 }, { x: 90, y: 10 }]);
    expect(g.yMeta).toBe(30);
    expect(g.gradeY.map(t => t.valor)).toEqual([80, 85, 90, 95, 100]);
  });
});
