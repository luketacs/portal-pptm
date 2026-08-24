import { calcularSaldoCaixa, calcularTotalComprometidoMes } from './fundo-fixo-calc';
import { FundoFixoSaque, FundoFixoSolicitacao } from '../models/fundo-fixo.model';

function saque(overrides: Partial<FundoFixoSaque> = {}): FundoFixoSaque {
  return {
    id: 's1',
    valor: 100,
    taxa: null,
    tipo: 'saque',
    dataSaque: new Date('2026-07-10'),
    mesReferencia: '2026-07',
    observacoes: null,
    registradoPorId: 'admin-1',
    registradoPorNome: 'Admin',
    createdAt: new Date('2026-07-10'),
    ...overrides,
  };
}

function solicitacao(overrides: Partial<FundoFixoSolicitacao> = {}): FundoFixoSolicitacao {
  return {
    id: 'r1',
    solicitanteId: 'user-1',
    solicitanteNome: 'João',
    setor: 'Manutenção',
    fornecedor: 'Fornecedor X',
    material: 'Parafuso',
    linkProduto: null,
    valorEstimado: 100,
    valorFinal: null,
    formaPagamento: 'cartao',
    orcamentoUrl: null,
    notasFiscaisUrls: [],
    observacoes: null,
    status: 'pendente',
    aprovadorId: null,
    aprovadorNome: null,
    motivoRecusa: null,
    compradorId: null,
    compradorNome: null,
    gestorAprovador: null,
    mesReferencia: '2026-07',
    dataSolicitacao: new Date('2026-07-01'),
    dataAprovacao: null,
    dataCompra: null,
    reembolsado: false,
    dataReembolso: null,
    ...overrides,
  };
}

describe('calcularSaldoCaixa', () => {
  it('soma o valor sacado quando não há nenhuma compra em dinheiro/reembolso ainda', () => {
    const saques = [saque({ valor: 1000 })];
    expect(calcularSaldoCaixa(saques, [])).toBe(1000);
  });

  it('não conta a taxa do saque como dinheiro em caixa — só o valor sacado é dinheiro de verdade', () => {
    const saques = [saque({ valor: 1000, taxa: 15.9 })];
    expect(calcularSaldoCaixa(saques, [])).toBe(1000);
  });

  it('desconta compras já pagas em dinheiro do caixa ou reembolso', () => {
    const saques = [saque({ valor: 1000 })];
    const solicitacoes = [
      solicitacao({ status: 'comprado', formaPagamento: 'dinheiro_caixa', valorFinal: 300 }),
      solicitacao({ id: 'r2', status: 'comprado', formaPagamento: 'reembolso', valorFinal: 200 }),
    ];
    expect(calcularSaldoCaixa(saques, solicitacoes)).toBe(500);
  });

  it('não desconta compra paga no cartão — essa não sai do caixa', () => {
    const saques = [saque({ valor: 1000 })];
    const solicitacoes = [solicitacao({ status: 'comprado', formaPagamento: 'cartao', valorFinal: 300 })];
    expect(calcularSaldoCaixa(saques, solicitacoes)).toBe(1000);
  });

  it('não desconta compra em dinheiro que ainda não foi de fato comprada (status aprovado)', () => {
    const saques = [saque({ valor: 1000 })];
    const solicitacoes = [solicitacao({ status: 'aprovado', formaPagamento: 'dinheiro_caixa', valorEstimado: 300 })];
    expect(calcularSaldoCaixa(saques, solicitacoes)).toBe(1000);
  });

  it('usa o valor estimado se a compra em dinheiro ainda não tem valor final (caso defensivo)', () => {
    const saques = [saque({ valor: 1000 })];
    const solicitacoes = [
      solicitacao({ status: 'comprado', formaPagamento: 'dinheiro_caixa', valorEstimado: 250, valorFinal: null }),
    ];
    expect(calcularSaldoCaixa(saques, solicitacoes)).toBe(750);
  });

  it('acumula entre "meses" diferentes — é um saldo corrido, não filtra por mesReferencia', () => {
    const saques = [saque({ valor: 500, mesReferencia: '2026-06' }), saque({ id: 's2', valor: 300, mesReferencia: '2026-07' })];
    expect(calcularSaldoCaixa(saques, [])).toBe(800);
  });

  it('pode ficar negativo quando já se gastou mais em dinheiro do que se sacou', () => {
    const saques = [saque({ valor: 100 })];
    const solicitacoes = [solicitacao({ status: 'comprado', formaPagamento: 'dinheiro_caixa', valorFinal: 136.59 })];
    expect(calcularSaldoCaixa(saques, solicitacoes)).toBeCloseTo(-36.59);
  });
});

