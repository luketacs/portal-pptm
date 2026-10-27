export type ClasseIsolamento = 'A' | 'B' | 'F' | 'H';

// IEEE 43-2013 tabela 3 — define a resistência de isolamento mínima.
export type TipoBobina = 'pre_formada' | 'randomica' | 'antiga';

export type ResultadoEnsaio = 'aprovado' | 'reprovado';

// Instalado em campo ou reserva (no almoxarifado / oficina). Vale pra motor e trafo.
export type SituacaoEquipamento = 'instalado' | 'reserva';

// Como o motor é acionado. Só motor.
export type TipoAcionamento = 'partida_direta' | 'inversor' | 'soft_starter' | 'estrela_triangulo' | 'compensadora';

export interface Motor {
  id: string;
  tag: string;
  situacao: SituacaoEquipamento;
  // Instalado: equipamento que ele aciona. Reserva: de quais equipamentos é reserva.
  aplicacao: string | null;
  descricao: string | null;
  localInstalacao: string | null;
  fabricante: string | null;
  modelo: string | null;
  numeroSerie: string | null;
  potenciaKw: number | null;
  potenciaCv: number | null;
  tensaoV: number;
  correnteA: number | null;
  frequenciaHz: number | null;
  fatorServico: number | null;
  rotacaoRpm: number | null;
  tipoAcionamento: TipoAcionamento | null;
  classeIsolamento: ClasseIsolamento;
  tipoBobina: TipoBobina;
  observacoes: string | null;
  criadoPorNome: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarMotor = Omit<Motor, 'id' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;

// Uma linha da tabela do megôhmetro. Valores em MΩ; null = não medido.
export interface LeituraIsolamento {
  circuito: string; // 'A' | 'B' | 'C' | 'ABC' (fases juntas contra a terra)
  r30s: number | null;
  r1min: number | null;
  r10min: number | null;
  // Instrumento chegou no fundo de escala: o valor real é "maior que" o lido.
  foraEscala: boolean;
}

export interface Executante {
  nome: string;
  matricula: string;
}

// Arquivo anexado ao ensaio (foto da tela do instrumento, relatório, imagem térmica...).
export interface Anexo {
  url: string;
  nome: string;
  tipo: 'imagem' | 'pdf';
  legenda: string;
}

// Linha do histórico de situação do equipamento (gravada por trigger — 083).
export interface MovimentoEquipamento {
  id: string;
  equipamentoId: string;
  dataMovimento: string; // 'YYYY-MM-DD'
  situacaoAnterior: SituacaoEquipamento | null;
  situacaoNova: SituacaoEquipamento;
  aplicacaoAnterior: string | null;
  aplicacaoNova: string | null;
  localAnterior: string | null;
  localNovo: string | null;
  trocaId: string | null;
  substitutoTag: string | null;
  motivo: string | null;
  usuarioNome: string | null;
  createdAt: Date;
}

export interface EnsaioIsolamento {
  id: string;
  numero: number;
  equipamentoId: string;
  dataEnsaio: string; // 'YYYY-MM-DD'
  osNumero: string | null;
  instrumento: string | null;
  instrumentoModelo: string | null;
  tensaoAplicadaV: number;
  temperaturaAmbienteC: number;
  temperaturaEnrolamentoC: number | null;
  umidadePct: number | null;
  // Cópia da placa no dia do ensaio
  tensaoNominalV: number;
  classeIsolamento: ClasseIsolamento;
  tipoBobina: TipoBobina;
  medicoes: LeituraIsolamento[];
  resultado: ResultadoEnsaio;
  executantes: Executante[];
  observacoes: string | null;
  anexos: Anexo[];
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarEnsaio = Omit<EnsaioIsolamento,
  'id' | 'numero' | 'resultado' | 'criadoPorId' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;
