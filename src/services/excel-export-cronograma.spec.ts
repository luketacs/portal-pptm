import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import type * as ExcelJS from 'exceljs';
import { CronogramaPlanosExport, CronogramaPlanosLinha, ExcelExportService } from './excel-export.service';

// Ambiente node: sem logo (fetch falha) e sem download — o workbook é capturado antes.
let capturado: ExcelJS.Workbook | null = null;
beforeEach(() => {
  capturado = null;
  globalThis.fetch = jest.fn(async () => ({ ok: false }) as Response) as typeof fetch;
  jest.spyOn(ExcelExportService.prototype as any, 'baixarWorkbook').mockImplementation(async (...args: unknown[]) => {
    capturado = args[0] as ExcelJS.Workbook;
  });
});
afterEach(() => { jest.restoreAllMocks(); });

const linha = (o: Partial<CronogramaPlanosLinha>): CronogramaPlanosLinha => ({
  data: '2026-11-02', semana: 45, codigo: 'PM-0001', nome: 'L-OP-1S TRIPPERS', equipamento: 'TRIPPER 01', tagKks: '91EAC05',
  area: 'Mecânica', periodicidade: '1 Semana(s)', numeroOs: null, executadaEm: null, situacao: null, ...o,
});

const params: CronogramaPlanosExport = {
  titulo: 'Cronograma de Manutenção Preventiva',
  periodo: '01/11/2026 a 31/12/2026',
  notas: [['Datas previstas', 'Nota 1.'], ['Como atualizar', 'Nota 2.']],
  pendenciasDesde: '2026-10-01',
  areas: ['Elétrica', 'Mecânica', 'Apoio'],
  meses: [
    {
      mes: '2026-11', nome: 'Novembro de 2026', aba: 'NOV-2026', linhas: [
        linha({ numeroOs: '047990', executadaEm: '2026-11-03', situacao: 'Executada' }),
        linha({ data: '2026-11-09', semana: 46, codigo: 'PM-0002', area: 'Elétrica', nome: 'I-E-6M INSPEÇÃO SPDA' }),
      ],
    },
    { mes: '2026-12', nome: 'Dezembro de 2026', aba: 'DEZ-2026', linhas: [linha({ data: '2026-12-07', semana: 50 })] },
  ],
  planos: [{
    codigo: 'PM-0001', nome: 'L-OP-1S TRIPPERS', equipamento: 'TRIPPER 01', tagKks: '91EAC05', area: 'Mecânica',
    especialidade: 'Lubrificação', periodicidade: '1 Semana(s)', dataInicial: '2026-10-05', responsavel: '',
    loto: 'LOTO', recursos: 'ANDAIME', tempoHoras: 2, hh: 4, passosChecklist: 5, ocorrencias: 9,
  }],
};

const textosDaAba = (ws: ExcelJS.Worksheet) => {
  const textos: string[] = [];
  ws.eachRow(row => row.eachCell(cel => { if (typeof cel.value === 'string') textos.push(cel.value); }));
  return textos;
};

it('FCA vem na primeira aba quando informado, com títulos em sentence case e sem cor no status', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    fca: {
      titulo: 'Controle dos planos', campos: [['Data de abertura', '29/10/2026']], fato: 'Fato X.', causas: ['Causa 1.', 'Causa 2.'],
      acoes: [{ tipo: 'Contenção', acao: 'Ação 1.', responsavel: 'PCM', prazo: 'A definir', status: 'Pendente' }],
    },
  });
  const wb = capturado!;
  expect(wb.worksheets.map(w => w.name)).toEqual(['FCA', 'Resumo', 'Sem OS (FCA)', 'Pendências', 'Notas', 'NOV-2026', 'DEZ-2026', 'Planos']);
  const fca = wb.getWorksheet('FCA')!;
  const textos = textosDaAba(fca);
  expect(textos).toEqual(expect.arrayContaining(['1. Fato', 'Fato X.', '2. Causa', 'Causa 2.', '3. Ação', 'Ação 1.', 'A definir']));
  expect(textos.some(t => /portal/i.test(t))).toBe(false);
  const celulaStatus = fca.findRow(fca.rowCount)!.getCell(6);
  expect(celulaStatus.value).toBe('Pendente');
  expect(celulaStatus.fill).toBeUndefined();
});

