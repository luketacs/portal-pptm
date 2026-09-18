import { calcularHhTecnico, calcularKpiExecucao, hhPorAtividade, hhPorEquipamento, horasApontadasDoColaborador, ordemExecutadaAgrupada } from './manutencao-dashboard';
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
    const ordens = [{ status: 'executada' as const }, { status: 'executada' as const }, { status: 'nao-executada' as const }, { status: 'nao-executada' as const }];
    expect(calcularKpiExecucao(ordens)).toEqual({ programadas: 4, executadas: 2, percentual: 50 });
  });

  it('100% quando todas foram executadas', () => {
    const ordens = [{ status: 'executada' as const }, { status: 'executada' as const }];
    expect(calcularKpiExecucao(ordens)).toEqual({ programadas: 2, executadas: 2, percentual: 100 });
  });

  // Pedido do usuário: uma OS 'parcial' (2+ técnicos, só alguns apontaram) conta como
  // executada pro indicador — se pelo menos um já fez a parte dele, considera feito
  // (caso real: OS 047664, um técnico com EXEC, o outro ainda sem apontar).
  it('"parcial" conta como executada (pelo menos 1 técnico já apontou)', () => {
    const ordens = [{ status: 'executada' as const }, { status: 'parcial' as const }, { status: 'nao-executada' as const }];
    expect(calcularKpiExecucao(ordens)).toEqual({ programadas: 3, executadas: 2, percentual: 67 });
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
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), feriasIntervalo: null,
    });
    expect(r).toEqual({ bruto: 40, liquido: 40, indisponivel: 0 });
  });

  it('técnico de férias a semana toda: indisponível = bruto, líquido = 0', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(),
      feriasIntervalo: { dataInicio: '2026-09-01', dataFim: '2026-09-30' },
    });
    expect(r).toEqual({ bruto: 40, liquido: 0, indisponivel: 40 });
  });

  it('técnico de atestado médico a semana toda: indisponível = bruto, líquido = 0, igual férias', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), feriasIntervalo: null,
      atestadoIntervalo: { dataInicio: '2026-09-01', dataFim: '2026-09-30' },
    });
    expect(r).toEqual({ bruto: 40, liquido: 0, indisponivel: 40 });
  });

  it('técnico de folga 1 dia: indisponível = disponibilidade daquele dia', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(['2026-09-09']), feriasIntervalo: null,
    });
    expect(r).toEqual({ bruto: 40, liquido: 32, indisponivel: 8 });
  });

  // Pedido do usuário: exame médico e treinamento NÃO reduzem HH disponível (a
  // pessoa está "no expediente", só não em campo numa OS) — só folga e férias tiram
  // a pessoa do dia por completo. calcularHhTecnico nem aceita mais diasExameMedico
  // (removido do parâmetro) — calcularCapacidadeSemana em si continua descontando
  // exame/treinamento normalmente pra quem passa esses dados direto (a Programação,
  // onde o desconto é intencional).
  it('dia de exame médico não reduz mais HH disponível (diferente de calcularCapacidadeSemana puro)', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), feriasIntervalo: null,
    });
    expect(r).toEqual({ bruto: 40, liquido: 40, indisponivel: 0 });
  });

  it('fim de semana não conta nem pro bruto nem pro líquido', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const r = calcularHhTecnico({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), feriasIntervalo: null,
    });
    expect(r.bruto).toBe(40); // 5 dias úteis x 8h, SAB/DOM fora mesmo tendo entrada no mapa
  });
});

