import { calcularHhTecnico, calcularKpiExecucao, hhPorAtividade, hhPorEquipamento, ordemExecutadaAgrupada } from './manutencao-dashboard';
import { HORAS_EXAME_MEDICO } from './manutencao-regras';
import { ConsultaSigmaResultado, ManutencaoOrdem } from '../models/manutencao-programacao.model';

const DIAS_SEMANA_37 = [
  { data: '2026-09-07', label: 'SEG' },
  { data: '2026-09-08', label: 'TER' },
  { data: '2026-09-09', label: 'QUA' },
  { data: '2026-09-10', label: 'QUI' },
  { data: '2026-09-11', label: 'SEX' },
  { data: '2026-09-12', label: 'SAB' },
  { data: '2026-09-13', label: 'DOM' },
];

function ordem(overrides: Partial<ManutencaoOrdem> = {}): ManutencaoOrdem {
  return {
    id: 'o1', tipo: 'ordem', area: 'ELETRICA', categoriaIndicador: 'ELETRICA', semanaInicio: '2026-09-07',
    numeroOs: '45203', semOs: false, descricao: 'Reparar sirene', equipamento: null, equipamentosRelacionados: null,
    recursos: null, loto: null, areaAtuacao: null, duracaoHoras: 6.5, tipoServico: 'CORRETIVA',
    tecnicoNome: 'Antônio Nivaldo', tecnicoMatricula: '20006136', diasPrevistos: ['2026-09-08'], status: 'PEND',
    observacoes: null, reuniaoHorario: null, reuniaoLocal: null, planoPreventivoId: null, checklist: null,
    criadoPorId: null, criadoPorNome: '', createdAt: new Date('2026-09-01'),
    ...overrides,
  };
}

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

describe('hhPorAtividade', () => {
  it('agrupa e soma duracaoHoras por descrição (atividade)', () => {
    const ordens = [
      { descricao: 'Troca de rolamento', duracaoHoras: 4 },
      { descricao: 'Troca de rolamento', duracaoHoras: 2 },
      { descricao: 'Inspeção elétrica', duracaoHoras: 3 },
    ];
    expect(hhPorAtividade(ordens)).toEqual([
      { atividade: 'Troca de rolamento', horas: 6 },
      { atividade: 'Inspeção elétrica', horas: 3 },
    ]);
  });

  it('ordena do maior consumo de HH pro menor', () => {
    const ordens = [{ descricao: 'A', duracaoHoras: 1 }, { descricao: 'B', duracaoHoras: 10 }];
    expect(hhPorAtividade(ordens).map(h => h.atividade)).toEqual(['B', 'A']);
  });

  it('ignora ordens sem descrição preenchida', () => {
    const ordens = [{ descricao: null, duracaoHoras: 5 }, { descricao: '  ', duracaoHoras: 5 }, { descricao: 'X', duracaoHoras: 1 }];
    expect(hhPorAtividade(ordens)).toEqual([{ atividade: 'X', horas: 1 }]);
  });

  it('trata duracaoHoras null como 0', () => {
    const ordens = [{ descricao: 'X', duracaoHoras: null }];
    expect(hhPorAtividade(ordens)).toEqual([{ atividade: 'X', horas: 0 }]);
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

describe('ordemExecutadaAgrupada', () => {
  const matchPorMatricula = (matricula: string | null) =>
    matricula === '20006136' ? { matricula: '20006136' } : null;

  it('sem número de OS, nunca é executada', () => {
    const o = ordem({ numeroOs: null });
    expect(ordemExecutadaAgrupada([o], {}, matchPorMatricula)).toEqual([false]);
  });

  it('OS sem resultado do SIGMA, nunca é executada', () => {
    const o = ordem();
    expect(ordemExecutadaAgrupada([o], {}, matchPorMatricula)).toEqual([false]);
  });

  it('colaborador resolvido (individual): exige apontamento DAQUELA matrícula dentro da semana', () => {
    const executada = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136' }] },
    };
    expect(ordemExecutadaAgrupada([executada], sigmaPorOs, matchPorMatricula)).toEqual([true]);

    // Apontamento existe, mas é de outra matrícula — não conta pra esse técnico específico.
    const outraPessoa: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '11111111' }] },
    };
    expect(ordemExecutadaAgrupada([executada], outraPessoa, matchPorMatricula)).toEqual([false]);
  });

  it('apontamento fora da semana (mesmo com matrícula certa) não conta como executada', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-21', status: 'EXEC', executante: '20006136' }] }, // semana seguinte
    };
    expect(ordemExecutadaAgrupada([ordem()], sigmaPorOs, matchPorMatricula)).toEqual([false]);
  });

  it('apontamento em dia da semana diferente do diasPrevistos ainda conta (semana inteira, não o dia exato)', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      // diasPrevistos da ordem é '2026-09-08' (terça); apontamento caiu na sexta, mesma semana.
      '045203': { os: null, apontamentos: [{ data: '2026-09-11', status: 'EXEC', executante: '20006136' }] },
    };
    expect(ordemExecutadaAgrupada([ordem()], sigmaPorOs, matchPorMatricula)).toEqual([true]);
  });

  it('Apoio programado por empresa/equipe (colaborador nunca resolve): cai pra "qualquer apontamento na semana"', () => {
    // tecnicoNome = "SERVPLEX" não é ninguém em matriculas.json — matchColaborador sempre null aqui.
    const apoioOrdem = ordem({ area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', tecnicoNome: 'SERVPLEX', tecnicoMatricula: null });
    const semApontamento: Record<string, ConsultaSigmaResultado> = { '045203': { os: null, apontamentos: [] } };
    expect(ordemExecutadaAgrupada([apoioOrdem], semApontamento, matchPorMatricula)).toEqual([false]);

    const comApontamentoDeQualquerUm: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-10', status: 'EXEC', executante: '55555555' }] },
    };
    expect(ordemExecutadaAgrupada([apoioOrdem], comApontamentoDeQualquerUm, matchPorMatricula)).toEqual([true]);
  });

  it('agrupa por número de OS: só executada quando TODAS as linhas do grupo estão OK', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136' }] }, // só a matrícula da linha 1
    };
    const linha1 = ordem({ id: 'l1' });
    const linha2 = ordem({ id: 'l2', tecnicoMatricula: '77777777' }); // outra pessoa, sem apontamento dela
    expect(ordemExecutadaAgrupada([linha1, linha2], sigmaPorOs, matchPorMatricula)).toEqual([false]);
  });
});