it('Resumo, Sem OS (FCA), Pendências, Notas, uma aba por mês e a lista de planos, sem citar o Portal', async () => {
  await new ExcelExportService().exportarCronogramaPlanos(params);
  const wb = capturado!;
  expect(wb.worksheets.map(w => w.name)).toEqual(['Resumo', 'Sem OS (FCA)', 'Pendências', 'Notas', 'NOV-2026', 'DEZ-2026', 'Planos']);
  expect(wb.creator).not.toMatch(/portal/i);

  const nov = wb.getWorksheet('NOV-2026')!;
  const cabecalhoMes = nov.getRow(4).values as unknown[];
  expect(cabecalhoMes.slice(1)).toEqual([
    'Data', 'Semana', 'Plano', 'Descrição', 'Equipamento', 'TAG/KKS', 'Área', 'Periodicidade', 'Nº OS', 'Executada em', 'Situação', 'Observação',
  ]);
  expect(nov.getCell('C5').value).toBe('PM-0001');
  expect(nov.getCell('G6').value).toBe('Elétrica');
  // Data como data de verdade (filtra/ordena no Excel), não texto.
  expect((nov.getCell('A5').value as Date).toISOString().slice(0, 10)).toBe('2026-11-02');
  // O que já está registrado vem preenchido; o resto fica para preencher.
  expect(nov.getCell('I5').value).toBe('047990');
  expect((nov.getCell('J5').value as Date).toISOString().slice(0, 10)).toBe('2026-11-03');
  expect(nov.getCell('K5').value).toBe('Executada');
  expect(nov.getCell('I6').value).toBeNull();
  expect(nov.getCell('K6').dataValidation?.formulae?.[0]).toContain('Sem OS');

  // O que saiu das abas de mês continua no cadastro.
  const planos = wb.getWorksheet('Planos')!;
  const cabecalhoPlanos = planos.getRow(4).values as unknown[];
  expect(planos.getRow(5).getCell(cabecalhoPlanos.indexOf('LOTO')).value).toBe('LOTO');
  expect(planos.getRow(5).getCell(cabecalhoPlanos.indexOf('Recursos')).value).toBe('ANDAIME');
  expect(planos.getRow(5).getCell(cabecalhoPlanos.indexOf('Especialidade')).value).toBe('Lubrificação');
});

it('título começa depois do logo em toda aba', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    fca: { titulo: 'Controle', campos: [], fato: 'F.', causas: [], acoes: [] },
  });
  const wb = capturado!;
  // Logo de 150 px: 1ª coluna com pelo menos 162 px à esquerda.
  expect(wb.getWorksheet('FCA')!.getCell('C1').value).toBe('FCA: Fato, Causa e Ação');
  expect(wb.getWorksheet('Resumo')!.getCell('C1').value).toBe(params.titulo);
  expect(wb.getWorksheet('NOV-2026')!.getCell('D1').value).toBe(params.titulo);
  expect(wb.getWorksheet('Notas')!.getCell('B1').value).toBe(params.titulo);
});

it('Resumo conta por fórmula sobre as abas dos meses (área, total e situação), com o total logo abaixo do cabeçalho', async () => {
  await new ExcelExportService().exportarCronogramaPlanos(params);
  const resumo = capturado!.getWorksheet('Resumo')!;
  expect(resumo.getRow(5).getCell(1).value).toBe('Total do período');
  expect(resumo.getRow(5).getCell(5).value).toEqual({ formula: 'SUM(E6:E7)' });
  const linhaNov = resumo.getRow(6);
  expect(linhaNov.getCell(1).value).toBe('Novembro de 2026');
  // Ordens sem OS ficam na aba própria: área, total e Sem OS somam as duas abas.
  const semOs = `'Sem OS (FCA)'!$C$5:$C$5000,"NOV-2026"`;
  expect(linhaNov.getCell(2).value).toEqual({
    formula: `COUNTIF('NOV-2026'!$G$5:$G$5000,"Elétrica")+COUNTIFS(${semOs},'Sem OS (FCA)'!$G$5:$G$5000,"Elétrica")`, result: 1,
  });
  expect(linhaNov.getCell(5).value).toEqual({ formula: `COUNTA('NOV-2026'!$C$5:$C$5000)+COUNTIF(${semOs})`, result: 2 });
  expect(linhaNov.getCell(6).value).toEqual({ formula: `COUNTIF('NOV-2026'!$K$5:$K$5000,"Executada")`, result: 1 });
  expect(linhaNov.getCell(8).value).toMatchObject({ formula: `COUNTIF('NOV-2026'!$K$5:$K$5000,"Sem OS")+COUNTIF(${semOs})` });
  // Zero em branco: mês futuro não fica cheio de "0".
  expect(linhaNov.getCell(8).numFmt).toBe('#,##0;-#,##0;;@');
  // Total acumulado: mesma conta dos meses, só sobre o que tem resultado.
  expect(resumo.getRow(5).getCell(12).value).toEqual({ formula: 'IF((SUM(F5:K5)-I5)=0,"",F5/(SUM(F5:K5)-I5))' });
  // Mês sem resultado fica sem percentual.
  const pctDez = resumo.getRow(7).getCell(12).value as { formula: string; result: unknown };
  expect(pctDez.formula).toBe('IF((SUM(F7:K7)-I7)=0,"",F7/(SUM(F7:K7)-I7))');
  expect(pctDez.result).toBeFalsy();
});

