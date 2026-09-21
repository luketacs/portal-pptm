import { ManutencaoOrdem, FeriasTecnico, AtestadoTecnico, EquipeApoioItem } from '../models/manutencao-programacao.model';
import { Colaborador } from '../services/apontamentos.service';
import {
  HORAS_EXAME_MEDICO, HORAS_TREINAMENTO_DIA_TODO, HORAS_TREINAMENTO_MEIO_PERIODO,
  bloqueioDoTecnico, calcularCapacidadeSemana, diasDaSemana, encontrarAtestadoNoIntervalo, encontrarFeriasNoIntervalo,
  encontrarFolgaNoIntervalo, encontrarOrdemDuplicada, ordemDuplicada, paraIso, podeEditarSemanaFechada, recursosParaEspelho,
  tecnicosPorArea, todosTecnicos,
} from './manutencao-regras';

const DIAS_SEMANA_37 = [
  { data: '2026-09-07', label: 'SEG' },
  { data: '2026-09-08', label: 'TER' },
  { data: '2026-09-09', label: 'QUA' },
  { data: '2026-09-10', label: 'QUI' },
  { data: '2026-09-11', label: 'SEX' },
  { data: '2026-09-12', label: 'SAB' },
  { data: '2026-09-13', label: 'DOM' },
];

function colaborador(overrides: Partial<Colaborador>): Colaborador {
  return {
    nome: 'Técnico', matricula: '000001', area: 'ELETRICA', email: '', nomeNorm: 'TECNICO', disponibilidade: 8, ...overrides,
  };
}

function ordem(overrides: Partial<ManutencaoOrdem>): ManutencaoOrdem {
  return {
    id: 'x', tipo: 'ordem', area: 'ELETRICA', categoriaIndicador: null, semanaInicio: '2026-09-07', numeroOs: null, semOs: false,
    descricao: '', equipamento: null, equipamentosRelacionados: null, recursos: null, loto: null, areaAtuacao: null, duracaoHoras: null,
    tipoServico: null, tecnicoNome: '', tecnicoMatricula: null, diasPrevistos: [], status: 'PEND',
    observacoes: null, reuniaoHorario: null, reuniaoLocal: null, planoPreventivoId: null, checklist: null,
    criadoPorId: null, criadoPorNome: '', createdAt: new Date(), ...overrides,
  };
}

