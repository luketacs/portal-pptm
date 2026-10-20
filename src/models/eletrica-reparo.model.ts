export type ReparoStatus =
  | 'aberto' | 'em_analise' | 'aguardando_orcamento' | 'orcamento_recebido'
  | 'em_reparo' | 'disponivel_teste' | 'concluido' | 'reparo_inviavel' | 'cancelado';

export type ReparoGarantia = 'vigente' | 'expirada' | 'nao_sei';

export interface ReparoDefeito {
  titulo: string;
  sintoma: string;
  evolucao: string;
  situacaoAtual: string;
  causaProvavel: string;
}

export interface ReparoFoto {
  url: string;
  legenda: string;
}

export interface ReparoExterno {
  id: string;
  numero: number;
  solicitanteId: string | null;
  solicitanteNome: string;
  // 1. Identificação do equipamento
  equipamento: string;
  fabricanteModelo: string | null;
  numeroSerie: string | null;
  tagSap: string | null;
  localizacao: string | null;
  tempoOperacao: string | null;
  // 2. Resumo da ocorrência
  resumo: string;
  // 3. Defeitos
  defeitos: ReparoDefeito[];
  // 4. Verificações em campo
  verificacoes: string[];
  verificacaoResultado: string | null;
  // 5. Histórico
  dataInicioSintomas: string | null; // 'YYYY-MM-DD'
  dataFalhaTotal: string | null;
  intervencoesAnteriores: string | null;
  garantia: ReparoGarantia | null;
  // 6. Serviço solicitado
  servicoSolicitado: string;
  // 7. Contato
  contatoNome: string | null;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  // 8. Fotos
  fotos: ReparoFoto[];
  // Controle (supervisor de elétrica)
  status: ReparoStatus;
  statusObservacao: string | null;
  statusAtualizadoEm: Date | null;
  statusAtualizadoPor: string | null;
  fornecedor: string | null;
  valorOrcamento: number | null;
  nfRemessa: string | null;
  previsaoRetorno: string | null; // 'YYYY-MM-DD'
  teamsEnviadoEm: Date | null;
  createdAt: Date;
}

export interface ReparoHistorico {
  id: string;
  status: ReparoStatus;
  observacao: string | null;
  usuarioNome: string | null;
  createdAt: Date;
}

export type CreateReparoExterno = Omit<ReparoExterno,
  'id' | 'numero' | 'solicitanteId' | 'solicitanteNome' | 'fotos' | 'status' | 'statusObservacao'
  | 'statusAtualizadoEm' | 'statusAtualizadoPor' | 'fornecedor' | 'valorOrcamento' | 'nfRemessa'
  | 'previsaoRetorno' | 'teamsEnviadoEm' | 'createdAt'>;

export interface AtualizarStatusReparo {
  status: ReparoStatus;
  observacao?: string;
  fornecedor?: string | null;
  valorOrcamento?: number | null;
  nfRemessa?: string | null;
  previsaoRetorno?: string | null;
}
