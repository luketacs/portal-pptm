export type FundoFixoSetor = 'Manutenção' | 'Operação' | 'Infraestrutura' | 'Outros';
export type FundoFixoStatus = 'pendente' | 'aprovado' | 'recusado' | 'comprado';

export interface FundoFixoSolicitacao {
  id: string;
  solicitanteId: string | null;
  solicitanteNome: string;
  setor: FundoFixoSetor;
  fornecedor: string | null;
  material: string;
  valorEstimado: number;
  valorFinal: number | null;
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
  valorEstimado: number;
  observacoes?: string;
}
