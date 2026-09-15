import { ManutencaoOrdem, ConsultaSigmaResultado } from '../models/manutencao-programacao.model';
import {
  calcularIndicadoresSemana, indiceAtingimentoMeta, MatchColaborador, META_ATENDIMENTO, META_CUMPRIMENTO,
  META_DIAS_NAVIO, META_DISPONIBILIDADE_GLOBAL, PISO_DIAS_NAVIO, PISO_DISPONIBILIDADE_GLOBAL, PISO_INDICE_META,
  TETO_DIAS_NAVIO, TETO_DISPONIBILIDADE_GLOBAL, TETO_INDICE_META,
} from './manutencao-indicadores';

function ordem(overrides: Partial<ManutencaoOrdem> = {}): ManutencaoOrdem {
  return {
    id: 'x', tipo: 'ordem', area: 'ELETRICA', categoriaIndicador: 'ELETRICA', semanaInicio: '2026-09-21',
    numeroOs: null, semOs: false, descricao: '', equipamento: null, equipamentosRelacionados: null,
    recursos: null, loto: null, areaAtuacao: null, duracaoHoras: null, tipoServico: null,
    tecnicoNome: 'FULANO', tecnicoMatricula: '123', diasPrevistos: ['2026-09-21'], status: 'PEND',
    observacoes: null, reuniaoHorario: null, reuniaoLocal: null, planoPreventivoId: null, checklist: null,
    criadoPorId: null, criadoPorNome: '', createdAt: new Date(), ...overrides,
  };
}

const matchColaborador: MatchColaborador = (matricula) => (matricula ? { matricula } : null);

function sigma(numeroOs: string, executantes: { matricula: string; data: string }[]): Record<string, ConsultaSigmaResultado> {
  return {
    [numeroOs]: {
      os: null,
      apontamentos: executantes.map(e => ({ data: e.data, status: 'EXEC', executante: e.matricula })),
    },
  };
}

