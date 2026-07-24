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
  compradorId: string | null;   // quem ficou responsável por fazer a compra
  compradorNome: string | null;
  gestorAprovador: string | null; // gestor (fora do portal) associado, só para listas/relatórios
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
  gestorAprovador?: string;
  // Só usado por Admin registrando em nome de outra pessoa / direcionando a compra.
  solicitanteId?: string;
  solicitanteNome?: string;
  compradorId?: string;
  compradorNome?: string;
}

// Saque em dinheiro do cartão — vira saldo em caixa (usado depois em compras
// pagas em 'dinheiro_caixa' ou 'reembolso'). A taxa cobrada no saque também
// conta no total do mês, pois aparece na fatura do cartão.
export type FundoFixoSaqueTipo = 'saque' | 'ajuste_inicial';

export interface FundoFixoSaque {
  id: string;
  valor: number;
  taxa: number | null; // null = ainda não sei (só se descobre no fechamento da fatura)
  tipo: FundoFixoSaqueTipo;
  dataSaque: Date;
  mesReferencia: string; // 'YYYY-MM'
  observacoes: string | null;
  registradoPorId: string | null;
  registradoPorNome: string;
  createdAt: Date;
}

export interface CreateFundoFixoSaque {
  valor: number;
  taxa?: number;
  tipo?: FundoFixoSaqueTipo; // default 'saque'
  dataSaque?: string; // 'YYYY-MM-DD', default hoje
  observacoes?: string;
}