it('dispensada pela parada: conta em coluna própria, fica fora da base do % e traz a observação', async () => {
  const observacao = 'Parada: ocorrência mensal de 15/10/2026, OS 047200.';
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    meses: [{
      mes: '2026-10', nome: 'Outubro de 2026', aba: 'OUT-2026', linhas: [
        linha({ numeroOs: '047200', executadaEm: '2026-10-20', situacao: 'Executada' }),
        linha({ situacao: 'Sem OS' }),
        linha({ situacao: 'Dispensada (parada)', observacao }),
        linha({ situacao: 'Dispensada (parada)', observacao }),
        linha({ numeroOs: '047201', situacao: 'Programada' }),
        linha({ data: '2026-10-30' }),
      ],
    }],
  });
  const wb = capturado!;
  const out = wb.getWorksheet('OUT-2026')!;
  expect(out.getCell('K7').value).toBe('Dispensada (parada)');
  expect(out.getCell('I7').value).toBeNull();
  expect(out.getCell('L7').value).toBe(observacao);
  expect(out.getCell('K7').dataValidation?.formulae?.[0]).toContain('Dispensada (parada)');

  const resumo = wb.getWorksheet('Resumo')!;
  const cab = resumo.getRow(4).values as unknown[];
  const coluna = (titulo: string) => cab.indexOf(titulo);
  const linhaOut = resumo.getRow(6);
  expect(linhaOut.getCell(coluna('Dispensadas (parada)')).value)
    .toEqual({ formula: `COUNTIF('OUT-2026'!$K$5:$K$5000,"Dispensada (parada)")`, result: 2 });
  const pct = linhaOut.getCell(coluna('% executadas')).value as { formula: string; result: number };
  // 1 executada de 2 com resultado: dispensadas, programada e linha sem situação ficam fora.
  expect(pct.result).toBe(0.5);
  expect(pct.formula).toBe('IF((SUM(F6:K6)-I6)=0,"",F6/(SUM(F6:K6)-I6))');
});

it('Pendências lista só Não executada, em ordem de data (Sem OS tem aba própria)', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    meses: [{
      mes: '2026-10', nome: 'Outubro de 2026', aba: 'OUT-2026', linhas: [
        linha({ data: '2026-10-20', codigo: 'PM-0003', numeroOs: '048001', situacao: 'Não executada' }),
        linha({ data: '2026-10-05', codigo: 'PM-0004', situacao: 'Sem OS' }),
        linha({ data: '2026-10-06', codigo: 'PM-0005', numeroOs: '048002', executadaEm: '2026-10-06', situacao: 'Executada' }),
        linha({ data: '2026-10-07', codigo: 'PM-0006', situacao: 'Dispensada (parada)' }),
        linha({ data: '2026-10-08', codigo: 'PM-0007', numeroOs: '048003', situacao: 'Programada' }),
      ],
    }],
  });
  const ws = capturado!.getWorksheet('Pendências')!;
  expect(ws.getCell('C5').value).toBe('PM-0003');
  expect(ws.getCell('H5').value).toBe('048001');
  expect(ws.getCell('I5').value).toBe('Não executada');
  expect(ws.getCell('C6').value).toBeNull();
});