describe('calcularCapacidadeSemana', () => {
  it('soma só os dias úteis, ignorando sábado/domingo mesmo se tiverem disponibilidade cadastrada', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(40); // 5 dias úteis x 8h, SAB/DOM fora
  });

  it('tira o dia inteiro quando o técnico está de folga/feriado nele', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(['2026-09-07']), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(32); // segunda (feriado) sai inteira
  });

  it('exame médico desconta só HORAS_EXAME_MEDICO daquele dia, não o dia inteiro', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(['2026-09-09']), feriasIntervalo: null,
    });
    expect(total).toBe(40 - HORAS_EXAME_MEDICO);
  });

  it('não deixa a disponibilidade do dia do exame ficar negativa', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 2]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(['2026-09-09']), feriasIntervalo: null,
    });
    // 4 dias úteis normais (2h cada) + segunda com exame afundando em 0, não em -1.5
    expect(total).toBe(4 * 2 + 0);
  });

  it('tira o dia inteiro quando cai dentro do período de férias', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      feriasIntervalo: { dataInicio: '2026-09-01', dataFim: '2026-09-08' },
    });
    expect(total).toBe(24); // SEG e TER saem por férias, sobra QUA/QUI/SEX
  });

  it('tira o dia inteiro quando cai dentro do período de atestado médico, igual férias', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      feriasIntervalo: null, atestadoIntervalo: { dataInicio: '2026-09-01', dataFim: '2026-09-08' },
    });
    expect(total).toBe(24); // SEG e TER saem por atestado, sobra QUA/QUI/SEX
  });

  it('sem atestadoIntervalo (não informado), não desconta nada por atestado', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(40);
  });

  it('reproduz o caso do Carlos Jr: feriado na segunda, férias até terça, 13h/dia quarta a sexta', () => {
    // Cenário relatado pelo usuário: segunda é feriado, terça ainda de férias, quarta e
    // quinta com 13h disponíveis, sexta de BH (0h). Resultado esperado: 26h (13+13+0),
    // não os 19,5h que apareciam antes da correção de férias na capacidade.
    const disponibilidadePorDia = new Map<string, number>([
      ['2026-09-07', 13], ['2026-09-08', 13], ['2026-09-09', 13], ['2026-09-10', 13], ['2026-09-11', 0],
    ]);
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia,
      diasFolga: new Set(['2026-09-07']),
      diasExameMedico: new Set(),
      feriasIntervalo: { dataInicio: '2026-08-31', dataFim: '2026-09-08' },
    });
    expect(total).toBe(26);
  });

  it('reunião não desconta nada da capacidade (não bloqueia o resto da agenda do dia)', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(40);
  });

  it('sem horasTreinamentoPorDia (não informado), treinamento não desconta nada', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(40);
  });

  it('reproduz o caso do Moacir: 3 dias de treinamento em dia todo (6,5h), 19,5h descontadas', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 6.5]));
    const horasTreinamentoPorDia = new Map([
      ['2026-09-07', HORAS_TREINAMENTO_DIA_TODO],
      ['2026-09-08', HORAS_TREINAMENTO_DIA_TODO],
      ['2026-09-09', HORAS_TREINAMENTO_DIA_TODO],
    ]);
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      horasTreinamentoPorDia, feriasIntervalo: null,
    });
    // SEG/TER/QUA saem inteiras (6,5h de treinamento = toda a disponibilidade do dia),
    // sobra só QUI/SEX normais: 2 x 6,5 = 13.
    expect(total).toBe(13);
  });

  it('treinamento de meio período (3,5h) desconta só parte do dia', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      horasTreinamentoPorDia: new Map([['2026-09-09', HORAS_TREINAMENTO_MEIO_PERIODO]]),
      feriasIntervalo: null,
    });
    expect(total).toBe(40 - HORAS_TREINAMENTO_MEIO_PERIODO);
  });

  it('não deixa a disponibilidade do dia do treinamento ficar negativa', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 2]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(),
      horasTreinamentoPorDia: new Map([['2026-09-09', HORAS_TREINAMENTO_DIA_TODO]]),
      feriasIntervalo: null,
    });
    // 4 dias úteis normais (2h cada) + quarta com treinamento afundando em 0, não em -4.5
    expect(total).toBe(4 * 2 + 0);
  });
});

describe('encontrarFeriasNoIntervalo', () => {
  const ferias: FeriasTecnico[] = [
    { id: 'f1', tecnicoNome: 'Carlos Jr', tecnicoMatricula: null, area: 'ELETRICA', dataInicio: '2026-08-31', dataFim: '2026-09-08' },
  ];

  it('encontra férias que tocam algum dos dias informados', () => {
    expect(encontrarFeriasNoIntervalo(ferias, 'Carlos Jr', ['2026-09-08', '2026-09-09']))
      .toEqual(ferias[0]);
  });

  it('retorna null quando não há sobreposição', () => {
    expect(encontrarFeriasNoIntervalo(ferias, 'Carlos Jr', ['2026-09-09', '2026-09-10'])).toBeNull();
  });

  it('retorna null pra outro técnico sem férias cadastradas', () => {
    expect(encontrarFeriasNoIntervalo(ferias, 'Outro Técnico', ['2026-09-01'])).toBeNull();
  });
});

describe('encontrarAtestadoNoIntervalo', () => {
  const atestados: AtestadoTecnico[] = [
    { id: 'a1', tecnicoNome: 'Carlos Jr', tecnicoMatricula: null, area: 'ELETRICA', dataInicio: '2026-08-31', dataFim: '2026-09-08' },
  ];

  it('encontra atestado que toca algum dos dias informados', () => {
    expect(encontrarAtestadoNoIntervalo(atestados, 'Carlos Jr', ['2026-09-08', '2026-09-09']))
      .toEqual(atestados[0]);
  });

  it('retorna null quando não há sobreposição', () => {
    expect(encontrarAtestadoNoIntervalo(atestados, 'Carlos Jr', ['2026-09-09', '2026-09-10'])).toBeNull();
  });

  it('retorna null pra outro técnico sem atestado cadastrado', () => {
    expect(encontrarAtestadoNoIntervalo(atestados, 'Outro Técnico', ['2026-09-01'])).toBeNull();
  });
});

