import { extrairHorasProgramadasSemana, extrairPeriodoAba } from './relatorio-programacao-semanal';

// Monta uma aba sintetica no mesmo layout real (cabecalho na linha 4, EXECUTANTE
// na coluna 1, DURACAO na coluna 18 — mas o parser acha isso pelo rotulo, nao pela
// posicao, entao o teste tambem confere que funciona numa posicao diferente).
function montarAba(linhasExecutanteDuracao: [string, number | string, string?][], colExecutante = 1, colDuracao = 18): unknown[][] {
  const rows: unknown[][] = [];
  const cabecalho: unknown[] = [];
  cabecalho[colExecutante] = 'EXECUTANTE';
  cabecalho[colDuracao] = 'DURAÇÃO';
  cabecalho[3] = 'SEMANA';
  rows.push([]); rows.push([]); rows.push([]); rows.push(cabecalho);

  for (const [nome, duracao, semana] of linhasExecutanteDuracao) {
    const row: unknown[] = [];
    row[colExecutante] = nome;
    row[colDuracao] = duracao;
    row[3] = semana ?? '';
    rows.push(row);
  }
  return rows;
}

describe('extrairHorasProgramadasSemana', () => {
  it('soma a duracao de todas as OS do mesmo executante numa aba', () => {
    const aba = montarAba([
      ['DANIEL', 19.5, 'S33'],
      ['DANIEL', 3, 'S34'],
      ['DANIEL', 2.5, ''],
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais['DANIEL']).toBe(25);
  });

  it('soma a duracao de TODAS as linhas, independente da coluna SEMANA (0, S33, S34 ou em branco)', () => {
    const aba = montarAba([
      ['ALVEMAR', 26, '0' as any],
      ['ALVEMAR', 13, 'S33'],
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais['ALVEMAR']).toBe(39);
  });

  it('combina totais do mesmo nome vindos de abas diferentes (ex: ELETRICA + MECANICA)', () => {
    const abaEletrica = montarAba([['MICAEL', 10, 'S34']]);
    const abaMecanica = montarAba([['MICAEL', 5, 'S34']]);
    const totais = extrairHorasProgramadasSemana([abaEletrica, abaMecanica]);
    expect(totais['MICAEL']).toBe(15);
  });

  it('ignora nomes de colaboradores diferentes separadamente', () => {
    const aba = montarAba([
      ['DANIEL', 10, 'S34'],
      ['MICAEL', 20, 'S34'],
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais).toEqual({ DANIEL: 10, MICAEL: 20 });
  });

  it('acha as colunas pelo rotulo, mesmo em posicoes diferentes do padrao', () => {
    const aba = montarAba([['NERI', 8, 'S34']], 5, 2); // EXECUTANTE na col 5, DURACAO na col 2
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais['NERI']).toBe(8);
  });

  it('ignora uma aba sem as colunas esperadas (ex: aba APOIO vazia), sem lancar erro', () => {
    const abaVazia: unknown[][] = [[], [], ['', 'D', 'ALEXANDRE OPE']];
    const abaComDados = montarAba([['DANIEL', 10, 'S34']]);
    const totais = extrairHorasProgramadasSemana([abaVazia, abaComDados]);
    expect(totais).toEqual({ DANIEL: 10 });
  });

  it('ignora celulas de duracao vazias ou nao numericas, sem quebrar a soma dos outros', () => {
    const aba = montarAba([
      ['DANIEL', 10, 'S34'],
      ['DANIEL', '', 'S34'],
      ['DANIEL', 'N/A', 'S34'],
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais['DANIEL']).toBe(10);
  });

  it('normaliza espacos e caixa do nome (mesmo nome com grafias diferentes vira uma chave so)', () => {
    const aba = montarAba([
      ['ant. josé', 10, 'S34'],
      ['ANT.  JOSÉ', 5, 'S34'],
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(Object.keys(totais)).toHaveLength(1);
    expect(totais['ANT. JOSÉ']).toBe(15);
  });

  it('retorna objeto vazio quando nenhuma aba tem o layout esperado', () => {
    expect(extrairHorasProgramadasSemana([[[]], [['x']]])).toEqual({});
  });
});

// Layout real (celula mesclada): titulo na linha 1, cabecalho "ORDEM"/"DURAÇÃO" na
// linha 2 (sem rotulo "EXECUTANTE" — o nome fica na coluna antes de "ORDEM", só na
// 1a linha do bloco de cada colaborador), sub-cabecalho SEG..DOM na linha 3, dados
// a partir da linha 4 -- mesma estrutura validada contra os arquivos reais
// "PROGRAMAÇÃO MANUTENÇÃO ELÉTRICA/MECÂNICA S27/S28/S29.xlsx" e
// "PROGRAMAÇÃO ELÉTRICA/MECÂNICA JUL.xlsx" (abas por semana "S19".."S31").
function montarAbaMesclada(blocos: { nome: string; ordens: [string, number | string][] }[]): unknown[][] {
  const rows: unknown[][] = [];
  rows.push([]);
  rows.push(['', '', '', '  PROGRAMAÇÃO MANUTENÇÃO ELÉTRICA - S27 2026 (29/06 À 05/07)']);
  rows.push(['', '', '', 'ORDEM', 'DESCRIÇÃO DA ORDEM', 'DURAÇÃO', 'BEM / EQUIPAMENTO', 'RECURSOS', 'LOTO', 'ÁREA DE ATUAÇÃO', 46202, 46203, 46204, 46205, 46206, 46207, 46208, 'STATUS']);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']);

  for (const bloco of blocos) {
    bloco.ordens.forEach(([ordem, duracao], i) => {
      const row: unknown[] = [];
      row[2] = i === 0 ? bloco.nome : ''; // só a 1a linha do bloco tem o nome (célula mesclada)
      row[3] = ordem;
      row[5] = duracao;
      rows.push(row);
    });
    // mini-cabeçalho repetido entre blocos
    rows.push(['', '', '', 'ORDEM', 'DESCRIÇÃO DA ORDEM', 'DURAÇÃO']);
    rows.push([]);
  }
  return rows;
}

describe('extrairHorasProgramadasSemana (layout mesclado, sem rotulo EXECUTANTE)', () => {
  it('soma a duracao de todas as OS do bloco, atribuindo pro nome herdado da celula mesclada', () => {
    const aba = montarAbaMesclada([
      { nome: 'XAVIER', ordens: [['047475', 6.5], ['047476', 3], ['004406', 3.5], ['047460', 13]] },
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais['XAVIER']).toBe(26);
  });

  it('separa corretamente varios blocos de colaboradores na mesma aba', () => {
    const aba = montarAbaMesclada([
      { nome: 'XAVIER', ordens: [['047475', 6.5]] },
      { nome: 'NIVALDO', ordens: [['018491', 6.5], ['045032', 2]] },
      { nome: 'MAURO', ordens: [['018491', 6.5], ['047476', 3]] },
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais).toEqual({ XAVIER: 6.5, NIVALDO: 8.5, MAURO: 9.5 });
  });

  it('pula linhas de afastamento/ferias (ordem em texto, sem duracao numerica)', () => {
    const aba = montarAbaMesclada([
      { nome: 'VLADENIR', ordens: [['AFASTAMENTO MÉDICO', '']] },
      { nome: 'CARLOS JR', ordens: [['FÉRIAS 29/07 - 10/07', '']] },
      { nome: 'EDUARDA', ordens: [['047479', 6.5]] },
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    expect(totais).toEqual({ EDUARDA: 6.5 });
  });

  it('nao duplica o mini-cabecalho repetido entre blocos como se fosse uma OS', () => {
    const aba = montarAbaMesclada([
      { nome: 'DANIEL', ordens: [['047451', 8]] },
      { nome: 'MICAEL', ordens: [['045332', 2]] },
    ]);
    const totais = extrairHorasProgramadasSemana([aba]);
    // se o mini-cabecalho "ORDEM"/"DURAÇÃO" fosse somado, DURAÇÃO viraria NaN e
    // quebraria a soma -- confere que o total de cada um fica exato
    expect(totais).toEqual({ DANIEL: 8, MICAEL: 2 });
  });

  it('combina abas de layouts diferentes (mesclado + simples) na mesma extracao', () => {
    const abaMesclada = montarAbaMesclada([{ nome: 'DANIEL', ordens: [['047451', 8]] }]);
    const abaSimples = montarAba([['DANIEL', 10, 'S34']]);
    const totais = extrairHorasProgramadasSemana([abaMesclada, abaSimples]);
    expect(totais['DANIEL']).toBe(18);
  });

  it('ignora uma aba de backlog sem coluna antes de ORDEM (ORDEM na coluna 0)', () => {
    const abaBacklog: unknown[][] = [
      ['Ordem', 'Descrição', 'Duração', 'Bem', 'Data Início'],
      ['007053', 'FABRICAR BASES', '', 'SISTUMC91EAC', 45490],
    ];
    expect(extrairHorasProgramadasSemana([abaBacklog])).toEqual({});
  });
});

describe('extrairPeriodoAba', () => {
  it('extrai inicio/fim do titulo da aba (mesmo formato real: "S27 2026 (29/06 À 05/07)")', () => {
    const rows: unknown[][] = [[], ['', '', '', '  PROGRAMAÇÃO MANUTENÇÃO ELÉTRICA - S27 2026 (29/06 À 05/07)']];
    const periodo = extrairPeriodoAba(rows);
    expect(periodo).toEqual({
      inicio: new Date(Date.UTC(2026, 5, 29)),
      fim: new Date(Date.UTC(2026, 6, 5)),
    });
  });

  it('trata virada de ano (semana que termina em janeiro do ano seguinte)', () => {
    const rows: unknown[][] = [['  PROGRAMAÇÃO MANUTENÇÃO MECÂNICA - S53 2025 (29/12 À 04/01)']];
    const periodo = extrairPeriodoAba(rows);
    expect(periodo?.inicio).toEqual(new Date(Date.UTC(2025, 11, 29)));
    expect(periodo?.fim).toEqual(new Date(Date.UTC(2026, 0, 4)));
  });

  it('retorna null quando nao acha o padrao de titulo esperado', () => {
    expect(extrairPeriodoAba([['sem titulo aqui'], ['outra linha qualquer']])).toBeNull();
  });
});
