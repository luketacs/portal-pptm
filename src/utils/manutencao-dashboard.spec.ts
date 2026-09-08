import { calcularHhTecnico, calcularKpiExecucao, hhPorEquipamento } from './manutencao-dashboard';
import { HORAS_EXAME_MEDICO } from './manutencao-regras';

const DIAS_SEMANA_37 = [
  { data: '2026-09-07', label: 'SEG' },
  { data: '2026-09-08', label: 'TER' },
  { data: '2026-09-09', label: 'QUA' },
  { data: '2026-09-10', label: 'QUI' },
  { data: '2026-09-11', label: 'SEX' },
  { data: '2026-09-12', label: 'SAB' },
  { data: '2026-09-13', label: 'DOM' },
];

describe('calcularKpiExecucao', () => {
  it('retorna 0/0/0% quando não há ordens', () => {
    expect(calcularKpiExecucao([])).toEqual({ programadas: 0, executadas: 0, percentual: 0 });
  });

  it('calcula o percentual a partir da mistura de executadas/não executadas', () => {
    const ordens = [{ executada: true }, { executada: true }, { executada: false }, { executada: false }];
    expect(calcularKpiExecucao(ordens)).toEqual({ programadas: 4, executadas: 2, percentual: 50 });
  });

  it('100% quando todas foram executadas', () => {
    const ordens = [{ executada: true }, { executada: true }];
    expect(calcularKpiExecucao(ordens)).toEqual({ programadas: 2, executadas: 2, percentual: 100 });
  });
});

describe('hhPorEquipamento', () => {
  it('agrupa e soma duracaoHoras por equipamento', () => {
    const ordens = [
      { equipamento: 'STACKER 01', duracaoHoras: 4 },
      { equipamento: 'STACKER 01', duracaoHoras: 2 },
      { equipamento: 'STACKER 02', duracaoHoras: 3 },
    ];
    expect(hhPorEquipamento(ordens)).toEqual([
      { equipamento: 'STACKER 01', horas: 6 },
      { equipamento: 'STACKER 02', horas: 3 },
    ]);
  });

  it('ordena do maior consumo de HH pro menor', () => {
    const ordens = [{ equipamento: 'A', duracaoHoras: 1 }, { equipamento: 'B', duracaoHoras: 10 }];
    expect(hhPorEquipamento(ordens).map(h => h.equipamento)).toEqual(['B', 'A']);
  });

  it('ignora ordens sem equipamento preenchido', () => {
    const ordens = [{ equipamento: null, duracaoHoras: 5 }, { equipamento: '  ', duracaoHoras: 5 }, { equipamento: 'X', duracaoHoras: 1 }];
    expect(hhPorEquipamento(ordens)).toEqual([{ equipamento: 'X', horas: 1 }]);
  });

  it('trata duracaoHoras null como 0', () => {
    const ordens = [{ equipamento: 'X', duracaoHoras: null }];
    expect(hhPorEquipamento(ordens)).toEqual([{ equipamento: 'X', horas: 0 }]);
  });
});

describe('calcularHhTecnico', () => {
  it('técnico normal: bruto e líquido iguais, indisponível zero', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(r).toEqual({ bruto: 40, liquido: 40, indisponivel: 0 });
  });

  it('técnico de férias a semana toda: indisponível = bruto, líquido = 0', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      feriasIntervalo: { dataInicio: '2026-09-01', dataFim: '2026-09-30' },
    });
    expect(r).toEqual({ bruto: 40, liquido: 0, indisponivel: 40 });
  });

  it('técnico com 1 dia de exame médico: indisponível = HORAS_EXAME_MEDICO', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(['2026-09-09']), feriasIntervalo: null,
    });
    expect(r.indisponivel).toBe(HORAS_EXAME_MEDICO);
    expect(r.bruto).toBe(40);
    expect(r.liquido).toBe(40 - HORAS_EXAME_MEDICO);
  });

  it('fim de semana não conta nem pro bruto nem pro líquido', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(r.bruto).toBe(40); // 5 dias úteis x 8h, SAB/DOM fora mesmo tendo entrada no mapa
  });
});