describe('encontrarFolgaNoIntervalo', () => {
  it('bloqueia quando já existe folga lançada pro técnico em algum dos dias', () => {
    const folga = ordem({ id: 'folga-1', tipo: 'folga', tecnicoNome: 'Leandro Rodrigues', diasPrevistos: ['2026-09-08'] });
    const resultado = encontrarFolgaNoIntervalo([folga], 'Leandro Rodrigues', ['2026-09-08', '2026-09-09']);
    expect(resultado).toEqual(folga);
  });

  it('não bloqueia lançamento de outro tipo (a checagem é sempre contra folga existente)', () => {
    const reuniao = ordem({ id: 'r1', tipo: 'reuniao', tecnicoNome: 'Leandro Rodrigues', diasPrevistos: ['2026-09-08'] });
    expect(encontrarFolgaNoIntervalo([reuniao], 'Leandro Rodrigues', ['2026-09-08'])).toBeNull();
  });

  it('ignora a própria folga quando idExcluir bate (evita ela se auto-bloquear ao ser editada)', () => {
    const folga = ordem({ id: 'folga-1', tipo: 'folga', tecnicoNome: 'Leandro Rodrigues', diasPrevistos: ['2026-09-08'] });
    expect(encontrarFolgaNoIntervalo([folga], 'Leandro Rodrigues', ['2026-09-08'], 'folga-1')).toBeNull();
  });
});

describe('encontrarOrdemDuplicada', () => {
  const normalizar = (v: string) => v.padStart(6, '0');

  it('encontra a mesma OS já lançada pro mesmo técnico em algum dos dias, mesmo com número digitado diferente ("45203" vs "045203")', () => {
    const existente = ordem({ id: 'os-1', tipo: 'ordem', tecnicoNome: 'William', numeroOs: '045203', diasPrevistos: ['2026-09-08'] });
    const resultado = encontrarOrdemDuplicada([existente], normalizar('45203'), 'William', ['2026-09-08'], normalizar);
    expect(resultado).toEqual(existente);
  });

  it('não considera duplicata pra outro técnico', () => {
    const existente = ordem({ id: 'os-1', tipo: 'ordem', tecnicoNome: 'William', numeroOs: '045203', diasPrevistos: ['2026-09-08'] });
    expect(encontrarOrdemDuplicada([existente], normalizar('45203'), 'Outro Técnico', ['2026-09-08'], normalizar)).toBeNull();
  });
});

describe('recursosParaEspelho', () => {
  it('espelho pra técnico: exclui a si mesmo pelo nome exato e inclui o mandante (bug real: William aparecia como recurso de si mesmo)', () => {
    const texto = recursosParaEspelho(
      ['Willians Oliveira', 'William'],
      r => r.toUpperCase() === 'WILLIAM',
      'José Neri',
    );
    expect(texto).toBe('Willians Oliveira, José Neri');
  });

  it('espelho pra empresa: exclui qualquer opção que mapeie pra essa empresa, não só o texto literal (bug real: Júlio Fontebras vinha como recurso de si mesmo)', () => {
    const mapaEmpresa: Record<string, string> = {
      'MUNCK - DB GUINDASTES': 'DB GUINDASTES',
      'GUINDASTE - DB GUINDASTES': 'DB GUINDASTES',
      'JÚLIO (FONTEBRAS)': 'JÚLIO (FONTEBRAS)',
    };
    const texto = recursosParaEspelho(
      ['MUNCK - DB GUINDASTES', 'GUINDASTE - DB GUINDASTES', 'Outro Técnico'],
      r => mapaEmpresa[r.toUpperCase()] === 'DB GUINDASTES',
      'Técnico Mandante',
    );
    expect(texto).toBe('Outro Técnico, Técnico Mandante');
  });

  it('Fontebras espelhando pra si mesmo: o mandante entra, o próprio recurso Fontebras some da lista', () => {
    const mapaEmpresa: Record<string, string> = { 'JÚLIO (FONTEBRAS)': 'JÚLIO (FONTEBRAS)' };
    const texto = recursosParaEspelho(
      ['JÚLIO (FONTEBRAS)'],
      r => mapaEmpresa[r.toUpperCase()] === 'JÚLIO (FONTEBRAS)',
      'Técnico Mandante',
    );
    expect(texto).toBe('Técnico Mandante');
  });
});

