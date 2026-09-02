export type ManutencaoArea = 'ELETRICA' | 'MECANICA' | 'APOIO';
// Vem direto do SIGMA (ex.: "PEND", "EXPA") — o Portal não controla essa transição, só
// exibe/edita o que o SIGMA já informa. Texto livre, não uma lista fechada de valores.
export type ManutencaoStatus = string;
// 'ordem' = OS de verdade (padrão). 'folga'/'treinamento'/'exame_medico' marcam o
// técnico indisponível naqueles dias — usa os mesmos campos de técnico/semana/dias,
// sem OS/equipamento/LOTO.
export type ManutencaoTipo = 'ordem' | 'folga' | 'treinamento' | 'exame_medico';

export interface ManutencaoOrdem {
  id: string;
  tipo: ManutencaoTipo;
  area: ManutencaoArea;
  semanaInicio: string; // 'YYYY-MM-DD', segunda-feira da semana
  numeroOs: string | null;
  // true = esse serviço não tem (e nunca vai ter) OS no SIGMA — ex.: revisão de
  // planos. Diferente de numeroOs vazio sem essa marca, que significa "OS existe mas
  // ainda não foi criada no ERP" (aparece como "CRIAR OS").
  semOs: boolean;
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
  semOs?: boolean;
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

// Cadastro de empresas/equipes do Apoio e da escala de turno — editável só por Admin,
// direto na tela de Programação do Apoio (antes vinham de arquivos fixos no código).
export interface EquipeApoioItem {
  id: string;
  nome: string;
}

export interface OperadorEscalaApoio {
  id: string;
  nome: string;
  equipe: 'A' | 'B' | 'C' | 'D';
}

export interface EditarManutencaoOrdemRequest {
  tipo: ManutencaoTipo;
  area: ManutencaoArea;
  numeroOs: string | null;
  semOs: boolean;
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
