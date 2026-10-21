export type ClasseIsolamento = 'A' | 'B' | 'F' | 'H';

// IEEE 43-2013 tabela 3 — define a resistência de isolamento mínima.
export type TipoBobina = 'pre_formada' | 'randomica' | 'antiga';

export type ResultadoEnsaio = 'aprovado' | 'reprovado';

export interface Motor {
  id: string;
  tag: string;
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
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarEnsaio = Omit<EnsaioIsolamento,
  'id' | 'numero' | 'resultado' | 'criadoPorId' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;
