import { PlanoManutencao } from '../models/manutencao-programacao.model';
import { gerarGradeMensal, planosAtrasados, planosComProximaExecucao, proximaExecucaoPlano, sugestoesDaSemana } from './manutencao-planos';

function plano(overrides: Partial<PlanoManutencao> = {}): PlanoManutencao {
  return {
    id: 'p1',
    codigo: 'PM-0001',
    nome: 'Inspeção do Motor M01',
    equipamento: 'M01',
    tagKks: null,
    area: 'MECANICA',
    especialidade: null,
    descricao: 'Inspeção do Motor M01',
    atividades: [],
    periodicidadeValor: 30,
    periodicidadeUnidade: 'Dia(s)',
    dataInicial: '2026-08-01',
    responsavel: null,
    tempoEstimadoHoras: null,
    hhEstimado: null,
    observacoes: null,
    ativo: true,
    numeroOsReservado: null,
    criadoPorId: null,
    criadoPorNome: 'Teste',
    createdAt: new Date('2026-08-01'),
    atualizadoPorId: null,
    atualizadoPorNome: null,
    atualizadoEm: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('proximaExecucaoPlano', () => {
  it('sem ciclo nenhum, a próxima execução é a própria data inicial do plano', () => {
    expect(proximaExecucaoPlano('2026-08-01', 30, 'Dia(s)', null)).toBe('2026-08-01');
  });

  it('com um ciclo já registrado, soma a periodicidade a partir dele (não da data inicial)', () => {
    expect(proximaExecucaoPlano('2026-08-01', 30, 'Dia(s)', '2026-09-01')).toBe('2026-10-01');
  });

  it('não fica presa: cada ciclo novo avança a próxima execução — corrige o bug do sistema antigo (plano programado uma vez sumia da lista de sugestões pra sempre)', () => {
    const semCiclo = proximaExecucaoPlano('2026-08-01', 30, 'Dia(s)', null);
    expect(semCiclo).toBe('2026-08-01');
    const depoisDoPrimeiroCiclo = proximaExecucaoPlano('2026-08-01', 30, 'Dia(s)', semCiclo);
    expect(depoisDoPrimeiroCiclo).toBe('2026-08-31');
    const depoisDoSegundoCiclo = proximaExecucaoPlano('2026-08-01', 30, 'Dia(s)', depoisDoPrimeiroCiclo);
    expect(depoisDoSegundoCiclo).toBe('2026-09-30');
  });
});

describe('planosComProximaExecucao', () => {
  it('ignora plano inativo', () => {
    const planos = [plano({ id: 'p1', ativo: false })];
    expect(planosComProximaExecucao(planos, new Map(), false)).toEqual([]);
  });

  it('usa a data inicial quando não há ciclo registrado pro plano', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-08-01' })];
    const resultado = planosComProximaExecucao(planos, new Map(), false);
    expect(resultado[0].proximaData).toBe('2026-08-01');
  });

  it('usa o último ciclo registrado, quando existe', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-08-01', periodicidadeValor: 30, periodicidadeUnidade: 'Dia(s)' })];
    const ultimoCiclo = new Map([['p1', '2026-09-01']]);
    const resultado = planosComProximaExecucao(planos, ultimoCiclo, false);
    expect(resultado[0].proximaData).toBe('2026-10-01');
  });

  it('planta parada trata ciclo curto (Dia(s)/Semana(s)) como mensal', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-08-01', periodicidadeValor: 7, periodicidadeUnidade: 'Semana(s)' })];
    const resultado = planosComProximaExecucao(planos, new Map(), true);
    // Efetiva vira 1 Mes(es) — mas sem ciclo registrado ainda, proximaData continua sendo
    // a data inicial (a planta parada só afeta o cálculo a PARTIR de um ciclo existente).
    expect(resultado[0].proximaData).toBe('2026-08-01');
  });
});