it('Pendências corta pela data de início do tratamento, mas mês e Resumo seguem com a situação real', async () => {
  const meses = [{
    mes: '2026-11', nome: 'Novembro de 2026', aba: 'NOV-2026', linhas: [
      linha({ data: '2026-11-08', codigo: 'PM-0010', situacao: 'Sem OS' }),
      linha({ data: '2026-11-09', codigo: 'PM-0011', numeroOs: '048500', situacao: 'Não executada' }),
    ],
  }];
  await new ExcelExportService().exportarCronogramaPlanos({ ...params, pendenciasDesde: '2026-11-09', meses });
  const wb = capturado!;
  const ws = wb.getWorksheet('Pendências')!;
  expect(ws.getCell('C5').value).toBe('PM-0011');
  expect(ws.getCell('C6').value).toBeNull();
  expect(String(ws.getCell('C2').value ?? ws.getCell('D2').value)).toContain('Pendências desde 09/11/2026 | 1 ordem(ns)');
  // A sem OS anterior ao corte sai da aba do mês, mas continua contando no Resumo.
  expect(wb.getWorksheet('NOV-2026')!.getCell('C5').value).toBe('PM-0011');
  expect(wb.getWorksheet('Sem OS (FCA)')!.getCell('D5').value).toBe('PM-0010');
  expect(wb.getWorksheet('Resumo')!.getRow(6).getCell(8).value).toMatchObject({ result: 1 });
});

it('fechamento informado aparece no subtítulo das abas', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({ ...params, fechamento: 'Fechamento até S44 (01/11/2026)' });
  const resumo = capturado!.getWorksheet('Resumo')!;
  expect(String(resumo.getCell('C2').value)).toContain('Fechamento até S44 (01/11/2026) | Posição em');
});

it('Pendências sem nenhuma ordem no período diz isso, em vez de tabela vazia', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params, pendenciasDesde: '2026-11-09',
    meses: [{ mes: '2026-10', nome: 'Outubro de 2026', aba: 'OUT-2026', linhas: [linha({ data: '2026-10-05', situacao: 'Sem OS' })] }],
  });
  expect(capturado!.getWorksheet('Pendências')!.getCell('A5').value).toBe('Nenhuma ordem não executada desde 09/11/2026. Ordens sem OS: aba Sem OS (FCA).');
});

