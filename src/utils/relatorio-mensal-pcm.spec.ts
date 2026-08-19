import {
  AREAS_PCM_MENSAL, AreaMensal, DadosAcumulado, DadosMensal, analisarPontosAtencaoEAcoesMensal,
  areasComMovimento, extrairHistoricoMeses, gerarDestaquesMensal, localizarCabecalhoMeses, localizarLinhaRotulo, parseIndicadoresMensais,
} from './relatorio-mensal-pcm';

// Monta uma planilha sintetica no mesmo layout REAL validado contra o arquivo de
// verdade (nao o layout que o codigo Python original tinha hardcoded, que estava
// desatualizado — ver comentario no topo de relatorio-mensal-pcm.ts).
function montarPlanilha(): unknown[][] {
  const rows: unknown[][] = [];
  const linhaCabecalho: unknown[] = [];
  linhaCabecalho[6] = 'JAN'; linhaCabecalho[7] = 'FEV'; linhaCabecalho[8] = 'MAR';
  linhaCabecalho[17] = 'DEZ'; linhaCabecalho[18] = 2026;
  linhaCabecalho[26] = 'JAN'; linhaCabecalho[27] = 'FEV'; linhaCabecalho[28] = 'MAR';
  linhaCabecalho[37] = 'DEZ'; linhaCabecalho[38] = 2026;
  rows[4] = linhaCabecalho;

  // Bloco de área: [programadas, executadas, nao_executadas, indice_cumprimento]
  function preencherBloco(linhaBase: number, rotulo: string, valoresPorColuna: Record<number, number[]>) {
    rows[linhaBase] = rows[linhaBase] ?? [];
    rows[linhaBase][0] = rotulo;
    for (const [colStr, vals] of Object.entries(valoresPorColuna)) {
      const col = Number(colStr);
      for (let i = 0; i < vals.length; i++) {
        rows[linhaBase + i] = rows[linhaBase + i] ?? [];
        rows[linhaBase + i][col] = vals[i];
      }
    }
  }

  // MECÂNICA: JAN (col 6) = 100 programadas, 90 executadas, 10 nao exec, indice 1.0
  //           JAN plano (col 26) = 50/50/0/1.0
  preencherBloco(5, 'MECÂNICA', { 6: [100, 90, 10, 1], 26: [50, 50, 0, 1] });
  preencherBloco(10, 'ELÉTRICA', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] });
  preencherBloco(15, 'LUBRIFICAÇÃO', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] });
  preencherBloco(20, ' OPERAÇÃO', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] }); // rotulo real tem espaco a mais
  preencherBloco(25, 'LIMPEZA\r\n OPERACIONAL ', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] }); // rotulo real tem quebra de linha
  preencherBloco(30, 'REFRIGERAÇÃO', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] });
  preencherBloco(35, 'SPCI', { 6: [0, 0, 0, 0], 26: [0, 0, 0, 0] });

  // Geral (linha 40): programadas/executadas/nao_exec/indice/fora_programacao
  rows[40] = []; rows[40][0] = 'Geral';
  rows[40][6] = 100; rows[41] = []; rows[41][6] = 90; rows[42] = []; rows[42][6] = 10;
  rows[43] = []; rows[43][6] = 1; rows[44] = []; rows[44][6] = 2;
  rows[40][26] = 50; rows[41][26] = 50; rows[42][26] = 0; rows[43][26] = 1;
  // FEV e MAR também têm ordens fora da programação (usado no teste que confere
  // que o acumulado soma os meses em vez de confiar na célula acumulada pronta).
  rows[44][7] = 3; rows[44][8] = 1;
  // Acumulado (coluna 18 / 38) -- a célula acumulada de "fora da programação"
  // (rows[44][18]) fica de propósito zerada/ausente, simulando o caso real onde
  // essa linha não tem fórmula de soma na planilha, mesmo com os meses preenchidos.
  rows[40][18] = 200; rows[41][18] = 180; rows[42][18] = 20; rows[43][18] = 0.9;
  rows[40][38] = 100; rows[41][38] = 95; rows[42][38] = 5; rows[43][38] = 0.95;

  return rows;
}

