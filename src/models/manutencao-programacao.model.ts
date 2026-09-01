export type ManutencaoArea = 'ELETRICA' | 'MECANICA' | 'APOIO';
// Vem direto do SIGMA (ex.: "PEND", "EXPA") — o Portal não controla essa transição, só
// exibe/edita o que o SIGMA já informa. Texto livre, não uma lista fechada de valores.
export type ManutencaoStatus = string;
// 'ordem' = OS de verdade (padrão). 'folga'/'treinamento' marcam o técnico indisponível
// naqueles dias — usa os mesmos campos de técnico/semana/dias, sem OS/equipamento/LOTO.
export type ManutencaoTipo = 'ordem' | 'folga' | 'treinamento';

export interface ManutencaoOrdem {
  id: string;
  tipo: ManutencaoTipo;
  area: ManutencaoArea;
  semanaInicio: string; // 'YYYY-MM-DD', segunda-feira da semana
  numeroOs: string | null;
  descricao: string;
  equipamento: string | null;
  recursos: string | null;
  loto: string | null;
  areaAtuacao: string | null;
  duracaoHoras: number | null;
  tipoServico: string | null; // 'CORRETIVA' | 'PREVENTIVA' | 'MELHORIA' (texto livre, igual status)
  tecnicoNome: string;
  tecnicoMatricula: string | null;
  diasPrevistos: string[]; // ['YYYY-MM-DD', ...] dentro da semana
  status: ManutencaoStatus;
  observacoes: string | null;
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
}

export interface CreateManutencaoOrdemRequest {
  tipo?: ManutencaoTipo; // default 'ordem' no service se não informado
  area: ManutencaoArea;
  semanaInicio: string;
  numeroOs?: string;
  descricao: string;
  equipamento?: string;
  recursos?: string;
  loto?: string;
  areaAtuacao?: string;
  duracaoHoras?: number;
  tipoServico?: string;
  tecnicoNome: string;
  tecnicoMatricula?: string;
  diasPrevistos: string[];
  status?: string; // default 'PEND' no service se não informado
  observacoes?: string;
}

// Retorno do proxy /api/sigma-ordens-proxy (consulta às exportações do SIGMA — mesmos
// links que a planilha "Fechamento Semanal.2.xlsx" usa via Dados Externos/Power Query).
export interface SigmaOrdemInfo {
  descricao: string;
  equipamento: string;
  areaManutencao: string;
  statusCodigo: string;
  tipoServico: string;
}

export interface SigmaApontamento {
  data: string; // 'YYYY-MM-DD'
  status: string;
}

export interface ConsultaSigmaResultado {
  os: SigmaOrdemInfo | null;
  apontamentos: SigmaApontamento[];
}

// Item do backlog do SIGMA — OS aberta (não concluída/cancelada) de uma área, que
// ainda não foi lançada na nossa programação. Ajuda a montar a semana a partir do que
// já existe no ERP em vez de digitar o número de cada OS manualmente.
export interface SigmaBacklogItem {
  numeroOs: string;
  descricao: string;
  equipamento: string;
  statusCodigo: string;
  tipoServico: string;
}

export interface EditarManutencaoOrdemRequest {
  tipo: ManutencaoTipo;
  area: ManutencaoArea;
  numeroOs: string | null;
  descricao: string;
  equipamento: string | null;
  recursos: string | null;
  loto: string | null;
  areaAtuacao: string | null;
  duracaoHoras: number | null;
  tipoServico: string | null;
  tecnicoNome: string;
  tecnicoMatricula: string | null;
  diasPrevistos: string[];
  status: string;
  observacoes: string | null;
}
