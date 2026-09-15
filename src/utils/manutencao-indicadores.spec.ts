import { ManutencaoOrdem, ConsultaSigmaResultado } from '../models/manutencao-programacao.model';
import { calcularIndicadoresSemana, MatchColaborador, META_ATENDIMENTO, META_CUMPRIMENTO } from './manutencao-indicadores';

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
    expect(r.geral).toEqual({ programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 });
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
    expect(r.geral).toEqual({ programadas: 1, executadas: 1, naoExecutadas: 0, atendimento: 100 });
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
    expect(r.geral).toEqual({ programadas: 2, executadas: 1, naoExecutadas: 1, atendimento: 50 });
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