// Monta uma planilha so com a linha "Geral" preenchida pra alguns meses — usada
// pra testar a linha do tempo, que le varios meses de uma vez.
function montarPlanilhaMultiMeses(porMes: Record<string, [number, number, number, number]>): unknown[][] {
  // [programadas, executadas, planejadas_plano, executadas_plano]
  const rows: unknown[][] = [];
  const linhaCabecalho: unknown[] = [];
  const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  meses.forEach((m, i) => { linhaCabecalho[6 + i] = m; linhaCabecalho[26 + i] = m; });
  rows[4] = linhaCabecalho;

  rows[40] = []; rows[40][0] = 'Geral';
  rows[41] = []; rows[42] = []; rows[43] = [];

  for (const [mes, [prog, exec, planPlano, execPlano]] of Object.entries(porMes)) {
    const i = meses.indexOf(mes);
    rows[40][6 + i] = prog; rows[41][6 + i] = exec;
    rows[40][26 + i] = planPlano; rows[41][26 + i] = execPlano;
  }
  return rows;
}

describe('extrairHistoricoMeses', () => {
  it('extrai um ponto por mes com dados, na ordem dos meses', () => {
    const rows = montarPlanilhaMultiMeses({
      JAN: [10, 10, 10, 10], // 100% / 100%
      FEV: [10, 5, 10, 8],   // 50% / 80%
    });
    const pontos = extrairHistoricoMeses(rows, 'FEV');
    expect(pontos).toEqual([
      { label: 'JAN', atendimento: 100, cumprimento: 100 },
      { label: 'FEV', atendimento: 50, cumprimento: 80 },
    ]);
  });

  it('pula meses sem nenhuma ordem programada (ainda nao aconteceram)', () => {
    const rows = montarPlanilhaMultiMeses({ JAN: [10, 10, 10, 10] });
    const pontos = extrairHistoricoMeses(rows, 'MAR');
    expect(pontos.map(p => p.label)).toEqual(['JAN']);
  });

  it('nao inclui meses depois do mes pedido, mesmo que tenham dados', () => {
    const rows = montarPlanilhaMultiMeses({
      JAN: [10, 10, 10, 10],
      MAR: [10, 10, 10, 10],
    });
    const pontos = extrairHistoricoMeses(rows, 'FEV');
    expect(pontos.map(p => p.label)).toEqual(['JAN']);
  });
});

describe('localizarCabecalhoMeses', () => {
  it('acha as duas colunas de JAN (atendimento e plano) na linha de cabecalho', () => {
    const rows = montarPlanilha();
    expect(localizarCabecalhoMeses(rows)).toEqual({ colAtendimentoJan: 6, colPlanoJan: 26 });
  });

  it('lanca erro quando nao acha o cabecalho', () => {
    expect(() => localizarCabecalhoMeses([['nada aqui']])).toThrow(/cabeçalho/);
  });
});

describe('localizarLinhaRotulo', () => {
  it('ignora espacos e quebras de linha extras no rotulo (igual a planilha real)', () => {
    const rows = montarPlanilha();
    expect(localizarLinhaRotulo(rows, 'OPERAÇÃO')).toBe(20);
    expect(localizarLinhaRotulo(rows, 'LIMPEZA OPERACIONAL')).toBe(25);
  });

  it('lanca erro quando o rotulo nao existe', () => {
    expect(() => localizarLinhaRotulo([['X']], 'INEXISTENTE')).toThrow(/não encontrado/);
  });
});

