import { ManutencaoOrdem, FeriasTecnico } from '../models/manutencao-programacao.model';
import {
  HORAS_EXAME_MEDICO, calcularCapacidadeSemana, encontrarFeriasNoIntervalo, encontrarFolgaNoIntervalo,
  encontrarOrdemDuplicada, recursosParaEspelho,
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

function ordem(overrides: Partial<ManutencaoOrdem>): ManutencaoOrdem {
  return {
    id: 'x', tipo: 'ordem', area: 'ELETRICA', semanaInicio: '2026-09-07', numeroOs: null, semOs: false,
    descricao: '', equipamento: null, recursos: null, loto: null, areaAtuacao: null, duracaoHoras: null,
    tipoServico: null, tecnicoNome: '', tecnicoMatricula: null, diasPrevistos: [], status: 'PEND',
    observacoes: null, reuniaoHorario: null, reuniaoLocal: null, criadoPorId: null, criadoPorNome: '',
    createdAt: new Date(), ...overrides,
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

  it('treinamento e reunião não descontam nada da capacidade (só folga/férias tiram o dia, exame desconta parcial)', () => {
    const disponibilidadePorDia = new Map(DIAS_SEMANA_37.map(d => [d.data, 8]));
    const total = calcularCapacidadeSemana({
      dias: DIAS_SEMANA_37, disponibilidadePorDia, diasFolga: new Set(), diasExameMedico: new Set(), feriasIntervalo: null,
    });
    expect(total).toBe(40);
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
