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
  // Outros equipamentos que devem entrar no Quadro de LOTO com o MESMO status desta
  // OS (ex.: teste que exige mais de um equipamento rodando junto) — texto livre
  // separado por vírgula, mesmo padrão de `recursos`. null/vazio = só o campo
  // `equipamento` acima entra no quadro (comportamento de sempre).
  equipamentosRelacionados: string | null;
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
  // ao plano preventivo que ela cumpre (ver PlanoManutencao). null pra grande maioria.
  planoPreventivoId: string | null;
  // Checklist copiado do plano preventivo no momento da programação (ver
  // PlanoManutencao.atividades) — null pra OS que não nasceu de um plano.
  checklist: string[] | null;
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
  equipamentosRelacionados?: string;
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
  checklist?: string[];
}

// Periodicidade dos planos de manutenção preventiva — mesmos textos usados no export
// do SIGMA ("Unid.Manut."), preservados como vieram pra não precisar traduzir na hora
// de exibir.
export type PeriodicidadeUnidade = 'Dia(s)' | 'Semana(s)' | 'Mes(es)';

// Plano mestre de manutenção preventiva (ver migration 032) — substitui o antigo
// PlanoPreventivo (import bruto do SIGMA em manutencao_planos_preventivos). "Última
// execução" não é mais um campo mutável aqui: é derivada do ciclo mais recente em
// CicloManutencao (ver proximaExecucaoPlano em utils/manutencao-planos.ts).
export interface PlanoManutencao {
  id: string;
  codigo: string; // gerado no banco, "PM-0001"
  nome: string;
  equipamento: string;
  tagKks: string | null;
  area: ManutencaoArea;
  especialidade: string | null;
  descricao: string;
  atividades: string[]; // checklist
  periodicidadeValor: number;
  periodicidadeUnidade: PeriodicidadeUnidade;
  dataInicial: string; // 'YYYY-MM-DD'
  responsavel: string | null;
  tempoEstimadoHoras: number | null;
  hhEstimado: number | null;
  observacoes: string | null;
  ativo: boolean;
  // Número da OS já aberta/reservada no SIGMA pra esse plano, anotado antes dele ser
  // programado de fato (ver programarDaPreventiva) — some assim que vira uma OS real.
  numeroOsReservado: string | null;
  // Status de LOTO que essa manutenção sempre exige (ex.: teste que precisa do
  // equipamento rodando) — pré-preenche o campo LOTO da Nova OS ao programar (ver
  // programarDaPreventiva), mesmas opções de LOTO_OPCOES ('LOTO'|'SEM LOTO'|
  // 'FUNCIONANDO'). null = sem padrão, continua em branco pra escolher na hora.
  lotoPadrao: string | null;
  // Outros equipamentos que devem entrar no Quadro de LOTO junto com o principal
  // sempre que esse plano for programado (ex.: teste que envolve vários equipamentos
  // ao mesmo tempo) — texto livre separado por vírgula, pré-preenche a Nova OS.
  equipamentosRelacionados: string | null;
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  atualizadoPorId: string | null;
  atualizadoPorNome: string | null;
  atualizadoEm: Date;
}

export interface CreatePlanoManutencaoRequest {
  nome: string;
  equipamento: string;
  tagKks?: string;
  area: ManutencaoArea;
  especialidade?: string;
  descricao: string;
  atividades?: string[];
  periodicidadeValor: number;
  periodicidadeUnidade: PeriodicidadeUnidade;
  dataInicial: string;
  responsavel?: string;
  tempoEstimadoHoras?: number;
  hhEstimado?: number;
  observacoes?: string;
  ativo?: boolean; // default true no service
  lotoPadrao?: string;
  equipamentosRelacionados?: string;
}

export interface EditarPlanoManutencaoRequest {
  nome: string;
  equipamento: string;
  tagKks: string | null;
  area: ManutencaoArea;
  especialidade: string | null;
  descricao: string;
  atividades: string[];
  periodicidadeValor: number;
  periodicidadeUnidade: PeriodicidadeUnidade;
  dataInicial: string;
  responsavel: string | null;
  tempoEstimadoHoras: number | null;
  hhEstimado: number | null;
  observacoes: string | null;
  ativo: boolean;
  lotoPadrao: string | null;
  equipamentosRelacionados: string | null;
}

// Ledger de duplicidade — uma linha por ocorrência já programada de um plano (ver
// migration 032). UNIQUE(planoId, dataPrevista) é o que impede gerar duas ordens pro
// mesmo ciclo. Só é gravado depois que a ordem já existe (ver
// ManutencaoPlanosService.registrarCiclo) — não modela um lifecycle de status (isso
// fica pra uma fase 2, junto com reprogramação avançada).
export interface CicloManutencao {
  id: string;
  planoId: string;
  dataPrevista: string; // 'YYYY-MM-DD'
  ordemId: string;
  createdAt: Date;
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
  equipamentosRelacionados: string | null;
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
  checklist: string[] | null;
}