describe('parseIndicadoresMensais', () => {
  it('calcula atendimento e cumprimento gerais do mes pela formula executadas/programadas', () => {
    const rows = montarPlanilha();
    const { dadosMensal } = parseIndicadoresMensais(rows, 'JAN', 2026);
    expect(dadosMensal.atendimentoGeral).toBe(90); // 90/100*100
    expect(dadosMensal.cumprimentoGeral).toBe(100); // 50/50*100
    expect(dadosMensal.totalForaProgramacao).toBe(2);
  });

  it('calcula os totais acumulados a partir da coluna de acumulado (JAN + 12), nao somando os meses', () => {
    const rows = montarPlanilha();
    const { dadosAcumulado } = parseIndicadoresMensais(rows, 'JAN', 2026);
    expect(dadosAcumulado.totalProgramadas).toBe(200);
    expect(dadosAcumulado.atendimentoGeral).toBe(90); // 180/200*100
    expect(dadosAcumulado.totalExecutadasPlano).toBe(95);
  });

  it('calcula o percentual fora da programacao sobre executadas+foraProgramacao, nao sobre programadas', () => {
    // planilha nao tem percentual pronto, so a contagem bruta de ordens fora da
    // programacao (linha "Geral"+4) -- o percentual e derivado daqui, usando o
    // total de ordens REALMENTE realizadas (executadas + fora) como base, nao
    // "programadas" (que por definicao nao inclui as ordens fora do plano).
    const rows = montarPlanilha();
    const { dadosMensal, dadosAcumulado } = parseIndicadoresMensais(rows, 'JAN', 2026);
    // mes: executadas=90, foraProgramacao=2 -> 2/(90+2)*100
    expect(dadosMensal.percentualForaProgramacao).toBeCloseTo((2 / 92) * 100, 2);
    // acumulado (so JAN ate agora): executadasAcum=180, foraProgramacaoAcum=2 -> 2/(180+2)*100
    expect(dadosAcumulado.percentualForaProgramacao).toBeCloseTo((2 / 182) * 100, 2);
  });

  it('soma o fora da programacao mes a mes no acumulado, em vez de confiar na celula acumulada pronta', () => {
    // a planilha real as vezes tem a linha "Ordens Fora da Programação" sem
    // formula de soma na coluna acumulada (fica 0/vazia), mesmo com os meses
    // individuais preenchidos -- essa planilha de teste reproduz isso de
    // proposito (rows[44][18] nunca é setado). JAN=2, FEV=3, MAR=1 -> soma=6.
    const rows = montarPlanilha();
    const { dadosAcumulado } = parseIndicadoresMensais(rows, 'MAR', 2026);
    expect(dadosAcumulado.percentualForaProgramacao).toBeCloseTo((6 / 186) * 100, 2); // 6/(180+6)*100
    expect(dadosAcumulado.percentualForaProgramacao).toBeGreaterThan(0);
  });

  it('usa o indice de cumprimento pre-calculado quando nao ha programadas (evita divisao por zero)', () => {
    const rows = montarPlanilha();
    // zera programadas do mes, mas mantem um indice pre-calculado de 75%
    rows[40][7] = 0; rows[41][7] = 0; rows[43][7] = 0.75;
    const { dadosMensal } = parseIndicadoresMensais(rows, 'FEV', 2026);
    expect(dadosMensal.atendimentoGeral).toBe(75);
  });

  it('preenche detalhesAreas para as 7 areas, mesmo com valor zero (nao pula area sem programacao, diferente do semanal)', () => {
    const rows = montarPlanilha();
    const { dadosMensal } = parseIndicadoresMensais(rows, 'JAN', 2026);
    expect(dadosMensal.detalhesAreas.map(a => a.area)).toEqual(AREAS_PCM_MENSAL);
    expect(dadosMensal.detalhesAreas[0].atendimento).toBe(90); // MECÂNICA
    expect(dadosMensal.detalhesAreas[1].atendimento).toBe(0); // ELÉTRICA, sem dados
  });

  it('usa a data manual informada quando valida, senao cai no primeiro/ultimo dia do mes', () => {
    const rows = montarPlanilha();
    const comData = parseIndicadoresMensais(rows, 'JAN', 2026, '29/12/2025', '02/02/2026');
    expect(comData.dadosMensal.periodoMes).toBe('29/12/2025 a 02/02/2026');

    const semData = parseIndicadoresMensais(rows, 'JAN', 2026);
    expect(semData.dadosMensal.periodoMes).toBe('01/01/2026 a 31/01/2026');
  });

  it('classifica o status geral usando a meta de 95% / 95%', () => {
    const rows = montarPlanilha();
    const { dadosMensal, dadosAcumulado } = parseIndicadoresMensais(rows, 'JAN', 2026);
    expect(dadosMensal.statusGeral).toBe('Próximo da Meta'); // 90% atendimento < 95%, mas >= 95*0.9
    // o acumulado reaproveita o status do mes, igual ao original (nao recalcula)
    expect(dadosAcumulado.statusGeral).toBe(dadosMensal.statusGeral);
  });

  it('lanca erro para mes invalido', () => {
    const rows = montarPlanilha();
    expect(() => parseIndicadoresMensais(rows, 'XXX' as any, 2026)).toThrow(/inválido/);
  });
});