describe('podeEditarSemanaFechada', () => {
  it('libera edição quando a semana não está fechada, pra qualquer papel', () => {
    expect(podeEditarSemanaFechada(false, false)).toBe(true);
    expect(podeEditarSemanaFechada(false, true)).toBe(true);
  });

  it('bloqueia edição quando a semana está fechada e o usuário não é Admin', () => {
    expect(podeEditarSemanaFechada(true, false)).toBe(false);
  });

  it('Admin continua editando mesmo com a semana fechada', () => {
    expect(podeEditarSemanaFechada(true, true)).toBe(true);
  });
});

describe('diasDaSemana', () => {
  it('gera os 7 dias SEG-DOM a partir da segunda-feira, com o rótulo certo em cada um', () => {
    expect(diasDaSemana('2026-09-07')).toEqual(DIAS_SEMANA_37);
  });

  it('vira o mês corretamente quando a semana cruza a virada (ex.: segunda em 29/06)', () => {
    const dias = diasDaSemana('2026-06-29');
    expect(dias.map(d => d.data)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
  });
});

describe('paraIso', () => {
  it('formata uma Date como YYYY-MM-DD com zero à esquerda', () => {
    expect(paraIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('bloqueioDoTecnico', () => {
  const ferias: FeriasTecnico[] = [
    { id: 'f1', tecnicoNome: 'Carlos Jr', tecnicoMatricula: null, area: 'ELETRICA', dataInicio: '2026-08-31', dataFim: '2026-09-08' },
  ];
  const atestados: AtestadoTecnico[] = [
    { id: 'a1', tecnicoNome: 'Leandro Rodrigues', tecnicoMatricula: null, area: 'ELETRICA', dataInicio: '2026-09-07', dataFim: '2026-09-09' },
  ];

  it('férias tem precedência sobre atestado e folga, com a mensagem certa', () => {
    const folga = ordem({ id: 'folga-1', tipo: 'folga', tecnicoNome: 'Carlos Jr', diasPrevistos: ['2026-09-08'] });
    const resultado = bloqueioDoTecnico(ferias, atestados, [folga], 'Carlos Jr', ['2026-09-08']);
    expect(resultado).toEqual({ tipo: 'ferias', motivo: 'Carlos Jr está de férias de 31/08/2026 a 08/09/2026.' });
  });

  it('sem férias, cai pro atestado', () => {
    const resultado = bloqueioDoTecnico(ferias, atestados, [], 'Leandro Rodrigues', ['2026-09-08']);
    expect(resultado).toEqual({ tipo: 'atestado', motivo: 'Leandro Rodrigues está de atestado médico de 07/09/2026 a 09/09/2026.' });
  });

  it('sem férias nem atestado, cai pra folga já lançada', () => {
    const folga = ordem({ id: 'folga-1', tipo: 'folga', tecnicoNome: 'William', diasPrevistos: ['2026-09-08'] });
    const resultado = bloqueioDoTecnico([], [], [folga], 'William', ['2026-09-08']);
    expect(resultado).toEqual({ tipo: 'folga', motivo: 'William já está de folga em algum desses dias.' });
  });

  it('sem nenhum dos três, retorna null', () => {
    expect(bloqueioDoTecnico([], [], [], 'William', ['2026-09-08'])).toBeNull();
  });

  it('idExcluir evita a própria folga se auto-bloquear (ex.: editando ela mesma)', () => {
    const folga = ordem({ id: 'folga-1', tipo: 'folga', tecnicoNome: 'William', diasPrevistos: ['2026-09-08'] });
    expect(bloqueioDoTecnico([], [], [folga], 'William', ['2026-09-08'], 'folga-1')).toBeNull();
  });
});

describe('ordemDuplicada', () => {
  it('encontra a mesma OS já lançada pro mesmo técnico, mesmo com número digitado diferente', () => {
    const existente = ordem({ id: 'os-1', tipo: 'ordem', tecnicoNome: 'William', numeroOs: '045203', diasPrevistos: ['2026-09-08'] });
    expect(ordemDuplicada([existente], '45203', 'William', ['2026-09-08'])).toEqual(existente);
  });

  it('número vazio nunca é duplicata (evita bloquear lançamento sem OS)', () => {
    const existente = ordem({ id: 'os-1', tipo: 'ordem', tecnicoNome: 'William', numeroOs: '045203', diasPrevistos: ['2026-09-08'] });
    expect(ordemDuplicada([existente], '', 'William', ['2026-09-08'])).toBeNull();
  });

  it('idExcluir evita a própria OS se auto-bloquear ao ser editada', () => {
    const existente = ordem({ id: 'os-1', tipo: 'ordem', tecnicoNome: 'William', numeroOs: '045203', diasPrevistos: ['2026-09-08'] });
    expect(ordemDuplicada([existente], '45203', 'William', ['2026-09-08'], 'os-1')).toBeNull();
  });
});

describe('tecnicosPorArea', () => {
  const equipesApoio: EquipeApoioItem[] = [{ id: 'e1', nome: 'SERVPLEX' }];
  const colaboradores: Colaborador[] = [
    colaborador({ nome: 'Carlos Jr', matricula: '000001', area: 'ELÉTRICA' }),
    colaborador({ nome: 'Leandro Rodrigues', matricula: '000002', area: 'MECÂNICA' }),
  ];

  it('Apoio retorna as equipes cadastradas, sem matrícula', () => {
    expect(tecnicosPorArea('APOIO', colaboradores, equipesApoio, '2026-09-07'))
      .toEqual([{ nome: 'SERVPLEX', matricula: null }]);
  });

  it('Elétrica filtra pelo texto da área (tolerando acento) e ordena por nome', () => {
    expect(tecnicosPorArea('ELETRICA', colaboradores, equipesApoio, '2026-09-07'))
      .toEqual([{ nome: 'Carlos Jr', matricula: '000001' }]);
  });

  it('técnico com corte de inatividade some das semanas a partir do corte, mas continua aparecendo antes dele', () => {
    const comInativo = [...colaboradores, colaborador({ nome: 'Alexandre Gomes', matricula: '000003', area: 'MECÂNICA' })];
    expect(tecnicosPorArea('MECANICA', comInativo, equipesApoio, '2026-09-01').map(t => t.nome))
      .toEqual(['Alexandre Gomes', 'Leandro Rodrigues']);
    expect(tecnicosPorArea('MECANICA', comInativo, equipesApoio, '2026-09-14').map(t => t.nome))
      .toEqual(['Leandro Rodrigues']);
  });
});

describe('todosTecnicos', () => {
  it('junta Elétrica e Mecânica, cada um com sua área marcada, e deixa Apoio de fora', () => {
    const equipesApoio: EquipeApoioItem[] = [{ id: 'e1', nome: 'SERVPLEX' }];
    const colaboradores: Colaborador[] = [
      colaborador({ nome: 'Carlos Jr', matricula: '000001', area: 'ELÉTRICA' }),
      colaborador({ nome: 'Leandro Rodrigues', matricula: '000002', area: 'MECÂNICA' }),
    ];
    expect(todosTecnicos(colaboradores, equipesApoio, '2026-09-07')).toEqual([
      { nome: 'Carlos Jr', matricula: '000001', area: 'ELETRICA' },
      { nome: 'Leandro Rodrigues', matricula: '000002', area: 'MECANICA' },
    ]);
  });
});
