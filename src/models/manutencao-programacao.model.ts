export type ManutencaoArea = 'ELETRICA' | 'MECANICA' | 'APOIO';
// Vem direto do SIGMA (ex.: "PEND", "EXPA") — o Portal não controla essa transição, só
// exibe/edita o que o SIGMA já informa. Texto livre, não uma lista fechada de valores.
export type ManutencaoStatus = string;
// 'ordem' = OS de verdade (padrão). 'folga'/'treinamento'/'exame_medico' marcam o
// técnico indisponível naqueles dias — usa os mesmos campos de técnico/semana/dias,
// sem OS/equipamento/LOTO. 'reuniao' é um aviso pra toda a equipe (lançado em lote,
// igual feriado), com horário/local próprios — não bloqueia o resto da agenda do dia.
export type ManutencaoTipo = 'ordem' | 'folga' | 'treinamento' | 'exame_medico' | 'reuniao';

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
  reuniaoHorario: string | null; // 'HH:mm', só pra tipo 'reuniao'
  reuniaoLocal: string | null;
  // Preenchido só quando a OS nasceu do painel "Preventivas da semana" — liga essa OS
  // ao plano preventivo que ela cumpre (ver PlanoPreventivo). null pra grande maioria.
  planoPreventivoId: string | null;
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
  reuniaoHorario?: string;
  reuniaoLocal?: string;
  planoPreventivoId?: string;
}

// Periodicidade dos planos de manutenção preventiva — mesmos textos usados no export
// do SIGMA ("Unid.Manut."), preservados como vieram pra não precisar traduzir na hora
// de exibir.
export type PeriodicidadeUnidade = 'Dia(s)' | 'Semana(s)' | 'Mes(es)';

// Plano mestre de manutenção preventiva — cadastro nativo (ver migration 028),
// populado 1x a partir do export do SIGMA. "Última execução" avança quando a OS é
// programada no Portal (ver ManutencaoProgramacaoService.avancarPreventiva), não
// depende do SIGMA confirmar apontamento.
export interface PlanoPreventivo {
  id: string;
  bem: string;
  nomeBem: string;
  servico: string;
  nomeServico: string;
  sequencia: string;
  nomeManut: string;
  area: ManutencaoArea;
  // Só preenchido quando area='APOIO': 'SERVPLEX' (ex-REFR) ou 'OPERAÇÃO' (ex-OPER) —
  // única opção real de "técnico" (equipe) do Apoio pra esse plano.
  tecnicoApoio: string | null;
  periodicidadeValor: number;
  periodicidadeUnidade: PeriodicidadeUnidade;
  ultimaExecucao: string | null; // 'YYYY-MM-DD', null = nunca executada
  ativo: boolean;
  // Número da OS já aberta/reservada no SIGMA pra esse plano, anotado antes dele ser
  // programado de fato (ver programarDaPreventiva) — some assim que vira uma OS real.
  numeroOsReservado: string | null;
}

// Período em que a planta ficou parada (a empresa não opera 24h/dia) — enquanto
// `dataFim` for null, a parada está em andamento. Admin-only (ver migration 029):
// enquanto ativa, planos preventivos de ciclo curto (dias/semanas) são calculados
// como mensais (ver periodicidadeEfetiva em manutencao-preventivas.ts).
export interface ParadaPlanta {
  id: string;
  dataInicio: string;
  dataFim: string | null;
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
  executante: string; // matrícula de quem apontou (campo "Executante" do export)
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

export interface RecursoEspecialItem {
  id: string;
  opcao: string;
  empresaApoio: string;
}

export interface OperadorEscalaApoio {
  id: string;
  nome: string;
  equipe: 'A' | 'B' | 'C' | 'D';
}

// Período de férias de um técnico — diferente de Folga (semanal), dura várias
// semanas. Usado pra avisar/bloquear lançamento de atividade pro técnico nesse
// período. Só faz sentido pra Elétrica/Mecânica (Apoio programa por empresa).
export interface FeriasTecnico {
  id: string;
  tecnicoNome: string;
  tecnicoMatricula: string | null;
  area: ManutencaoArea;
  dataInicio: string; // ISO 'YYYY-MM-DD'
  dataFim: string;    // ISO 'YYYY-MM-DD'
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
  reuniaoHorario: string | null;
  reuniaoLocal: string | null;
  planoPreventivoId: string | null;
}
