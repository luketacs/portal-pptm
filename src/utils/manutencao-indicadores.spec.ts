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
  it('sem nenhuma ordem, tudo zerado e status "Abaixo da Meta" (zero não bate meta nenhuma)', () => {
    const r = calcularIndicadoresSemana({ ordens: [], sigmaPorOs: {}, diasSemanaFallback: [], matchColaborador });
    expect(r.geral).toEqual({ programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 });
    expect(r.porArea).toEqual([]);
    expect(r.statusGeral).toBe('Abaixo da Meta');
  });

  it('conta executada só quando o apontamento do SIGMA bate com a matrícula e o dia previsto', () => {
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', tecnicoMatricula: '111', diasPrevistos: ['2026-09-21'] }),
      ordem({ id: 'b', numeroOs: '2', tecnicoMatricula: '222', diasPrevistos: ['2026-09-21'] }),
    ];
    const sigmaPorOs = {
      ...sigma('000001', [{ matricula: '111', data: '2026-09-21' }]), // bate
      ...sigma('000002', [{ matricula: '222', data: '2026-09-22' }]), // dia diferente, não bate
    };
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, diasSemanaFallback: [], matchColaborador });
    expect(r.geral).toEqual({ programadas: 2, executadas: 1, naoExecutadas: 1, atendimento: 50 });
  });

  it('agrupa por área (categoriaIndicador), só mostrando as que têm pelo menos 1 programada', () => {
    const ordens = [
      ordem({ id: 'a', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '1' }),
      ordem({ id: 'b', area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', numeroOs: '2' }),
      ordem({ id: 'c', area: 'APOIO', categoriaIndicador: null, numeroOs: '3' }), // não classificado
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, diasSemanaFallback: [], matchColaborador });
    const categorias = r.porArea.map(a => a.categoria).sort();
    expect(categorias).toEqual([null, 'MECANICA', 'REFRIGERACAO'].sort());
    expect(r.porArea.find(a => a.categoria === 'ELETRICA')).toBeUndefined();
  });

  it('cumprimentoPlano de cada área só conta ordens daquela área que também são do plano', () => {
    const ordens = [
      ordem({ id: 'a', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '1', planoPreventivoId: 'p1' }),
      ordem({ id: 'b', area: 'MECANICA', categoriaIndicador: 'MECANICA', numeroOs: '2', planoPreventivoId: null }),
      ordem({ id: 'c', area: 'APOIO', categoriaIndicador: 'REFRIGERACAO', numeroOs: '3', planoPreventivoId: 'p2' }),
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, diasSemanaFallback: [], matchColaborador });
    const mecanica = r.porArea.find(a => a.categoria === 'MECANICA')!;
    expect(mecanica.programadas).toBe(2);
    expect(mecanica.cumprimentoPlano.programadas).toBe(1);
    const refrigeracao = r.porArea.find(a => a.categoria === 'REFRIGERACAO')!;
    expect(refrigeracao.cumprimentoPlano.programadas).toBe(1);
  });

  it('cumprimentoPlano só conta ordens com planoPreventivoId preenchido', () => {
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', planoPreventivoId: 'plano-1' }),
      ordem({ id: 'b', numeroOs: '2', planoPreventivoId: null }),
    ];
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs: {}, diasSemanaFallback: [], matchColaborador });
    expect(r.cumprimentoPlano.programadas).toBe(1);
    expect(r.geral.programadas).toBe(2);
  });

  it('status "Dentro da Meta" exige atendimento E cumprimento acima da meta ao mesmo tempo', () => {
    // 10 ordens todas executadas -> atendimento 100% (>= META_ATENDIMENTO); nenhuma do
    // plano -> cumprimentoPlano.atendimento fica 0 (sem programadas do plano) -> abaixo.
    const ordens = Array.from({ length: 10 }, (_, i) =>
      ordem({ id: `o${i}`, numeroOs: String(i + 1), tecnicoMatricula: '111', diasPrevistos: ['2026-09-21'] }));
    const sigmaPorOs: Record<string, ConsultaSigmaResultado> = {};
    for (let i = 0; i < 10; i++) Object.assign(sigmaPorOs, sigma(String(i + 1).padStart(6, '0'), [{ matricula: '111', data: '2026-09-21' }]));
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, diasSemanaFallback: [], matchColaborador });
    expect(r.geral.atendimento).toBe(100);
    expect(r.geral.atendimento).toBeGreaterThanOrEqual(META_ATENDIMENTO);
    expect(r.cumprimentoPlano.programadas).toBe(0);
    expect(r.statusGeral).not.toBe('Dentro da Meta');
  });

  it('status "Próximo da Meta" quando pelo menos um dos dois indicadores passa de 90% da meta', () => {
    // META_CUMPRIMENTO * 0.9 = 83.7 -> 85% de cumprimento entra em "Próximo", mesmo com
    // atendimento geral baixo.
    const ordens = [
      ordem({ id: 'a', numeroOs: '1', planoPreventivoId: 'p1', tecnicoMatricula: '111', diasPrevistos: ['2026-09-21'] }),
      ordem({ id: 'b', numeroOs: '2', planoPreventivoId: null }), // não executada, sem SIGMA
    ];
    // Só a ordem 'a' bate no SIGMA -> geral 50%, cumprimentoPlano 100% (1 de 1 do plano).
    const sigmaPorOs = sigma('000001', [{ matricula: '111', data: '2026-09-21' }]);
    const r = calcularIndicadoresSemana({ ordens, sigmaPorOs, diasSemanaFallback: [], matchColaborador });
    expect(r.geral.atendimento).toBe(50);
    expect(r.cumprimentoPlano.atendimento).toBe(100);
    expect(r.cumprimentoPlano.atendimento).toBeGreaterThanOrEqual(META_CUMPRIMENTO * 0.9);
    expect(r.statusGeral).toBe('Próximo da Meta');
  });
});
