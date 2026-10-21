import { Anexo, Executante, ResultadoEnsaio } from './eletrica-ensaio.model';

// Como cada ponto é avaliado:
// - 'conexao': componente elétrico (terminal, barramento, cabo, conexão) — NETA 100.18,
//   pelo ΔT contra o ambiente e contra os similares do mesmo grupo.
// - 'similares': só entre similares do grupo (ex.: bobinas A/B/C do trafo seco, que
//   trabalham bem acima do ambiente por projeto).
// - 'limite': temperatura máxima do fabricante (ex.: mancal 90 °C do manual).
// - 'registro': só registra a temperatura (ex.: carcaça), sem critério.
export type CriterioPonto = 'conexao' | 'similares' | 'limite' | 'registro';

export interface PontoTermografia {
  ponto: string;
  grupo: string | null; // pontos com o mesmo grupo são comparados entre si
  criterio: CriterioPonto;
  temperaturaC: number | null;
  limiteC: number | null;
}

export interface CondicoesTermografia {
  cargaPct: number | null;
  emissividade: number | null;
  distanciaM: number | null;
}

export interface EnsaioTermografia {
  id: string;
  numero: number;
  equipamentoId: string;
  dataEnsaio: string; // 'YYYY-MM-DD'
  osNumero: string | null;
  instrumento: string | null;
  instrumentoModelo: string | null;
  temperaturaAmbienteC: number;
  umidadePct: number | null;
  condicoes: CondicoesTermografia;
  pontos: PontoTermografia[];
  resultado: ResultadoEnsaio;
  executantes: Executante[];
  observacoes: string | null;
  anexos: Anexo[];
  criadoPorId: string | null;
  criadoPorNome: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SalvarTermografia = Omit<EnsaioTermografia,
  'id' | 'numero' | 'resultado' | 'criadoPorId' | 'criadoPorNome' | 'createdAt' | 'updatedAt'>;