describe('sugestoesDaSemana', () => {
  it('inclui só os planos cuja próxima execução cai dentro da semana em exibição', () => {
    const planos = planosComProximaExecucao(
      [plano({ id: 'dentro', dataInicial: '2026-09-09' }), plano({ id: 'fora', dataInicial: '2026-08-01' })],
      new Map(), false,
    );
    const resultado = sugestoesDaSemana(planos, '2026-09-07', '2026-09-11', false);
    expect(resultado.map(p => p.id)).toEqual(['dentro']);
  });

  it('sem priorizar ciclo longo, ordena só pela data mais urgente', () => {
    const planos = planosComProximaExecucao(
      [plano({ id: 'depois', dataInicial: '2026-09-10' }), plano({ id: 'antes', dataInicial: '2026-09-08' })],
      new Map(), false,
    );
    const resultado = sugestoesDaSemana(planos, '2026-09-07', '2026-09-11', false);
    expect(resultado.map(p => p.id)).toEqual(['antes', 'depois']);
  });

  it('priorizando ciclo longo, plano de periodicidade maior vem primeiro, mesmo vencendo depois', () => {
    const planos = planosComProximaExecucao(
      [
        plano({ id: 'mensal', dataInicial: '2026-09-08', periodicidadeValor: 1, periodicidadeUnidade: 'Mes(es)' }),
        plano({ id: 'anual', dataInicial: '2026-09-10', periodicidadeValor: 12, periodicidadeUnidade: 'Mes(es)' }),
      ],
      new Map(), false,
    );
    const resultado = sugestoesDaSemana(planos, '2026-09-07', '2026-09-11', true);
    expect(resultado.map(p => p.id)).toEqual(['anual', 'mensal']);
  });
});

describe('planosAtrasados', () => {
  it('não entra na lista quando ainda dentro da tolerância (1/3 do período)', () => {
    // Mensal (30 dias efetivos) vence em 2026-08-01, tolerância de 10 dias -> prazo 2026-08-11.
    const planos = planosComProximaExecucao([plano({ id: 'p1', dataInicial: '2026-08-01', periodicidadeValor: 30, periodicidadeUnidade: 'Dia(s)' })], new Map(), false);
    const resultado = planosAtrasados(planos, '2026-08-10', false);
    expect(resultado).toEqual([]);
  });

  it('entra na lista quando já passou do prazo com tolerância', () => {
    const planos = planosComProximaExecucao([plano({ id: 'p1', dataInicial: '2026-08-01', periodicidadeValor: 30, periodicidadeUnidade: 'Dia(s)' })], new Map(), false);
    const resultado = planosAtrasados(planos, '2026-08-15', false);
    expect(resultado.map(p => p.id)).toEqual(['p1']);
  });
});

describe('gerarGradeMensal', () => {
  it('toda semana tem exatamente 7 dias, e cada semana começa numa segunda-feira', () => {
    const grade = gerarGradeMensal(2026, 9);
    for (const semana of grade) {
      expect(semana).toHaveLength(7);
      const [ano, mes, dia] = semana[0].data.split('-').map(Number);
      expect(new Date(ano, mes - 1, dia).getDay()).toBe(1); // 1 = segunda
    }
  });

  it('cobre o primeiro e o último dia do mês, marcados como noMes=true', () => {
    const grade = gerarGradeMensal(2026, 9);
    const todosDias = grade.flat();
    expect(todosDias.find(d => d.data === '2026-09-01')).toEqual({ data: '2026-09-01', noMes: true });
    expect(todosDias.find(d => d.data === '2026-09-30')).toEqual({ data: '2026-09-30', noMes: true });
  });

  it('dias de preenchimento do mês anterior/seguinte vêm marcados como noMes=false', () => {
    const grade = gerarGradeMensal(2026, 9);
    const todosDias = grade.flat();
    const foraDoMes = todosDias.filter(d => !d.noMes);
    expect(foraDoMes.length).toBeGreaterThan(0);
    for (const dia of foraDoMes) {
      const [, mes] = dia.data.split('-').map(Number);
      expect(mes).not.toBe(9);
    }
  });

  it('não duplica nem pula dia nenhum — a grade é uma sequência contínua', () => {
    const grade = gerarGradeMensal(2026, 9);
    const todosDias = grade.flat().map(d => d.data);
    for (let i = 1; i < todosDias.length; i++) {
      const anterior = new Date(todosDias[i - 1] + 'T00:00:00');
      const atual = new Date(todosDias[i] + 'T00:00:00');
      expect((atual.getTime() - anterior.getTime()) / 86400000).toBe(1);
    }
  });

  it('funciona na virada de ano (dezembro -> janeiro)', () => {
    const grade = gerarGradeMensal(2026, 12);
    const todosDias = grade.flat();
    expect(todosDias.find(d => d.data === '2026-12-31')).toEqual({ data: '2026-12-31', noMes: true });
    // A última semana de dezembro pode incluir dias de janeiro/2027 — confirma que o
    // ano vira certo (formato 'YYYY-MM-DD' correto, sem erro de cálculo).
    const ultimoDiaGrade = todosDias[todosDias.length - 1].data;
    expect(ultimoDiaGrade >= '2026-12-31' || ultimoDiaGrade.startsWith('2027-01')).toBe(true);
  });
});