describe('calcularIndicadoresSemana', () => {
  it('sem nenhuma ordem, atendimento 100% (nada previsto = nada faltando) e status "Dentro da Meta"', () => {
    // Pedido do usuário: 0 programadas deve ler como 100%, não 0% — uma área (ou
    // semana) sem nenhuma ordem do plano não "falhou", simplesmente não tinha nada
    // previsto. Antes lia como "Abaixo da Meta" (0% não bate meta nenhuma).
    const r = calcularIndicadoresSemana({ ordens: [], sigmaPorOs: {}, matchColaborador });
    expect(r.geral).toEqual({ programadas: 0, executadas: 0, parciais: 0, naoExecutadas: 0, atendimento: 100 });
    expect(r.porArea).toEqual([]);
    expect(r.statusGeral).toBe('Dentro da Meta');
  });

  it('conta executada quando o apontamento bate com a matrícula, mesmo em dia diferente do previsto (mesma semana)', () => {
    // Regressão: técnico troca de dia dentro da mesma semana (executa numa data
    // diferente da planejada) — antes disso só valia bater com um dia de
    // diasPrevistos especificamente, então o apontamento real nunca contava.
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', tecnicoMatricula: '111', semanaInicio: '2026-09-21', diasPrevistos: ['2026-09-21'] }),
    ];
    const sigmaPorOs = sigma('000001', [{ matricula: '111', data: '2026-09-24' }]); // quinta, não estava em diasPrevistos, mas é da mesma semana
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, matchColaborador });
    expect(r.geral).toEqual({ programadas: 1, executadas: 1, parciais: 0, naoExecutadas: 0, atendimento: 100 });
  });

  it('não conta como executada quando o apontamento cai fora da semana da ordem', () => {
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', tecnicoMatricula: '111', semanaInicio: '2026-09-21', diasPrevistos: ['2026-09-21'] }),
      ordem({ id: 'b', numeroOs: '2', tecnicoMatricula: '222', semanaInicio: '2026-09-21', diasPrevistos: ['2026-09-21'] }),
    ];
    const sigmaPorOs = {
      ...sigma('000001', [{ matricula: '111', data: '2026-09-21' }]), // dentro da semana (segunda)
      ...sigma('000002', [{ matricula: '222', data: '2026-09-28' }]), // semana seguinte, fora
    };
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, matchColaborador });
    expect(r.geral).toEqual({ programadas: 2, executadas: 1, parciais: 0, naoExecutadas: 1, atendimento: 50 });
  });

  it('agrupa por área (categoriaIndicador), só mostrando as que têm pelo menos 1 programada', () => {
    const ordens = [
      ordem({ id: 'a', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '1' }),
      ordem({ id: 'b', area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', numeroOs: '2' }),
      ordem({ id: 'c', area: 'APOIO', categoriaIndicador: null, numeroOs: '3' }), // não classificado
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, matchColaborador });
    const categorias = r.porArea.map(a => a.categoria).sort();
    expect(categorias).toEqual([null, 'MECANICA', 'REFRIGERACAO'].sort());
    expect(r.porArea.find(a => a.categoria === 'ELETRICA')).toBeUndefined();
  });

  it('cumprimentoPlano de cada área só conta ordens daquela área que também são preventivas', () => {
    const ordens = [
      ordem({ id: 'a', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '1', tipoServico: 'PREVENTIVA' }),
      ordem({ id: 'b', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '2', tipoServico: 'CORRETIVA' }),
      ordem({ id: 'c', area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', numeroOs: '3', tipoServico: 'PREVENTIVA' }),
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, matchColaborador });
    const mecanica = r.porArea.find(a => a.categoria === 'MECANICA')!;
    expect(mecanica.programadas).toBe(2);
    expect(mecanica.cumprimentoPlano.programadas).toBe(1);
    const refrigeracao = r.porArea.find(a => a.categoria === 'REFRIGERACAO')!;
    expect(refrigeracao.cumprimentoPlano.programadas).toBe(1);
  });

  it('cumprimentoPlano só conta ordens com tipoServico PREVENTIVA (independe de vínculo com Plano cadastrado)', () => {
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', tipoServico: 'PREVENTIVA', planoPreventivoId: null }),
      ordem({ id: 'b', numeroOs: '2', tipoServico: 'CORRETIVA', planoPreventivoId: 'plano-1' }),
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, matchColaborador });
    expect(r.cumprimentoPlano.programadas).toBe(1);
    expect(r.geral.programadas).toBe(2);
  });

  it('status "Dentro da Meta" exige atendimento E cumprimento acima da meta ao mesmo tempo', () => {
    // 19 corretivas executadas -> atendimento geral 95% (>= META_ATENDIMENTO). 1
    // preventiva NÃO executada -> cumprimentoPlano 0% (< META_CUMPRIMENTO), mesmo com
    // o geral batendo meta — precisa das duas, uma sozinha não basta. (0 programadas
    // do plano não serve mais pra testar isso: agora lê como 100%, não como "falha".)
    const corretivas = Array.from({ length: 19 }, (_, i) =>
      ordem({ id: `c${i}`, numeroOs: String(i + 1), tecnicoMatricula: '111', tipoServico: 'CORRETIVA', diasPrevistos: ['2026-09-21'] }));
    const preventivaNaoExecutada = ordem({ id: 'p1', numeroOs: '999', tecnicoMatricula: '111', tipoServico: 'PREVENTIVA', diasPrevistos: ['2026-09-21'] });
    const ordens = [...corretivas, preventivaNaoExecutada];
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {};
    for (let i = 0; i < 19; i++) Object.assign(sigmaPorOs, sigma(String(i + 1).padStart(6, '0'), [{ matricula: '111', data: '2026-09-21' }]));
    // '000999' (a preventiva) fica de fora do sigmaPorOs -> nunca executada.
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, matchColaborador });
    expect(r.geral.atendimento).toBe(95);
    expect(r.geral.atendimento).toBeGreaterThanOrEqual(META_ATENDIMENTO);
    expect(r.cumprimentoPlano.atendimento).toBe(0);
    expect(r.statusGeral).not.toBe('Dentro da Meta');
  });

  it('status "Próximo da Meta" quando pelo menos um dos dois indicadores passa de 90% da meta', () => {
    // META_CUMPRIMENTO * 0.9 = 85.5 -> 100% de cumprimento entra em "Próximo", mesmo com
    // atendimento geral baixo.
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', tipoServico: 'PREVENTIVA', tecnicoMatricula: '111', diasPrevistos: ['2026-09-21'] }),
      ordem({ id: 'b', numeroOs: '2', tipoServico: 'CORRETIVA' }), // não executada, sem SIGMA
    ];
    // Só a ordem 'a' bate no SIGMA -> geral 50%, cumprimentoPlano 100% (1 de 1 do plano).
    const sigmaPorOs = sigma('000001', [{ matricula: '111', data: '2026-09-21' }]);
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, matchColaborador });
    expect(r.geral.atendimento).toBe(50);
    expect(r.cumprimentoPlano.atendimento).toBe(100);
    expect(r.cumprimentoPlano.atendimento).toBeGreaterThanOrEqual(META_CUMPRIMENTO * 0.9);
    expect(r.statusGeral).toBe('Próximo da Meta');
  });
});