function dadosMensalBase(overrides: Partial<DadosMensal> = {}): DadosMensal {
  return {
    mes: 'JAN', mesCompleto: 'Janeiro', ano: 2026, periodoMes: '01/01/2026 a 31/01/2026',
    dataInicio: '01/01/2026', dataFim: '31/01/2026', diasPeriodo: 31,
    atendimentoGeral: 95, cumprimentoGeral: 95, percentualForaProgramacao: 0,
    totalProgramadas: 100, totalExecutadas: 95, totalNaoExecutadas: 5, totalForaProgramacao: 0,
    totalPlanejadasPlano: 100, totalExecutadasPlano: 95, totalNaoExecutadasPlano: 5,
    detalhesAreas: [], statusGeral: 'Dentro da Meta', metaAtendimento: 95, metaCumprimento: 95,
    ...overrides,
  };
}

function dadosAcumuladoBase(overrides: Partial<DadosAcumulado> = {}): DadosAcumulado {
  return {
    mes: 'JAN', ano: 2026, periodoAcumulado: '01/01/2026 a 31/01/2026',
    atendimentoGeral: 90, cumprimentoGeral: 90, percentualForaProgramacao: 5,
    totalProgramadas: 100, totalExecutadas: 90, totalNaoExecutadas: 10, totalForaProgramacao: 5,
    totalPlanejadasPlano: 100, totalExecutadasPlano: 90, totalNaoExecutadasPlano: 10,
    detalhesAreas: [], statusGeral: 'Dentro da Meta', metaAtendimento: 95, metaCumprimento: 95, qtdMeses: 1,
    ...overrides,
  };
}

function areaZerada(area: string): AreaMensal {
  return {
    area, programadas: 0, executadas: 0, naoExecutadas: 0, foraProgramacao: 0,
    planejadasPlano: 0, executadasPlano: 0, naoExecutadasPlano: 0, atendimento: 0, cumprimento: 0,
  };
}

describe('areasComMovimento', () => {
  it('remove areas totalmente zeradas (nem programacao nem plano)', () => {
    const areas = [
      areaZerada('OPERAÇÃO'), areaZerada('LUBRIFICAÇÃO'),
      { ...areaZerada('MECÂNICA'), programadas: 10, executadas: 9 },
    ];
    const r = areasComMovimento(areas);
    expect(r.map(a => a.area)).toEqual(['MECÂNICA']);
  });

  it('mantem area que so tem movimento no plano (nao na programacao)', () => {
    const areas = [{ ...areaZerada('SPCI'), planejadasPlano: 5, executadasPlano: 5 }];
    expect(areasComMovimento(areas)).toHaveLength(1);
  });

  it('retorna lista vazia quando todas as areas estao zeradas', () => {
    expect(areasComMovimento([areaZerada('OPERAÇÃO'), areaZerada('LUBRIFICAÇÃO')])).toHaveLength(0);
  });
});

