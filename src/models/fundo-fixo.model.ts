export type FundoFixoSetor = 'Manutenção' | 'Operação' | 'Infraestrutura' | 'Outros';
export type FundoFixoStatus = 'pendente' | 'aprovado' | 'recusado' | 'comprado';
export type FundoFixoFormaPagamento = 'cartao' | 'dinheiro_caixa' | 'reembolso';

export interface FundoFixoSolicitacao {
  id: string;
  solicitanteId: string | null;
  solicitanteNome: string;
  setor: FundoFixoSetor;
  fornecedor: string | null;
  material: string;
  linkProduto: string | null;
  valorEstimado: number;
  valorFinal: number | null;
  formaPagamento: FundoFixoFormaPagamento;
  orcamentoUrl: string | null;
  notaFiscalUrl: string | null;
  observacoes: string | null;
  status: FundoFixoStatus;
  aprovadorId: string | null;
  aprovadorNome: string | null;
  motivoRecusa: string | null;
  mesReferencia: string; // 'YYYY-MM'
  dataSolicitacao: Date;
  dataAprovacao: Date | null;
  dataCompra: Date | null;
}

export interface CreateFundoFixoRequest {
  setor: FundoFixoSetor;
  fornecedor?: string;
  material: string;
  linkProduto?: string;
  valorEstimado: number;
  observacoes?: string;
}

// Saque em dinheiro do cartão — vira saldo em caixa (usado depois em compras
// pagas em 'dinheiro_caixa' ou 'reembolso'). A taxa cobrada no saque também
// conta no total do mês, pois aparece na fatura do cartão.
export interface FundoFixoSaque {
  id: string;
  valor: number;
  taxa: number;
  dataSaque: Date;
  mesReferencia: string; // 'YYYY-MM'
  observacoes: string | null;
  registradoPorId: string | null;
  registradoPorNome: string;
  createdAt: Date;
}

export interface CreateFundoFixoSaque {
  valor: number;
  taxa: number;
  dataSaque?: string; // 'YYYY-MM-DD', default hoje
  observacoes?: string;
}
