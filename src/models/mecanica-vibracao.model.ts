import { Anexo } from './eletrica-ensaio.model';

// Análise de Vibração (menu Mecânica) — migration 088.

export type Grandeza = 'envelope' | 'velocidade' | 'aceleracao' | 'deslocamento' | 'temperatura';
export type GrupoIso = '1' | '2' | '3' | '4';
export type Fundacao = 'rigida' | 'flexivel';
// Status do relatório = zona da ISO 20816-3 (A melhor, D pior).
export type Situacao = 'A' | 'B' | 'C' | 'D';
// Resultado do alarme do SKF em um ponto.
export type Alarme = 'normal' | 'alerta' | 'perigo';
export type TipoInspecao = 'programada' | 'emergencia';

// Coletor do inspetor (migration 089): preenchido uma vez, copiado em cada análise.
export interface ColetorInspetor {
  coletor: string;
  sensor: string | null;
  numeroSerie: string | null;
  calibracaoValidade: string | null;
}

export interface FatoresRolamento {
  bpfo: number | null;
  bpfi: number | null;
  bsf: number | null;
  ftf: number | null;
}

export interface EquipamentoVibracao {
  id: string;
  tag: string;
  descricao: string | null;
  area: string | null;
  tipoMaquina: string | null;
  fabricante: string | null;
  modelo: string | null;
  potenciaKw: number | null;
  rotacaoRpm: number | null;
  grupoIso: GrupoIso | null;
  fundacao: Fundacao | null;
  desenhoUrl: string | null;
  observacoes: string | null;
  criadoPorNome: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarEquipamentoVibracao = Omit<EquipamentoVibracao, 'id' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;

export interface PontoMedicao {
  id: string;
  equipamentoId: string;
  nome: string;
  descricao: string | null;
  grandeza: Grandeza;
  unidade: string;
  alarmeAlerta: number | null;
  alarmePerigo: number | null;
  rolamento: string | null;
  fatores: FatoresRolamento;
  ordem: number;
  ativo: boolean;
}

// id null = ponto novo.
export type SalvarPonto = Omit<PontoMedicao, 'id' | 'equipamentoId'> & { id: string | null };

// Cópia do ponto no dia + valores medidos.
export interface LeituraVibracao {
  pontoId: string | null;
  ponto: string;
  grandeza: Grandeza;
  unidade: string;
  valor: number | null;
  alarmeAlerta: number | null;
  alarmePerigo: number | null;
  fatorCrista: number | null;
  curtose: number | null;
  frequenciaHz: number | null;
  observacao: string | null;
}

export interface AnaliseVibracao {
  id: string;
  numero: number;
  equipamentoId: string;
  dataColeta: string;
  rotacaoRpm: number | null;
  condicaoOperacao: string | null;
  osNumero: string | null;
  tipoInspecao: TipoInspecao;
  gestorArea: string | null;
  instrumento: string | null;
  sensor: string | null;
  instrumentoSerie: string | null;
  calibracaoValidade: string | null;
  leituras: LeituraVibracao[];
  modosFalha: string[];
  diagnostico: string | null;
  recomendacao: string | null;
  conclusao: string | null;
  prazo: string | null;
  situacao: Situacao;
  situacaoSugerida: Situacao | null;
  anexos: Anexo[];
  observacoes: string | null;
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarAnalise = Omit<AnaliseVibracao, 'id' | 'numero' | 'situacaoSugerida' | 'criadoPorId' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;