describe('ordemExecutadaAgrupada', () => {
  const matchPorMatricula = (matricula: string | null) =>
    matricula === '20006136' ? { matricula: '20006136' } : null;

  it('sem número de OS, nunca é executada', () => {
    const o = ordem({ numeroOs: null });
    expect(ordemExecutadaAgrupada([o], {}, matchPorMatricula)).toEqual(['nao-executada']);
  });

  it('OS sem resultado do SIGMA, nunca é executada', () => {
    const o = ordem();
    expect(ordemExecutadaAgrupada([o], {}, matchPorMatricula)).toEqual(['nao-executada']);
  });

  it('colaborador resolvido (individual): exige apontamento DAQUELA matrícula dentro da semana', () => {
    const executada = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 6.5 }] },
    };
    expect(ordemExecutadaAgrupada([executada], sigmaPorOs, matchPorMatricula)).toEqual(['executada']);

    // Apontamento existe, mas é de outra matrícula — não conta pra esse técnico específico.
    const outraPessoa: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '11111111', horas: 6.5 }] },
    };
    expect(ordemExecutadaAgrupada([executada], outraPessoa, matchPorMatricula)).toEqual(['nao-executada']);
  });

  it('apontamento fora da semana (mesmo com matrícula certa) não conta como executada', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-21', status: 'EXEC', executante: '20006136', horas: 6.5 }] }, // semana seguinte
    };
    expect(ordemExecutadaAgrupada([ordem()], sigmaPorOs, matchPorMatricula)).toEqual(['nao-executada']);
  });

  it('apontamento em dia da semana diferente do diasPrevistos ainda conta (semana inteira, não o dia exato)', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      // diasPrevistos da ordem é '2026-09-08' (terça); apontamento caiu na sexta, mesma semana.
      '045203': { os: null, apontamentos: [{ data: '2026-09-11', status: 'EXEC', executante: '20006136', horas: 6.5 }] },
    };
    expect(ordemExecutadaAgrupada([ordem()], sigmaPorOs, matchPorMatricula)).toEqual(['executada']);
  });

  it('Apoio programado por empresa/equipe (colaborador nunca resolve): cai pra "qualquer apontamento na semana"', () => {
    // tecnicoNome = "SERVPLEX" não é ninguém em matriculas.json — matchColaborador sempre null aqui.
    const apoioOrdem = ordem({ area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', tecnicoNome: 'SERVPLEX', tecnicoMatricula: null });
    const semApontamento: Record<string, ConsultaSigmaResultado> = { '045203': { os: null, apontamentos: [] } };
    expect(ordemExecutadaAgrupada([apoioOrdem], semApontamento, matchPorMatricula)).toEqual(['nao-executada']);

    const comApontamentoDeQualquerUm: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-10', status: 'EXEC', executante: '55555555', horas: 6.5 }] },
    };
    expect(ordemExecutadaAgrupada([apoioOrdem], comApontamentoDeQualquerUm, matchPorMatricula)).toEqual(['executada']);
  });

  it('agrupa por número de OS: só "executada" quando TODAS as linhas do grupo estão OK — com só 1 delas OK, é "parcial"', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 6.5 }] }, // só a matrícula da linha 1
    };
    const linha1 = ordem({ id: 'l1' });
    const linha2 = ordem({ id: 'l2', tecnicoMatricula: '77777777' }); // outra pessoa, sem apontamento dela
    expect(ordemExecutadaAgrupada([linha1, linha2], sigmaPorOs, matchPorMatricula)).toEqual(['parcial']);
  });

  // Reportado: dois técnicos numa mesma OS, um aponta na semana e o outro ainda não —
  // a linha do que apontou já vira "Executada" na Programação (statusExecucao(), que é
  // por linha), mas o indicador (agrupado por OS) ficava só true/false, sem sinalizar
  // esse "faltou só uma parte" (caso real: OS 45095, Rafael Bruno + Antônio José).
  it('agrupa por número de OS: "parcial" quando SÓ ALGUMAS linhas do grupo têm apontamento (nem todas, nem nenhuma)', () => {
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 6.5 }] }, // só a matrícula da linha 1
    };
    const matchDuasMatriculas = (matricula: string | null) =>
      matricula === '20006136' ? { matricula: '20006136' } : matricula === '77777777' ? { matricula: '77777777' } : null;
    const linha1 = ordem({ id: 'l1' });
    const linha2 = ordem({ id: 'l2', tecnicoMatricula: '77777777' }); // colaborador resolvido, mas sem apontamento dele
    expect(ordemExecutadaAgrupada([linha1, linha2], sigmaPorOs, matchDuasMatriculas)).toEqual(['parcial']);
  });
});

// Reportado: "horas apontadas" mostrava a duração PROGRAMADA da ordem inteira assim
// que ela virava "executada" (ex.: colaborador com 26h "apontadas" sem ter apontado
// nada perto disso) — essas cobrem a soma real, separada do status de execução acima.
describe('horasApontadasDoColaborador', () => {
  it('soma as horas REAIS do apontamento, não a duração programada da ordem', () => {
    const o = ordem({ duracaoHoras: 8 }); // programado 8h
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 2.5 }] }, // apontou só 2,5h
    };
    expect(horasApontadasDoColaborador([o], sigmaPorOs, '20006136')).toBe(2.5);
  });

  it('não conta apontamento de outra matrícula, mesmo que a OS tenha apontamento de alguém', () => {
    const o = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '11111111', horas: 6.5 }] },
    };
    expect(horasApontadasDoColaborador([o], sigmaPorOs, '20006136')).toBe(0);
  });

  it('não conta apontamento fora da semana da ordem', () => {
    const o = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-21', status: 'EXEC', executante: '20006136', horas: 6.5 }] }, // semana seguinte
    };
    expect(horasApontadasDoColaborador([o], sigmaPorOs, '20006136')).toBe(0);
  });

  it('soma múltiplos apontamentos da mesma pessoa na mesma OS/semana', () => {
    const o = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': {
        os: null,
        apontamentos: [
          { data: '2026-09-08', status: 'EXEC', executante: '20006136', horas: 4 },
          { data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 3.5 },
        ],
      },
    };
    expect(horasApontadasDoColaborador([o], sigmaPorOs, '20006136')).toBe(7.5);
  });

  it('agrupa por OS — não soma o apontamento 2x quando a mesma pessoa tem 2 linhas na mesma OS', () => {
    const linha1 = ordem({ id: 'l1' });
    const linha2 = ordem({ id: 'l2' }); // mesmo numeroOs, mesma pessoa (ex.: erro de cadastro duplicado)
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: 6.5 }] },
    };
    expect(horasApontadasDoColaborador([linha1, linha2], sigmaPorOs, '20006136')).toBe(6.5);
  });

  it('apontamento sem hora início/fim válida (horas=null) soma 0, não quebra', () => {
    const o = ordem();
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {
      '045203': { os: null, apontamentos: [{ data: '2026-09-09', status: 'EXEC', executante: '20006136', horas: null }] },
    };
    expect(horasApontadasDoColaborador([o], sigmaPorOs, '20006136')).toBe(0);
  });

  it('sem número de OS ou sem resultado do SIGMA, soma 0', () => {
    expect(horasApontadasDoColaborador([ordem({ numeroOs: null })], {}, '20006136')).toBe(0);
    expect(horasApontadasDoColaborador([ordem()], {}, '20006136')).toBe(0);
  });
});
