import { Anexo, ClasseIsolamento, Executante, SituacaoEquipamento } from './eletrica-ensaio.model';

export type Ligacao = 'D' | 'Y';
export type MeioIsolante = 'seco' | 'oleo';
export type MaterialEnrolamento = 'cobre' | 'aluminio';

// Enrolamento secundário: trafo comum tem 1 ("X"); o de 12 pulsos tem 2 ("1X" em Δ, "2X" em Y).
export interface Secundario {
  nome: string;
  tensaoV: number;
  ligacao: Ligacao;
}

export interface Transformador {
  id: string;
  tag: string;
  situacao: SituacaoEquipamento;
  aplicacao: string | null;
  descricao: string | null;
  localInstalacao: string | null;
  fabricante: string | null;
  modelo: string | null;
  numeroSerie: string | null;
  codigoProduto: string | null;
  normaFabricacao: string | null;
  potenciaKva: number | null;
  tensaoPrimariaV: number;
  ligacaoPrimaria: Ligacao;
  secundarios: Secundario[];
  frequenciaHz: number | null;
  relacaoTaps: string | null;
  meioIsolante: MeioIsolante;
  materialEnrolamento: MaterialEnrolamento;
  classeIsolamento: ClasseIsolamento;
  elevacaoTemperaturaC: number | null;
  refrigeracao: string | null;
  grauProtecao: string | null;
  classeAmbiental: string | null;
  massaKg: number | null;
  observacoes: string | null;
  criadoPorNome: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarTransformador = Omit<Transformador, 'id' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;

// Placa copiada no dia do ensaio + tap usado no TTR.
export interface CriterioTrafo {
  tensaoPrimariaV: number;
  tapTensaoV: number;
  ligacaoPrimaria: Ligacao;
  secundarios: Secundario[];
  meioIsolante: MeioIsolante;
  materialEnrolamento: MaterialEnrolamento;
  classeIsolamento: ClasseIsolamento;
}

// Isolamento: circuito = 'H-TE', 'H-1X', '1X-TE', '1X-2X'... Valores em MΩ.
export interface LeituraIsolamentoTrafo {
  circuito: string;
  tensaoV: number | null; // tensão CC aplicada nesse circuito
  r30s: number | null;
  r1min: number | null;
  r10min: number | null;
  foraEscala: boolean;
}

// Resistência ôhmica de um enrolamento: 3 leituras (mΩ).
export interface OhmicaEnrolamento {
  enrolamento: string; // 'H', '1X', '2X'
  pares: { par: string; valor: number | null }[];
}

// TTR de um secundário: 3 relações medidas.
export interface TtrSecundario {
  secundario: string;
  pares: { par: string; medida: number | null }[];
}

export interface EnsaioTrafo {
  id: string;
  numero: number;
  equipamentoId: string;
  dataEnsaio: string; // 'YYYY-MM-DD'
  osNumero: string | null;
  instrumento: string | null;
  instrumentoModelo: string | null;
  temperaturaAmbienteC: number;
  temperaturaEnrolamentoC: number | null;
  umidadePct: number | null;
  criterio: CriterioTrafo;
  isolamento: LeituraIsolamentoTrafo[];
  ohmica: OhmicaEnrolamento[];
  ttr: TtrSecundario[];
  resultado: 'aprovado' | 'reprovado';
  executantes: Executante[];
  observacoes: string | null;
  anexos: Anexo[];
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarEnsaioTrafo = Omit<EnsaioTrafo,
  'id' | 'numero' | 'resultado' | 'criadoPorId' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;