describe('indiceAtingimentoMeta', () => {
  // Régua real usada pelo Corporativo (planilha de PLR): piso 92% -> índice 75%,
  // meta 95% -> índice 100%, teto 100% -> índice 125% (travado dali pra cima).
  const piso = PISO_INDICE_META; // 92
  const meta = META_ATENDIMENTO; // 95 (mesmo valor de META_CUMPRIMENTO)
  const teto = TETO_INDICE_META; // 100

  it('exemplo da planilha: 98,06% (entre meta e teto) -> ~115,3%', () => {
    // 1 + 0,25 * (98,06-95)/(100-95) = 1,153 -> 115,3%
    expect(indiceAtingimentoMeta(98.06, piso, meta, teto)).toBeCloseTo(115.3, 1);
  });

  it('exatamente no piso -> 75%', () => {
    expect(indiceAtingimentoMeta(92, piso, meta, teto)).toBe(75);
  });

  it('abaixo do piso -> rampa 0% a 75% (proporcional)', () => {
    expect(indiceAtingimentoMeta(0, piso, meta, teto)).toBe(0);
    expect(indiceAtingimentoMeta(46, piso, meta, teto)).toBeCloseTo(37.5, 1); // metade do piso -> metade de 75%
  });

  it('entre piso e meta -> rampa 75% a 100%', () => {
    // Meio do caminho entre 92 e 95 (93,5) -> meio do caminho entre 75% e 100% (87,5%)
    expect(indiceAtingimentoMeta(93.5, piso, meta, teto)).toBeCloseTo(87.5, 1);
  });

  it('exatamente na meta -> 100%', () => {
    expect(indiceAtingimentoMeta(95, piso, meta, teto)).toBe(100);
  });

  it('exatamente no teto -> 125% (trava, não passa disso)', () => {
    expect(indiceAtingimentoMeta(100, piso, meta, teto)).toBe(125);
  });

  it('acima do teto continua travado em 125%, não sobe mais', () => {
    expect(indiceAtingimentoMeta(150, piso, meta, teto)).toBe(125);
  });

  it('nunca fica negativo (MÁXIMO(...,0) da planilha original)', () => {
    expect(indiceAtingimentoMeta(-10, piso, meta, teto)).toBeGreaterThanOrEqual(0);
  });

  it('Disponibilidade Global Anual (piso/meta/teto próprios): exemplo real 84,14% -> 108,72%', () => {
    expect(indiceAtingimentoMeta(84.14, PISO_DISPONIBILIDADE_GLOBAL, META_DISPONIBILIDADE_GLOBAL, TETO_DISPONIBILIDADE_GLOBAL))
      .toBeCloseTo(108.72, 1);
  });

  describe('quanto menor, melhor (teto < piso, ex.: Dias/Navio)', () => {
    const p = PISO_DIAS_NAVIO; // 5 -> 75%
    const m = META_DIAS_NAVIO; // 4.5 -> 100%
    const t = TETO_DIAS_NAVIO; // 4 -> 125%

    it('exemplo real da planilha: 8,64 (bem acima do piso) -> 20,4%', () => {
      expect(indiceAtingimentoMeta(8.64, p, m, t)).toBeCloseTo(20.4, 1);
    });

    it('exatamente no teto (melhor caso) -> 125%', () => {
      expect(indiceAtingimentoMeta(4, p, m, t)).toBe(125);
    });

    it('melhor que o teto continua travado em 125%', () => {
      expect(indiceAtingimentoMeta(2, p, m, t)).toBe(125);
    });

    it('exatamente na meta -> 100%', () => {
      expect(indiceAtingimentoMeta(4.5, p, m, t)).toBe(100);
    });

    it('exatamente no piso -> 75%', () => {
      expect(indiceAtingimentoMeta(5, p, m, t)).toBe(75);
    });

    it('entre teto e meta -> rampa 125% a 100%', () => {
      // Meio do caminho entre 4 e 4,5 (4,25) -> meio do caminho entre 125% e 100% (112,5%)
      expect(indiceAtingimentoMeta(4.25, p, m, t)).toBeCloseTo(112.5, 1);
    });

    it('entre meta e piso -> rampa 100% a 75%', () => {
      // Meio do caminho entre 4,5 e 5 (4,75) -> meio do caminho entre 100% e 75% (87,5%)
      expect(indiceAtingimentoMeta(4.75, p, m, t)).toBeCloseTo(87.5, 1);
    });

    it('pior que o dobro do piso -> 0%, nunca fica negativo', () => {
      expect(indiceAtingimentoMeta(p * 2, p, m, t)).toBe(0);
      expect(indiceAtingimentoMeta(p * 5, p, m, t)).toBe(0);
    });
  });
});
