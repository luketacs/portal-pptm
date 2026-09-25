import { CicloManutencao, ManutencaoOrdem, PlanoManutencao } from '../models/manutencao-programacao.model';
import {
  ancoraFutura, apoioSemEquipe, cicloCoerenteComOrdem, diagnosticarPlanos, diferencasPlano, nomeDivergeDaPeriodicidade,
  planosDuplicados, validarPlanoParaSalvar,
} from './manutencao-planos-saude';

function plano(o: Partial<PlanoManutencao> = {}): PlanoManutencao {
  return {
    id: 'p1', codigo: 'PM-0001', nome: 'I-M-1M INSPECAO M01', equipamento: 'M01', tagKks: 'M01', area: 'MECANICA',
    especialidade: null, descricao: '', atividades: [], periodicidadeValor: 1, periodicidadeUnidade: 'Mes(es)',
    dataInicial: '2026-09-21', responsavel: null, tempoEstimadoHoras: null, hhEstimado: null, observacoes: null,
    ativo: true, numeroOsReservado: null, lotoPadrao: null, equipamentosRelacionados: null, criadoPorId: null,
    criadoPorNome: 't', createdAt: new Date(), atualizadoPorId: null, atualizadoPorNome: null, atualizadoEm: new Date(),
    ...o,
  };
}

const HOJE = '2026-09-21';

describe('ancoraFutura', () => {
  it('mensal com data inicial daqui a 4 meses: bloqueia', () => {
    expect(ancoraFutura(plano({ dataInicial: '2027-01-25' }), HOJE)).toContain('25/01/2027');
  });
  it('semestral com data inicial daqui a 4 meses: ok (dentro de um período)', () => {
    expect(ancoraFutura(plano({ dataInicial: '2027-01-25', periodicidadeValor: 6 }), HOJE)).toBeNull();
  });
  it('semanal com data inicial 3 semanas à frente: bloqueia', () => {
    expect(ancoraFutura(plano({ dataInicial: '2026-10-12', periodicidadeValor: 1, periodicidadeUnidade: 'Semana(s)' }), HOJE)).not.toBeNull();
  });
  it('data inicial no passado: ok', () => {
    expect(ancoraFutura(plano({ dataInicial: '2026-01-05' }), HOJE)).toBeNull();
  });
});

describe('nomeDivergeDaPeriodicidade', () => {
  it('"6M" cadastrado com 4 meses: avisa', () => {
    expect(nomeDivergeDaPeriodicidade({ nome: 'I-E-6M BOBINADOR', periodicidadeValor: 4, periodicidadeUnidade: 'Mes(es)' })).toContain('6M');
  });
  it('"1M" cadastrado com 30 dias: ok', () => {
    expect(nomeDivergeDaPeriodicidade({ nome: 'I-M-1M ESTICAMENTO', periodicidadeValor: 30, periodicidadeUnidade: 'Dia(s)' })).toBeNull();
  });
  it('"1A" com 12 meses e "2S" com 2 semanas: ok', () => {
    expect(nomeDivergeDaPeriodicidade({ nome: 'P-E-1A REVISAO', periodicidadeValor: 12, periodicidadeUnidade: 'Mes(es)' })).toBeNull();
    expect(nomeDivergeDaPeriodicidade({ nome: 'I-L-2S NIVEL', periodicidadeValor: 2, periodicidadeUnidade: 'Semana(s)' })).toBeNull();
  });
  it('nome sem sigla: não opina', () => {
    expect(nomeDivergeDaPeriodicidade({ nome: 'L-OP TRIPPERS', periodicidadeValor: 3, periodicidadeUnidade: 'Mes(es)' })).toBeNull();
  });
});

describe('planosDuplicados / apoioSemEquipe', () => {
  it('mesmo nome + KKS + área, ambos ativos: duplicado (ignora acento/maiúscula)', () => {
    const a = plano({ id: 'a', nome: 'Inspeção M01' });
    const b = plano({ id: 'b', codigo: 'PM-0002', nome: 'INSPECAO  M01' });
    expect(planosDuplicados(a, [a, b]).map(p => p.id)).toEqual(['b']);
  });
  it('KKS diferente ou outro inativo: não é duplicado', () => {
    const a = plano({ id: 'a' });
    expect(planosDuplicados(a, [a, plano({ id: 'b', tagKks: 'M02' }), plano({ id: 'c', ativo: false })])).toEqual([]);
  });
  it('Apoio com responsável não reconhecido: avisa; SERVPLEX: ok; Mecânica: não se aplica', () => {
    expect(apoioSemEquipe({ area: 'APOIO', responsavel: 'Fulano' })).not.toBeNull();
    expect(apoioSemEquipe({ area: 'APOIO', responsavel: 'SERVPLEX' })).toBeNull();
    expect(apoioSemEquipe({ area: 'MECANICA', responsavel: null })).toBeNull();
  });
});

