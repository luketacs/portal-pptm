import { extrairHorasProgramadasSemana } from './relatorio-programacao-semanal';

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
