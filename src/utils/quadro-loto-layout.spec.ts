import { abreviarStatusLoto, resumoConflitos, rotuloSegmento, segmentosDaLinha, type DiaLoto } from './quadro-loto-layout';

const item = (status: string, os: string | null, tecnico = 'Ana') => ({ status, descricao: `OS ${os}`, tecnicos: [tecnico], numeroOs: os });
const dia = (data: string, itens: ReturnType<typeof item>[] = [], conflito = false): DiaLoto => ({ data, itens, conflito });
const ROTULOS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((label, i) => ({ data: `2026-10-${19 + i}`, label }));

it('dias seguidos com a mesma OS e status viram uma faixa só; dia vazio quebra a faixa', () => {
  const loto = [item('LOTO', '1')];
  const segs = segmentosDaLinha([
    dia('2026-10-19', loto), dia('2026-10-20', loto), dia('2026-10-21', loto),
    dia('2026-10-22'), dia('2026-10-23', loto),
  ]);
  expect(segs.map(s => [s.inicio, s.dias])).toEqual([[0, 3], [4, 1]]);
});

it('mesmo status com OS diferente continua a faixa (junta as OS); troca de status começa outra', () => {
  const segs = segmentosDaLinha([
    dia('2026-10-19', [item('LOTO', '1')]), dia('2026-10-20', [item('LOTO', '2')]), dia('2026-10-21', [item('FUNCIONANDO', '2')]),
  ]);
  expect(segs.map(s => [s.inicio, s.dias])).toEqual([[0, 2], [2, 1]]);
  expect(segs[0].itens.map(i => i.numeroOs)).toEqual(['1', '2']);
});

it('técnico repetido aparece uma vez só', () => {
  const segs = segmentosDaLinha([dia('2026-10-19', [{ status: 'LOTO', descricao: 'x', tecnicos: ['OPERAÇÃO', 'OPERAÇÃO'], numeroOs: '1' }])]);
  expect(segs[0].itens[0].tecnicos).toEqual(['OPERAÇÃO']);
});

it('rótulo abrevia e mostra o conflito entre status', () => {
  expect(abreviarStatusLoto('Funcionando')).toBe('FUNC');
  expect(abreviarStatusLoto('DISPONÍVEL')).toBe('DISP');
  expect(rotuloSegmento({ itens: [item('LOTO', '1')], conflito: false })).toBe('LOTO');
  expect(rotuloSegmento({ itens: [item('LOTO', '1'), item('FUNCIONANDO', '2')], conflito: true })).toBe('LOTO × FUNC');
  expect(rotuloSegmento({ itens: [item('DISPONÍVEL', '1'), item('DISPONÍVEL', '2')], conflito: true })).toBe('DISP × DISP');
});

it('resumo de conflitos diz os dias, quem e as OS', () => {
  const conflito = [item('LOTO', '048018', 'Eduarda'), item('FUNCIONANDO', '046320', 'Mauro')];
  const r = resumoConflitos([dia('2026-10-19', conflito, true), dia('2026-10-20', conflito, true), dia('2026-10-21', [item('LOTO', '1')])], ROTULOS);
  expect(r).toHaveLength(1);
  expect(r[0].dias).toBe('SEG–TER');
  expect(r[0].texto).toBe('LOTO (Eduarda) × FUNCIONANDO (Mauro)');
  expect(r[0].os).toEqual(['048018', '046320']);
});