describe('validarPlanoParaSalvar', () => {
  it('âncora futura bloqueia; divergência de nome só avisa', () => {
    // Nome diz 6M, cadastrado 1 Mes, data inicial 8 meses à frente.
    const r = validarPlanoParaSalvar(
      { ...plano({ nome: 'I-E-6M X', dataInicial: '2027-06-01' }), id: null }, [], HOJE);
    expect(r.bloqueios).toHaveLength(1);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('6M');
  });

  it('plano inativo não é bloqueado pela data inicial', () => {
    const r = validarPlanoParaSalvar({ ...plano({ dataInicial: '2027-06-01', ativo: false }), id: null }, [], HOJE);
    expect(r.bloqueios).toEqual([]);
  });
});

describe('diagnosticarPlanos', () => {
  it('encontra âncora futura, inativo com OS futura e ciclo desalinhado, erros primeiro', () => {
    const futuro = plano({ id: 'f', codigo: 'PM-0010', dataInicial: '2027-02-01' });
    const inativo = plano({ id: 'i', codigo: 'PM-0020', ativo: false });
    const semKks = plano({ id: 's', codigo: 'PM-0030', tagKks: null });
    const os = { id: 'o1', planoPreventivoId: 'i', semanaInicio: '2026-09-28' } as ManutencaoOrdem;
    const os2 = { id: 'o2', planoPreventivoId: 's', semanaInicio: '2026-09-21' } as ManutencaoOrdem;
    const ciclo = { id: 'c1', planoId: 's', dataPrevista: '2027-02-04', ordemId: 'o2' } as CicloManutencao;
    const r = diagnosticarPlanos([futuro, inativo, semKks], [ciclo], [os, os2], HOJE);
    expect(r.map(x => x.tipo)).toEqual(['ancora_futura', 'ciclo_desalinhado', 'inativo_com_os_futura', 'sem_kks']);
    expect(r.find(x => x.tipo === 'inativo_com_os_futura')!.ordens!.map(o => o.id)).toEqual(['o1']);
  });

  it('ciclo desalinhado traz a data da OS pra ajustar; plano inativo não entra', () => {
    const ativo = plano({ id: 'a' });
    const inativo = plano({ id: 'i', codigo: 'PM-0002', ativo: false });
    const os = { id: 'o1', planoPreventivoId: 'a', semanaInicio: '2026-09-28', diasPrevistos: ['2026-09-30', '2026-09-29'] } as ManutencaoOrdem;
    const os2 = { id: 'o2', planoPreventivoId: 'i', semanaInicio: '2026-09-21', diasPrevistos: ['2026-09-21'] } as ManutencaoOrdem;
    const r = diagnosticarPlanos([ativo, inativo], [
      { id: 'c1', planoId: 'a', dataPrevista: '2027-09-28', ordemId: 'o1' } as CicloManutencao,
      { id: 'c2', planoId: 'i', dataPrevista: '2027-02-21', ordemId: 'o2' } as CicloManutencao,
    ], [os, os2], HOJE);
    expect(r).toHaveLength(1);
    expect(r[0].ciclo).toEqual({ planoId: 'a', dataAtual: '2027-09-28', dataNova: '2026-09-29' });
  });

  it('inativo com OS só na semana atual: não aparece (já em execução)', () => {
    const inativo = plano({ id: 'i', ativo: false });
    const os = { id: 'o1', planoPreventivoId: 'i', semanaInicio: HOJE } as ManutencaoOrdem;
    expect(diagnosticarPlanos([inativo], [], [os], HOJE)).toEqual([]);
  });
});

describe('cicloCoerenteComOrdem', () => {
  it('dentro de 3 semanas fica; além disso vira o 1º dia da OS; sem dias, a segunda', () => {
    expect(cicloCoerenteComOrdem('2026-10-12', '2026-09-28', ['2026-09-29'])).toBe('2026-10-12');
    expect(cicloCoerenteComOrdem('2027-01-05', '2026-09-28', ['2026-10-01', '2026-09-30'])).toBe('2026-09-30');
    expect(cicloCoerenteComOrdem('2027-01-05', '2026-09-28', [])).toBe('2026-09-28');
    expect(cicloCoerenteComOrdem(null, '2026-09-28', [])).toBeNull();
  });
});

describe('diferencasPlano', () => {
  it('lista só os campos que mudaram, com antes/depois legível', () => {
    const antes = plano({ atividades: [{ texto: 'a', subPassos: [] }] });
    const depois = { ...antes, periodicidadeValor: 3, dataInicial: '2026-10-05',
      atividades: [{ texto: 'a', subPassos: ['a.1', 'a.2'] }] };
    expect(diferencasPlano(antes, depois)).toEqual([
      { campo: 'Data inicial', antes: '2026-09-21', depois: '2026-10-05' },
      { campo: 'Periodicidade', antes: '1 Mes(es)', depois: '3 Mes(es)' },
      { campo: 'Checklist', antes: '1 passo(s)', depois: '1 passo(s) + 2 sub-passo(s)' },
    ]);
  });
});