describe('analisarPontosAtencaoEAcoesMensal', () => {
  it('abre com alerta critico quando o status do mes e CRITICO', () => {
    const dados = dadosMensalBase({ statusGeral: 'Abaixo da Meta', atendimentoGeral: 40, cumprimentoGeral: 40 });
    const { pontosAtencao, acoesPrioritarias } = analisarPontosAtencaoEAcoesMensal(dados, null);
    expect(pontosAtencao[0].tipo).toBe('critico');
    expect(acoesPrioritarias[0].prioridade).toBe('urgente');
  });

  it('detecta melhoria quando o atendimento do mes supera o acumulado em mais de 2 pontos', () => {
    const dados = dadosMensalBase({ atendimentoGeral: 95 });
    const acumulado = dadosAcumuladoBase({ atendimentoGeral: 90 });
    const { pontosAtencao } = analisarPontosAtencaoEAcoesMensal(dados, acumulado);
    expect(pontosAtencao.some(p => p.tipo === 'melhoria')).toBe(true);
  });

  it('detecta queda quando o atendimento do mes fica mais de 2 pontos abaixo do acumulado', () => {
    const dados = dadosMensalBase({ atendimentoGeral: 85 });
    const acumulado = dadosAcumuladoBase({ atendimentoGeral: 95 });
    const { pontosAtencao } = analisarPontosAtencaoEAcoesMensal(dados, acumulado);
    expect(pontosAtencao.some(p => p.tipo === 'queda')).toBe(true);
  });

  it('sugere planejar o proximo mes, exceto em dezembro', () => {
    const { acoesPrioritarias: comProximo } = analisarPontosAtencaoEAcoesMensal(dadosMensalBase({ mes: 'JAN' }), null);
    expect(comProximo.some(a => a.acao.includes('Fevereiro'))).toBe(true);

    const { acoesPrioritarias: semProximo } = analisarPontosAtencaoEAcoesMensal(dadosMensalBase({ mes: 'DEZ' }), null);
    expect(semProximo.some(a => a.acao.startsWith('Preparar planejamento'))).toBe(false);
  });

  it('limita pontos de atencao e acoes a 5 itens', () => {
    const dados = dadosMensalBase({
      statusGeral: 'Abaixo da Meta', atendimentoGeral: 40, cumprimentoGeral: 40,
      totalNaoExecutadas: 20, totalForaProgramacao: 10,
    });
    const acumulado = dadosAcumuladoBase({ percentualForaProgramacao: 30 });
    const { pontosAtencao, acoesPrioritarias } = analisarPontosAtencaoEAcoesMensal(dados, acumulado);
    expect(pontosAtencao.length).toBeLessThanOrEqual(5);
    expect(acoesPrioritarias.length).toBeLessThanOrEqual(5);
  });
});

describe('gerarDestaquesMensal', () => {
  it('reconhece metas conquistadas quando as duas metas gerais sao atingidas', () => {
    const dados = dadosMensalBase({ atendimentoGeral: 95, cumprimentoGeral: 95 });
    const destaques = gerarDestaquesMensal(dados, null);
    expect(destaques.some(d => d.tipo === 'meta_atingida')).toBe(true);
  });

  it('reconhece evolucao positiva frente ao acumulado', () => {
    const dados = dadosMensalBase({ atendimentoGeral: 97 });
    const acumulado = dadosAcumuladoBase({ atendimentoGeral: 90 });
    const destaques = gerarDestaquesMensal(dados, acumulado);
    expect(destaques.some(d => d.tipo === 'evolucao')).toBe(true);
  });

  it('limita a 4 destaques', () => {
    const dados = dadosMensalBase({ atendimentoGeral: 99, cumprimentoGeral: 99, totalNaoExecutadas: 0, diasPeriodo: 40 });
    const acumulado = dadosAcumuladoBase({ atendimentoGeral: 90 });
    const destaques = gerarDestaquesMensal(dados, acumulado);
    expect(destaques.length).toBeLessThanOrEqual(4);
  });
});
