import '@angular/compiler';
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
  area: 'Mecânica', especialidade: 'Lubrificação', periodicidade: '1 Semana(s)', tempoHoras: 2, hh: 4, loto: 'LOTO',
  recursos: '—', responsavel: '—', numeroOs: null, executadaEm: null, situacao: null, ...o,
});

const params: CronogramaPlanosExport = {
  titulo: 'Cronograma de Manutenção Preventiva',
  periodo: '01/11/2026 a 31/12/2026',
  notas: ['Nota 1.', 'Nota 2.', 'Nota 3.', 'Nota 4.'],
  areas: ['Elétrica', 'Mecânica', 'Apoio'],
  meses: [
    {
      mes: '2026-11', nome: 'Novembro de 2026', aba: 'NOV-2026', linhas: [
        linha({ numeroOs: '047990', executadaEm: '2026-11-03', situacao: 'Executada' }),
        linha({ data: '2026-11-09', semana: 46, codigo: 'PM-0002', area: 'Elétrica', nome: 'I-E-6M INSPEÇÃO SPDA', hh: 3 }),
      ],
    },
    { mes: '2026-12', nome: 'Dezembro de 2026', aba: 'DEZ-2026', linhas: [linha({ data: '2026-12-07', semana: 50 })] },
  ],
  planos: [{
    codigo: 'PM-0001', nome: 'L-OP-1S TRIPPERS', equipamento: 'TRIPPER 01', tagKks: '91EAC05', area: 'Mecânica',
    especialidade: 'Lubrificação', periodicidade: '1 Semana(s)', dataInicial: '2026-10-05', responsavel: '—',
    tempoHoras: 2, hh: 4, passosChecklist: 5, ocorrencias: 9,
  }],
};

it('FCA vem na primeira aba quando informado', async () => {
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    fca: {
      titulo: 'FCA — Controle dos planos', campos: [['Data de abertura', '29/10/2026']], fato: 'Fato X.', causas: ['Causa 1.', 'Causa 2.'],
      acoes: [{ tipo: 'Contenção', acao: 'Ação 1.', responsavel: 'PCM', prazo: 'A definir', status: 'Pendente' }],
    },
  });
  const wb = capturado!;
  expect(wb.worksheets.map(w => w.name)).toEqual(['FCA', 'Resumo', 'NOV-2026', 'DEZ-2026', 'Planos']);
  const textos = wb.getWorksheet('FCA')!.getSheetValues().flat().filter(v => typeof v === 'string') as string[];
  expect(textos).toEqual(expect.arrayContaining(['FATO', 'Fato X.', 'CAUSA', 'Causa 2.', 'AÇÃO', 'Ação 1.', 'A definir']));
  expect(textos.some(t => /portal/i.test(t))).toBe(false);
});

it('Resumo, uma aba por mês e a lista de planos, sem citar o Portal', async () => {
  await new ExcelExportService().exportarCronogramaPlanos(params);
  const wb = capturado!;
  expect(wb.worksheets.map(w => w.name)).toEqual(['Resumo', 'NOV-2026', 'DEZ-2026', 'Planos']);
  expect(wb.creator).not.toMatch(/portal/i);

  const nov = wb.getWorksheet('NOV-2026')!;
  expect(nov.getCell('A4').value).toBe('Data');
  expect(nov.getCell('Q4').value).toBe('Situação');
  expect(nov.getCell('C5').value).toBe('PM-0001');
  expect(nov.getCell('G6').value).toBe('Elétrica');
  // Data como data de verdade (filtra/ordena no Excel), não texto.
  expect((nov.getCell('A5').value as Date).toISOString().slice(0, 10)).toBe('2026-11-02');
  // O que já está registrado vem preenchido; o resto fica para preencher.
  expect(nov.getCell('O5').value).toBe('047990');
  expect((nov.getCell('P5').value as Date).toISOString().slice(0, 10)).toBe('2026-11-03');
  expect(nov.getCell('Q5').value).toBe('Executada');
  expect(nov.getCell('O6').value).toBeNull();
  expect(nov.getCell('Q6').dataValidation?.formulae?.[0]).toContain('Sem OS');
});

it('Resumo conta por fórmula sobre as abas dos meses (área, total, HH e situação)', async () => {
  await new ExcelExportService().exportarCronogramaPlanos(params);
  const resumo = capturado!.getWorksheet('Resumo')!;
  const linhaNov = resumo.getRow(10);
  expect(linhaNov.getCell(1).value).toBe('Novembro de 2026');
  expect(linhaNov.getCell(2).value).toEqual({ formula: `COUNTIF('NOV-2026'!$G$5:$G$5000,"Elétrica")`, result: 1 });
  expect(linhaNov.getCell(5).value).toEqual({ formula: `COUNTA('NOV-2026'!$C$5:$C$5000)`, result: 2 });
  expect(linhaNov.getCell(6).value).toEqual({ formula: `SUM('NOV-2026'!$K$5:$K$5000)`, result: 7 });
  expect(linhaNov.getCell(7).value).toEqual({ formula: `COUNTIF('NOV-2026'!$Q$5:$Q$5000,"Executada")`, result: 1 });
  expect(linhaNov.getCell(9).value).toMatchObject({ formula: `COUNTIF('NOV-2026'!$Q$5:$Q$5000,"Sem OS")` });
  expect(resumo.getRow(12).getCell(1).value).toBe('Total do período');
});

// Amostra para abrir no Excel: CRONOGRAMA_AMOSTRA=caminho.xlsx npm test -- excel-export-cronograma
it('grava amostra quando pedido', async () => {
  const destino = process.env['CRONOGRAMA_AMOSTRA'];
  if (!destino) return;
  await new ExcelExportService().exportarCronogramaPlanos({
    ...params,
    fca: {
      titulo: 'FCA — Controle dos planos de manutenção preventiva',
      campos: [['Data de abertura', '29/10/2026'], ['Responsável', 'PCM']],
      fato: 'O controle dos planos de manutenção preventiva pelo Protheus não é confiável. O cadastro dos planos tem periodicidade, '
        + 'data de referência ou equipamento diferentes do que é executado em campo, e as OS preventivas são geradas fora da data prevista.',
      causas: ['Planos desatualizados no Protheus.', 'Geração de OS preventivas fora da data prevista no Protheus.'],
      acoes: [
        { tipo: 'Contenção', acao: 'Controlar as preventivas por esta planilha.', responsavel: 'PCM', prazo: '29/10/2026', status: 'Implantada' },
        { tipo: 'Contenção', acao: 'Atualizar a planilha a cada fechamento semanal.', responsavel: 'PCM', prazo: 'Semanal', status: 'Em andamento' },
        { tipo: 'Corretiva', acao: 'Revisar o cadastro dos planos no Protheus.', responsavel: 'PCM', prazo: 'A definir', status: 'Pendente' },
      ],
    },
  });
  await capturado!.xlsx.writeFile(destino);
});