it('estilo de ficha técnica: Arial, cabeçalho cinza e vermelho só na exceção', async () => {
  await new ExcelExportService().exportarCronogramaPlanos(params);
  const nov = capturado!.getWorksheet('NOV-2026')!;
  expect(nov.getCell('A1').value ?? nov.getCell('D1').value).toBeTruthy();
  expect(nov.getCell('D1').font?.name).toBe('Arial');
  expect((nov.getCell('A4').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFE7EAEE');
  const { conditionalFormattings } = nov as unknown as { conditionalFormattings: { rules: { formulae?: string[] }[] }[] };
  expect(conditionalFormattings[0].rules.map(r => r.formulae?.[0])).toEqual(['$K5="Não executada"', '$K5="Sem OS"']);
  const textos = wbTextos(capturado!);
  expect(textos.some(t => t.includes('—'))).toBe(false);
  expect(textos.some(t => /gerado em/i.test(t))).toBe(false);
});

// Pedido em 11/11/2026: ordens sem OS saem das abas de mês para uma aba com a FCA de cada uma.
describe('aba Sem OS (FCA)', () => {
  const meses = [
    {
      mes: '2026-10', nome: 'Outubro de 2026', aba: 'OUT-2026', linhas: [
        linha({ data: '2026-10-08', codigo: 'PM-0629', situacao: 'Sem OS' }),
        linha({ data: '2026-10-09', codigo: 'PM-0700', numeroOs: '048100', executadaEm: '2026-10-09', situacao: 'Executada' }),
      ],
    },
    { mes: '2026-11', nome: 'Novembro de 2026', aba: 'NOV-2026', linhas: [linha({ data: '2026-11-04', codigo: 'PM-0764', area: 'Elétrica', situacao: 'Sem OS' })] },
  ];
  const fcaSemOs = {
    'PM-0629|2026-10-08': {
      fato: 'Sem execução na ocorrência mensal.', causa: 'Entrada da parada.', acao: 'Retomada pela OS 048346.',
      responsavel: 'PCM', prazo: '30/10/2026', status: 'Concluída',
    },
  };

  it('tira a sem OS da aba do mês e lista na aba própria com a FCA, sem perder a contagem', async () => {
    await new ExcelExportService().exportarCronogramaPlanos({ ...params, meses, fcaSemOs });
    const wb = capturado!;
    const out = wb.getWorksheet('OUT-2026')!;
    expect(out.getCell('C5').value).toBe('PM-0700');
    expect(out.getCell('C6').value).toBeNull();
    expect(String(out.getCell('D2').value)).toContain('2 ordem(ns) prevista(s), 1 sem OS na aba Sem OS (FCA)');

    const ws = wb.getWorksheet('Sem OS (FCA)')!;
    expect((ws.getRow(4).values as unknown[]).slice(1)).toEqual([
      'Data', 'Semana', 'Mês', 'Plano', 'Descrição', 'Equipamento', 'Área', 'Periodicidade', 'Fato', 'Causa', 'Ação', 'Responsável', 'Prazo', 'Status',
    ]);
    expect((ws.getRow(5).values as unknown[]).slice(3)).toEqual([
      'OUT-2026', 'PM-0629', 'L-OP-1S TRIPPERS', 'TRIPPER 01', 'Mecânica', '1 Semana(s)',
      'Sem execução na ocorrência mensal.', 'Entrada da parada.', 'Retomada pela OS 048346.', 'PCM', '30/10/2026', 'Concluída',
    ]);
    expect(String(ws.getCell('C2').value ?? ws.getCell('D2').value)).toContain('2 ordem(ns), 1 com ação em aberto');

    const resumo = wb.getWorksheet('Resumo')!;
    const cab = resumo.getRow(4).values as unknown[];
    expect(resumo.getRow(6).getCell(cab.indexOf('Sem OS')).value).toMatchObject({ result: 1 });
    expect(resumo.getRow(6).getCell(cab.indexOf('Total previstas')).value).toMatchObject({ result: 2 });
    expect(resumo.getRow(6).getCell(cab.indexOf('% executadas')).value).toMatchObject({ result: 0.5 });
  });

  it('sem FCA cadastrada: causa e ação em branco, status Pendente em destaque', async () => {
    await new ExcelExportService().exportarCronogramaPlanos({ ...params, meses, fcaSemOs });
    const ws = capturado!.getWorksheet('Sem OS (FCA)')!;
    expect(ws.getCell('D6').value).toBe('PM-0764');
    expect(ws.getCell('C6').value).toBe('NOV-2026');
    expect(String(ws.getCell('I6').value)).toContain('Sem OS na programação');
    expect(ws.getCell('J6').value).toBeNull();
    expect(ws.getCell('K6').value).toBeNull();
    expect(ws.getCell('N6').value).toBe('Pendente');
    expect(ws.getCell('N6').font?.color?.argb).toBe('FFB91C1C');
    expect(ws.getCell('N5').font?.color?.argb).not.toBe('FFB91C1C');
  });
});

function wbTextos(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.flatMap(textosDaAba);
}

// Amostra para abrir no Excel: CRONOGRAMA_AMOSTRA=saida.xlsx [CRONOGRAMA_DADOS=dados.json] npm test -- excel-export-cronograma
it('grava amostra quando pedido', async () => {
  const destino = process.env['CRONOGRAMA_AMOSTRA'];
  if (!destino) return;
  const dados = process.env['CRONOGRAMA_DADOS'];
  const entrada = dados ? JSON.parse(readFileSync(dados, 'utf8')) as CronogramaPlanosExport : params;
  // Com o logo real, quando a amostra informa o arquivo (no navegador vem de /assets).
  const logo = process.env['CRONOGRAMA_LOGO'];
  if (logo) {
    jest.spyOn(ExcelExportService.prototype as any, 'carregarLogoBuffer').mockImplementation(async () => {
      const b = readFileSync(logo);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    });
  }
  await new ExcelExportService().exportarCronogramaPlanos(entrada);
  await capturado!.xlsx.writeFile(destino);
}, 60_000); // com dados reais a gravação passa do limite padrão de 5 s e corta o arquivo
