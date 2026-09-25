import { PlanoManutencao } from '../models/manutencao-programacao.model';
import {
  agendaDosPlanos, alinharDatasPorEquipamento, EQUIPE_APOIO_NAO_CLASSIFICADA, gerarGradeMensal, inferirCategoriaIndicador,
  inferirCategoriaIndicadorPorTecnico, janelaAlinhamentoDaArea, limitarPorEquipeApoio, nomeBaseDoPlano, ocorrenciasNoIntervalo,
  semanasIsoDoAno, siglaPeriodicidade, planosAtrasados, planosComProximaExecucao,
  planosComProximaExecucaoFixa, proximaExecucaoPlano, resumoPorEquipeApoio, sugestoesDaSemana,
} from './manutencao-planos';

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
    lotoPadrao: null,
    equipamentosRelacionados: null,
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

describe('planosComProximaExecucaoFixa', () => {
  it('ignora plano inativo', () => {
    const planos = [plano({ id: 'p1', ativo: false })];
    expect(planosComProximaExecucaoFixa(planos, false, '2026-09-16')).toEqual([]);
  });

  it('próxima execução vem da âncora (data inicial), nunca de execução real — diferente de planosComProximaExecucao', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-01-15', periodicidadeValor: 1, periodicidadeUnidade: 'Mes(es)' })];
    const resultado = planosComProximaExecucaoFixa(planos, false, '2026-09-16');
    expect(resultado[0].proximaData).toBe('2026-10-15');
  });

  it('planta parada força ciclo curto pra mensal, igual planosComProximaExecucao', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-09-01', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' })];
    const resultado = planosComProximaExecucaoFixa(planos, true, '2026-09-16');
    // Efetiva vira 1 Mes(es) a partir de 2026-09-01 -> próxima ocorrência é 2026-10-01.
    expect(resultado[0].proximaData).toBe('2026-10-01');
  });

  it('sem ultimoCicloPorPlano (padrão), comportamento não muda', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-09-14', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' })];
    expect(planosComProximaExecucaoFixa(planos, false, '2026-09-17')[0].proximaData).toBe('2026-09-21');
  });

  it('plano já com ciclo registrado pra ocorrência atual some da semana — corrige o bug reportado (programar não tirava o plano da lista)', () => {
    const planos = [plano({ id: 'p1', dataInicial: '2026-09-14', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' })];
    const ultimoCiclo = new Map([['p1', '2026-09-21']]);
    const resultado = planosComProximaExecucaoFixa(planos, false, '2026-09-17', ultimoCiclo);
    expect(resultado[0].proximaData).toBe('2026-09-28');
  });

  it('ciclo registrado de outro plano não afeta os demais (lookup é por id)', () => {
    const planos = [
      plano({ id: 'p1', dataInicial: '2026-09-14', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' }),
      plano({ id: 'p2', dataInicial: '2026-09-14', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' }),
    ];
    const ultimoCiclo = new Map([['p1', '2026-09-21']]);
    const resultado = planosComProximaExecucaoFixa(planos, false, '2026-09-17', ultimoCiclo);
    expect(resultado.find(p => p.id === 'p1')!.proximaData).toBe('2026-09-28');
    expect(resultado.find(p => p.id === 'p2')!.proximaData).toBe('2026-09-21');
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

function comProxima(overrides: Partial<PlanoManutencao> = {}, proximaData: string) {
  return { ...plano(overrides), proximaData };
}

describe('alinharDatasPorEquipamento', () => {
  it('não alinha quando as próximas datas estão a mais de 21 dias uma da outra', () => {
    const a = comProxima({ id: 'a', tagKks: 'M01' }, '2026-08-15');
    const b = comProxima({ id: 'b', tagKks: 'M01' }, '2026-09-10');
    const resultado = alinharDatasPorEquipamento([a, b]);
    expect(resultado.find(p => p.id === 'a')).toEqual({ ...a, proximaDataOriginal: null });
    expect(resultado.find(p => p.id === 'b')).toEqual({ ...b, proximaDataOriginal: null });
  });

  it('alinha pra data mais cedo quando 2 planos do mesmo KKS caem no mesmo mês (mensal + trimestral)', () => {
    const mensal = comProxima({ id: 'mensal', tagKks: 'M01', periodicidadeValor: 1, periodicidadeUnidade: 'Mes(es)' }, '2026-09-05');
    const trimestral = comProxima({ id: 'trimestral', tagKks: 'M01', periodicidadeValor: 3, periodicidadeUnidade: 'Mes(es)' }, '2026-09-25');
    const resultado = alinharDatasPorEquipamento([mensal, trimestral]);
    const mensalAlinhado = resultado.find(p => p.id === 'mensal')!;
    const trimestralAlinhado = resultado.find(p => p.id === 'trimestral')!;
    expect(mensalAlinhado.proximaData).toBe('2026-09-05');
    expect(mensalAlinhado.proximaDataOriginal).toBe(null);
    expect(trimestralAlinhado.proximaData).toBe('2026-09-05');
    expect(trimestralAlinhado.proximaDataOriginal).toBe('2026-09-25');
  });

  it('3+ planos do mesmo KKS dentro da janela alinham todos pra data mais cedo entre eles', () => {
    const planos = [
      comProxima({ id: 'p1', tagKks: 'M01' }, '2026-09-12'),
      comProxima({ id: 'p2', tagKks: 'M01' }, '2026-09-03'),
      comProxima({ id: 'p3', tagKks: 'M01' }, '2026-09-24'),
    ];
    const resultado = alinharDatasPorEquipamento(planos);
    expect(resultado.map(p => p.proximaData)).toEqual(['2026-09-03', '2026-09-03', '2026-09-03']);
  });

  it('plano fora da janela do bloco abre um bloco novo com os seguintes', () => {
    const planos = [
      comProxima({ id: 'p1', tagKks: 'M01' }, '2026-09-03'),
      comProxima({ id: 'p2', tagKks: 'M01' }, '2026-09-28'),
      comProxima({ id: 'p3', tagKks: 'M01' }, '2026-10-10'),
    ];
    const resultado = alinharDatasPorEquipamento(planos);
    expect(resultado.map(p => p.proximaData)).toEqual(['2026-09-03', '2026-09-28', '2026-09-28']);
  });

  // Reportado: Prédio 25 (grupo vizinho) saía em semanas seguidas porque a virada do
  // mês partia o grupo no meio.
  it('grupo vizinho com datas atravessando a virada do mês sai todo junto', () => {
    const planos = [
      comProxima({ id: 'a', area: 'APOIO', tagKks: '90SAA05AH616' }, '2026-09-21'),
      comProxima({ id: 'b', area: 'APOIO', tagKks: '90SAA05AH617' }, '2026-09-28'),
      comProxima({ id: 'c', area: 'APOIO', tagKks: '90SAA05AH618' }, '2026-10-05'),
      comProxima({ id: 'd', area: 'APOIO', tagKks: '90SAA05AH619' }, '2026-10-12'),
    ];
    const resultado = alinharDatasPorEquipamento(planos);
    expect(resultado.map(p => p.proximaData)).toEqual(['2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21']);
  });

  it('não mistura mesmo KKS em áreas diferentes', () => {
    const mecanica = comProxima({ id: 'mec', area: 'MECANICA', tagKks: 'M01' }, '2026-09-03');
    const eletrica = comProxima({ id: 'ele', area: 'ELETRICA', tagKks: 'M01' }, '2026-09-20');
    const resultado = alinharDatasPorEquipamento([mecanica, eletrica]);
    expect(resultado.find(p => p.id === 'mec')!.proximaDataOriginal).toBe(null);
    expect(resultado.find(p => p.id === 'ele')!.proximaDataOriginal).toBe(null);
  });

  it('não mistura planos de KKS diferentes, mesmo mês, mesma área', () => {
    const m01 = comProxima({ id: 'm01', tagKks: 'M01' }, '2026-09-03');
    const m02 = comProxima({ id: 'm02', tagKks: 'M02' }, '2026-09-20');
    const resultado = alinharDatasPorEquipamento([m01, m02]);
    expect(resultado.find(p => p.id === 'm01')!.proximaDataOriginal).toBe(null);
    expect(resultado.find(p => p.id === 'm02')!.proximaDataOriginal).toBe(null);
  });

  it('não altera quando só existe 1 plano ativo pra aquele KKS', () => {
    const unico = comProxima({ id: 'unico', tagKks: 'M01' }, '2026-09-10');
    const resultado = alinharDatasPorEquipamento([unico]);
    expect(resultado[0]).toEqual({ ...unico, proximaDataOriginal: null });
  });

  it('vira o ano corretamente: fim de dezembro alinha com começo de janeiro', () => {
    const dezembro = comProxima({ id: 'dez', tagKks: 'M01' }, '2026-12-29');
    const janeiro = comProxima({ id: 'jan', tagKks: 'M01' }, '2027-01-02');
    const resultado = alinharDatasPorEquipamento([dezembro, janeiro]);
    expect(resultado.find(p => p.id === 'dez')!.proximaDataOriginal).toBe(null);
    expect(resultado.find(p => p.id === 'jan')!.proximaData).toBe('2026-12-29');
  });

  it('ignora espaço extra no KKS (trim) na hora de casar', () => {
    const comEspaco = comProxima({ id: 'a', tagKks: ' M01 ' }, '2026-09-20');
    const semEspaco = comProxima({ id: 'b', tagKks: 'M01' }, '2026-09-05');
    const resultado = alinharDatasPorEquipamento([comEspaco, semEspaco]);
    expect(resultado.find(p => p.id === 'a')!.proximaData).toBe('2026-09-05');
    expect(resultado.find(p => p.id === 'b')!.proximaData).toBe('2026-09-05');
  });

  // Pedido do usuário: salas/equipamentos fisicamente vizinhos (Apoio, SERVPLEX/BMS)
  // devem sair sempre juntos, mesmo sendo KKS diferentes — "aproveitar a viagem" (ver
  // GRUPOS_EQUIPAMENTO_VIZINHO). Usa 2 KKS reais de um grupo confirmado (Prédio 25).
  it('KKS de salas vizinhas confirmadas (GRUPOS_EQUIPAMENTO_VIZINHO) alinham entre si mesmo sendo KKS diferentes', () => {
    const a = comProxima({ id: 'a', area: 'APOIO', tagKks: '90SAA05AH616' }, '2026-09-20');
    const b = comProxima({ id: 'b', area: 'APOIO', tagKks: '90SAA05AH617' }, '2026-09-05');
    const resultado = alinharDatasPorEquipamento([a, b]);
    expect(resultado.find(p => p.id === 'a')!.proximaData).toBe('2026-09-05');
    expect(resultado.find(p => p.id === 'b')!.proximaData).toBe('2026-09-05');
  });

  it('janela menor (Mecânica/Elétrica, 6 dias) não puxa plano de outra semana', () => {
    const a = comProxima({ id: 'a', tagKks: 'M01' }, '2026-09-28');
    const b = comProxima({ id: 'b', tagKks: 'M01' }, '2026-10-02');
    const c = comProxima({ id: 'c', tagKks: 'M01' }, '2026-10-09');
    const resultado = alinharDatasPorEquipamento([a, b, c], 6);
    expect(resultado.map(p => p.proximaData)).toEqual(['2026-09-28', '2026-09-28', '2026-10-09']);
  });

  it('janela por área: Apoio 21 dias, Mecânica/Elétrica 6', () => {
    expect(janelaAlinhamentoDaArea('APOIO')).toBe(21);
    expect(janelaAlinhamentoDaArea('MECANICA')).toBe(6);
    expect(janelaAlinhamentoDaArea('ELETRICA')).toBe(6);
  });

  it('plano de agenda rígida não é antecipado nem puxa os vizinhos pra sua data', () => {
    const rigido = comProxima({ id: 'r', tagKks: 'PTPC91', agendaRigida: true }, '2026-10-21');
    const cedo = comProxima({ id: 'c', tagKks: 'PTPC91' }, '2026-10-15');
    const tarde = comProxima({ id: 't', tagKks: 'PTPC91' }, '2026-10-19');
    const resultado = alinharDatasPorEquipamento([rigido, cedo, tarde]);
    expect(resultado.find(p => p.id === 'r')!.proximaData).toBe('2026-10-21');
    expect(resultado.find(p => p.id === 't')!.proximaData).toBe('2026-10-15');
  });

  it('KKS fora de qualquer grupo confirmado não alinha com um KKS que está num grupo', () => {
    const doGrupo = comProxima({ id: 'a', area: 'APOIO', tagKks: '90SAA05AH616' }, '2026-09-20');
    const foraDoGrupo = comProxima({ id: 'b', area: 'APOIO', tagKks: 'KKS-QUALQUER-NAO-AGRUPADO' }, '2026-09-05');
    const resultado = alinharDatasPorEquipamento([doGrupo, foraDoGrupo]);
    expect(resultado.find(p => p.id === 'a')!.proximaDataOriginal).toBe(null);
    expect(resultado.find(p => p.id === 'b')!.proximaDataOriginal).toBe(null);
  });

  it('não agrupa por nome de equipamento igual quando nenhum dos planos tem KKS cadastrado', () => {
    // Pedido do usuário: "mesmo equipamento" é o mesmo KKS, não o nome livre — sem KKS
    // em nenhum dos dois, mais seguro não arriscar juntar equipamentos diferentes só
    // porque o campo de texto livre `equipamento` bateu.
    const a = comProxima({ id: 'a', equipamento: 'BOMBA 01', tagKks: null }, '2026-09-20');
    const b = comProxima({ id: 'b', equipamento: 'BOMBA 01', tagKks: null }, '2026-09-05');
    const resultado = alinharDatasPorEquipamento([a, b]);
    expect(resultado.find(p => p.id === 'a')!.proximaDataOriginal).toBe(null);
    expect(resultado.find(p => p.id === 'b')!.proximaDataOriginal).toBe(null);
  });
});

describe('nomeBaseDoPlano', () => {
  it('tira a TAG do equipamento e mantém o código da tarefa', () => {
    expect(nomeBaseDoPlano('I-E-2S MOTORES/PAINEIS ECA45')).toBe('I-E-2S MOTORES/PAINEIS');
    expect(nomeBaseDoPlano('I-E-2S MOTORES/PAINEIS ECA46')).toBe('I-E-2S MOTORES/PAINEIS');
    expect(nomeBaseDoPlano('P-E-6M GAVETAS C 2 STR 01')).toBe('P-E-6M GAVETAS C STR');
    expect(nomeBaseDoPlano('  p-r-1m prev off self 91EAC01AH012 TC05 ')).toBe('P-R-1M PREV OFF SELF');
  });
});

describe('semanasIsoDoAno', () => {
  it('2026: 53 semanas, S1 começa em 29/12/2025 e S40 é 28/09', () => {
    const semanas = semanasIsoDoAno(2026);
    expect(semanas).toHaveLength(53);
    expect(semanas[0]).toEqual({ numero: 1, inicio: '2025-12-29', fim: '2026-01-04' });
    expect(semanas[39]).toEqual({ numero: 40, inicio: '2026-09-28', fim: '2026-10-04' });
  });

  it('2027: 52 semanas, S1 começa em 04/01/2027', () => {
    const semanas = semanasIsoDoAno(2027);
    expect(semanas).toHaveLength(52);
    expect(semanas[0].inicio).toBe('2027-01-04');
  });
});

describe('ocorrenciasNoIntervalo', () => {
  it('lista toda a sequência fixa dentro do intervalo', () => {
    expect(ocorrenciasNoIntervalo('2026-09-21', 6, 'Mes(es)', '2026-01-01', '2027-12-31'))
      .toEqual(['2026-09-21', '2027-03-21', '2027-09-21']);
  });

  it('âncora depois do intervalo não gera nada', () => {
    expect(ocorrenciasNoIntervalo('2028-01-10', 1, 'Mes(es)', '2027-01-01', '2027-12-31')).toEqual([]);
  });

  it('semanal no ano inteiro', () => {
    expect(ocorrenciasNoIntervalo('2026-01-05', 1, 'Semana(s)', '2026-01-01', '2026-12-31')).toHaveLength(52);
  });
});

describe('siglaPeriodicidade', () => {
  it('pela duração, não pelo texto do cadastro', () => {
    expect(siglaPeriodicidade(1, 'Semana(s)')).toBe('S');
    expect(siglaPeriodicidade(7, 'Dia(s)')).toBe('S');
    expect(siglaPeriodicidade(2, 'Semana(s)')).toBe('Q');
    expect(siglaPeriodicidade(30, 'Dia(s)')).toBe('M');
    expect(siglaPeriodicidade(1, 'Mes(es)')).toBe('M');
    expect(siglaPeriodicidade(3, 'Mes(es)')).toBe('T');
    expect(siglaPeriodicidade(180, 'Dia(s)')).toBe('6M');
    expect(siglaPeriodicidade(12, 'Mes(es)')).toBe('A');
    expect(siglaPeriodicidade(24, 'Mes(es)')).toBe('2A');
  });
});

describe('limitarPorEquipeApoio', () => {
  function planoApoio(id: string, responsavel: string | null, proximaData: string, kks = id) {
    return comProxima({ id, area: 'APOIO', responsavel, tagKks: kks }, proximaData);
  }

  it('corta pra N por equipe, mantendo a ordem de prioridade recebida', () => {
    const planos = Array.from({ length: 7 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const resultado = limitarPorEquipeApoio(planos, {});
    expect(resultado.map(p => p.id)).toEqual(['sp0', 'sp1', 'sp2', 'sp3', 'sp4']);
  });

  it('plano de agenda rígida nunca é cortado, mesmo com a cota da equipe cheia', () => {
    const planos = Array.from({ length: 5 }, (_, i) => planoApoio(`op${i}`, 'OPERAÇÃO', '2026-09-10'));
    const teste = { ...planoApoio('teste', 'OPERAÇÃO', '2026-09-21'), agendaRigida: true };
    const resultado = limitarPorEquipeApoio([...planos, teste], {});
    expect(resultado.map(p => p.id)).toContain('teste');
    expect(resumoPorEquipeApoio([...planos, teste], {})).toEqual([{ equipe: 'LIMP_OPERACIONAL', total: 6, mostrados: 6 }]);
  });

  it('equipes diferentes têm cotas independentes — uma equipe cheia não consome a cota de outra', () => {
    const servplex = Array.from({ length: 6 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const operacao = Array.from({ length: 6 }, (_, i) => planoApoio(`op${i}`, 'OPERAÇÃO', '2026-09-10'));
    const bms = Array.from({ length: 6 }, (_, i) => planoApoio(`bms${i}`, 'BMS', '2026-09-10'));
    const resultado = limitarPorEquipeApoio([...servplex, ...operacao, ...bms], {});
    expect(resultado.filter(p => p.id.startsWith('sp'))).toHaveLength(5);
    expect(resultado.filter(p => p.id.startsWith('op'))).toHaveLength(5);
    expect(resultado.filter(p => p.id.startsWith('bms'))).toHaveLength(5);
  });

  // Reportado: a versão anterior contava um grupo de mesmo equipamento+data como 1 vaga
  // só (pedido original do usuário), o que deixou passar 44 planos de uma vez quando
  // muitas tarefas do mesmo KKS caíam juntas — o usuário confirmou depois que o limite
  // de 5 é RÍGIDO, sem exceção nenhuma pra "mesmo equipamento". Corte agora é estrito
  // em cima de planos, nunca deixa passar de N mesmo quando vários compartilham
  // equipamento+data.
  it('mesmo quando vários planos compartilham equipamento+data, o corte de N por equipe continua rígido', () => {
    const mesmoEquipamento = Array.from({ length: 10 }, (_, i) => planoApoio(`kks${i}`, 'SERVPLEX', '2026-09-15', 'BOMBA-01'));
    const resultado = limitarPorEquipeApoio(mesmoEquipamento, {});
    expect(resultado).toHaveLength(5);
  });

  it('6º plano de uma equipe já no limite fica de fora', () => {
    const planos = Array.from({ length: 6 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const resultado = limitarPorEquipeApoio(planos, {});
    expect(resultado.map(p => p.id)).not.toContain('sp5');
  });

  it('responsavel vazio ou não reconhecido cai no balde NAO_CLASSIFICADO, com cota própria', () => {
    const naoClassificados = Array.from({ length: 6 }, (_, i) => planoApoio(`nc${i}`, i % 2 === 0 ? null : 'TOP ANDAIMES', '2026-09-10'));
    const servplex = Array.from({ length: 5 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const resultado = limitarPorEquipeApoio([...naoClassificados, ...servplex], {});
    expect(resultado.filter(p => p.id.startsWith('nc'))).toHaveLength(5);
    expect(resultado.filter(p => p.id.startsWith('sp'))).toHaveLength(5);
  });

  it('não muta o array de entrada', () => {
    const planos = Array.from({ length: 7 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    limitarPorEquipeApoio(planos, {});
    expect(planos).toHaveLength(7);
  });

  // Depois de migrar pro modelo time-based, o teto deixou de ser um valor único (5)
  // igual pra todas as equipes — cada equipe pode ter um teto diferente, dimensionado
  // pelo volume real dela (ver comentário de LIMITE_PREVENTIVAS_POR_EQUIPE_APOIO no
  // componente). Equipe sem entrada no Record cai no padrão conservador (5).
  it('aceita um limite diferente por equipe — equipe sem entrada cai no padrão (5)', () => {
    const servplex = Array.from({ length: 10 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const operacao = Array.from({ length: 10 }, (_, i) => planoApoio(`op${i}`, 'OPERAÇÃO', '2026-09-10'));
    const bms = Array.from({ length: 10 }, (_, i) => planoApoio(`bms${i}`, 'BMS', '2026-09-10'));
    const resultado = limitarPorEquipeApoio(
      [...servplex, ...operacao, ...bms],
      { REFRIGERACAO: 8, LIMP_OPERACIONAL: 2 },
    );
    expect(resultado.filter(p => p.id.startsWith('sp'))).toHaveLength(8);
    expect(resultado.filter(p => p.id.startsWith('op'))).toHaveLength(2);
    expect(resultado.filter(p => p.id.startsWith('bms'))).toHaveLength(5);
  });
});

describe('resumoPorEquipeApoio', () => {
  function planoApoio(id: string, responsavel: string | null, proximaData: string, kks = id) {
    return comProxima({ id, area: 'APOIO', responsavel, tagKks: kks }, proximaData);
  }

  it('conta planos (1 por plano, não por equipamento) por equipe, com mostrados = min(total, limite)', () => {
    const servplex = Array.from({ length: 12 }, (_, i) => planoApoio(`sp${i}`, 'SERVPLEX', '2026-09-10'));
    const bms = Array.from({ length: 3 }, (_, i) => planoApoio(`bms${i}`, 'BMS', '2026-09-10'));
    const resultado = resumoPorEquipeApoio([...servplex, ...bms], {});
    expect(resultado.find(r => r.equipe === 'REFRIGERACAO')).toEqual({ equipe: 'REFRIGERACAO', total: 12, mostrados: 5 });
    expect(resultado.find(r => r.equipe === 'SPCI')).toEqual({ equipe: 'SPCI', total: 3, mostrados: 3 });
  });

  it('planos que compartilham equipamento+data contam 1 por plano no total (sem exceção)', () => {
    const par = [
      planoApoio('a', 'SERVPLEX', '2026-09-15', 'BOMBA-01'),
      planoApoio('b', 'SERVPLEX', '2026-09-15', 'BOMBA-01'),
    ];
    const resultado = resumoPorEquipeApoio(par, {});
    expect(resultado.find(r => r.equipe === 'REFRIGERACAO')).toEqual({ equipe: 'REFRIGERACAO', total: 2, mostrados: 2 });
  });

  it('responsavel não reconhecido cai em NAO_CLASSIFICADO', () => {
    const resultado = resumoPorEquipeApoio([planoApoio('a', 'TOP ANDAIMES', '2026-09-10')], {});
    expect(resultado.find(r => r.equipe === EQUIPE_APOIO_NAO_CLASSIFICADA)).toEqual({ equipe: EQUIPE_APOIO_NAO_CLASSIFICADA, total: 1, mostrados: 1 });
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

describe('inferirCategoriaIndicador', () => {
  it('Mecânica e Elétrica não têm ambiguidade — categoria é sempre a própria área', () => {
    expect(inferirCategoriaIndicador(null, 'MECANICA')).toBe('MECANICA');
    expect(inferirCategoriaIndicador('qualquer coisa', 'ELETRICA')).toBe('ELETRICA');
  });

  it('Apoio com especialidade de refrigeração vira REFRIGERACAO', () => {
    expect(inferirCategoriaIndicador('P-REFRIGERACAO-PREVENTIVA', 'APOIO')).toBe('REFRIGERACAO');
  });

  it('Apoio com especialidade de operação/limpeza vira LIMP_OPERACIONAL', () => {
    expect(inferirCategoriaIndicador('P-OPERACAO-LIMPEZA INDUSTRIAL', 'APOIO')).toBe('LIMP_OPERACIONAL');
  });

  it('Apoio com especialidade de SPCI vira SPCI', () => {
    expect(inferirCategoriaIndicador('P-SPCI-PREVENTIVA', 'APOIO')).toBe('SPCI');
  });

  it('Apoio sem especialidade reconhecível (ex. Elétrica dentro de Apoio) ou nula fica null — pessoa escolhe na hora', () => {
    expect(inferirCategoriaIndicador('P-ELETRICA-PREVENTIVA', 'APOIO')).toBe(null);
    expect(inferirCategoriaIndicador(null, 'APOIO')).toBe(null);
  });
});

describe('inferirCategoriaIndicadorPorTecnico', () => {
  it('SERVPLEX vira REFRIGERACAO', () => {
    expect(inferirCategoriaIndicadorPorTecnico('SERVPLEX')).toBe('REFRIGERACAO');
  });

  it('OPERAÇÃO vira LIMP_OPERACIONAL (não faz diferença maiúscula/minúscula ou acento)', () => {
    expect(inferirCategoriaIndicadorPorTecnico('Operação')).toBe('LIMP_OPERACIONAL');
  });

  it('BMS vira SPCI', () => {
    expect(inferirCategoriaIndicadorPorTecnico('bms')).toBe('SPCI');
  });

  it('nome de equipe/técnico não reconhecido fica null', () => {
    expect(inferirCategoriaIndicadorPorTecnico('TOP ANDAIMES')).toBe(null);
  });
});


describe('agenda compartilhada entre planos e programação', () => {
  it('pula semanas fechadas sem deslocar a âncora do plano', () => {
    const cadastro = plano({ dataInicial: '2026-09-21', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' });
    const agenda = agendaDosPlanos([cadastro], new Map(), false, '2026-09-21', new Map([['2026-09-21', true]]));
    expect(agenda[0].proximaData).toBe('2026-09-28');
    expect(cadastro.dataInicial).toBe('2026-09-21');
  });
});