describe('calcularTotalComprometidoMes', () => {
  const MES = '2026-07';

  it('conta solicitações pendentes pelo valor estimado', () => {
    const solicitacoes = [solicitacao({ status: 'pendente', valorEstimado: 200 })];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(200);
  });

  it('conta solicitações aprovadas (ainda não compradas) pelo valor estimado', () => {
    const solicitacoes = [solicitacao({ status: 'aprovado', valorEstimado: 150 })];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(150);
  });

  it('conta compra finalizada no cartão pelo valor final', () => {
    const solicitacoes = [solicitacao({ status: 'comprado', formaPagamento: 'cartao', valorEstimado: 100, valorFinal: 128.5 })];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(128.5);
  });

  it('NÃO conta compra finalizada em dinheiro/reembolso — já foi contabilizada no saque que a financiou', () => {
    const solicitacoes = [
      solicitacao({ status: 'comprado', formaPagamento: 'dinheiro_caixa', valorFinal: 300 }),
      solicitacao({ id: 'r2', status: 'comprado', formaPagamento: 'reembolso', valorFinal: 200 }),
    ];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(0);
  });

  it('ignora solicitação recusada', () => {
    const solicitacoes = [solicitacao({ status: 'recusado', valorEstimado: 999 })];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(0);
  });

  it('ignora solicitação de outro mês', () => {
    const solicitacoes = [solicitacao({ status: 'pendente', valorEstimado: 999, mesReferencia: '2026-06' })];
    expect(calcularTotalComprometidoMes(solicitacoes, [], MES)).toBe(0);
  });

  it('soma o valor do saque + a taxa cobrada, no mês em que o saque caiu', () => {
    const saques = [saque({ valor: 1000, taxa: 15.9, mesReferencia: MES })];
    expect(calcularTotalComprometidoMes([], saques, MES)).toBe(1015.9);
  });

  it('trata taxa ainda não informada (null) como zero, sem quebrar a soma', () => {
    const saques = [saque({ valor: 1000, taxa: null, mesReferencia: MES })];
    expect(calcularTotalComprometidoMes([], saques, MES)).toBe(1000);
  });

  it('ignora saldo inicial (ajuste_inicial) — não é um saque real do cartão nesse mês', () => {
    const saques = [saque({ valor: 5000, tipo: 'ajuste_inicial', mesReferencia: MES })];
    expect(calcularTotalComprometidoMes([], saques, MES)).toBe(0);
  });

  it('combina solicitações e saques do mesmo mês, sem contar nada em duplicidade', () => {
    const solicitacoes = [
      solicitacao({ id: 'r1', status: 'pendente', valorEstimado: 100 }),
      solicitacao({ id: 'r2', status: 'comprado', formaPagamento: 'cartao', valorFinal: 50 }),
      solicitacao({ id: 'r3', status: 'comprado', formaPagamento: 'dinheiro_caixa', valorFinal: 999 }), // não deve entrar
    ];
    const saques = [saque({ valor: 200, taxa: 10, mesReferencia: MES })];
    expect(calcularTotalComprometidoMes(solicitacoes, saques, MES)).toBe(100 + 50 + 210);
  });
});
