import { ResultadoEnsaio } from '../models/eletrica-ensaio.model';
import { CriterioPonto, PontoTermografia } from '../models/eletrica-termografia.model';

// Termografia pela ANSI/NETA MTS, tabela 100.18 (prioridade da ação pela diferença de
// temperatura), para componentes elétricos:
//   Prioridade | ΔT entre similares | ΔT contra o ambiente | Ação
//   4          | 1 a 3 °C           | 1 a 10 °C            | possível deficiência — investigar
//   3          | 4 a 15 °C          | 11 a 20 °C           | deficiência provável — reparar quando possível
//   2          | —                  | 21 a 40 °C           | monitorar até a correção
//   1          | > 15 °C            | > 40 °C              | discrepância grave — reparar imediatamente
// A tabela é para conexões/componentes elétricos. Carcaça de motor e bobina de trafo
// trabalham bem acima do ambiente por projeto, então cada ponto escolhe o critério
// (ver CriterioPonto). Mancal: limite do fabricante (ex.: 90 °C do manual WEG) — passou
// do limite = prioridade 1; até 10 °C abaixo = prioridade 3.
// Resultado: reprovado se algum ponto ficar em prioridade 1 ou 2; 3 e 4 aprovam com aviso.

export type Prioridade = 1 | 2 | 3 | 4;

export const PRIORIDADE_ACAO: Record<Prioridade, string> = {
  1: 'Reparar imediatamente',
  2: 'Monitorar até corrigir',
  3: 'Reparar quando possível',
  4: 'Investigar',
};

export const PRIORIDADE_BADGE: Record<Prioridade, string> = {
  1: 'bg-red-100 text-red-800',
  2: 'bg-orange-100 text-orange-800',
  3: 'bg-amber-100 text-amber-800',
  4: 'bg-yellow-50 text-yellow-800',
};

export const CRITERIO_PONTO_LABEL: Record<CriterioPonto, string> = {
  conexao: 'Conexão / componente elétrico (NETA)',
  similares: 'Só entre similares',
  limite: 'Limite do fabricante',
  registro: 'Só registrar',
};

export const CRITERIOS_PONTO: CriterioPonto[] = ['conexao', 'similares', 'limite', 'registro'];

export function prioridadeAmbiente(dT: number): Prioridade | null {
  if (dT > 40) return 1;
  if (dT > 20) return 2;
  if (dT > 10) return 3;
  if (dT >= 1) return 4;
  return null;
}

export function prioridadeSimilares(dT: number): Prioridade | null {
  if (dT > 15) return 1;
  if (dT > 3) return 3;
  if (dT >= 1) return 4;
  return null;
}

const pior = (...ps: (Prioridade | null)[]): Prioridade | null => {
  const v = ps.filter((p): p is Prioridade => p !== null);
  return v.length ? (Math.min(...v) as Prioridade) : null;
};

export interface AvaliacaoPonto {
  ponto: string;
  dTAmbiente: number | null;
  dTSimilares: number | null; // em relação ao mais frio do grupo
  prioridade: Prioridade | null; // null = sem anomalia
  motivo: string | null;
  pendente: boolean;
}

export function avaliarPontos(pontos: PontoTermografia[], ambienteC: number): AvaliacaoPonto[] {
  const frioPorGrupo = new Map<string, number>();
  pontos.forEach(p => {
    if (!p.grupo || p.temperaturaC === null) return;
    const atual = frioPorGrupo.get(p.grupo);
    frioPorGrupo.set(p.grupo, atual === undefined ? p.temperaturaC : Math.min(atual, p.temperaturaC));
  });
  const tamanhoGrupo = (g: string) => pontos.filter(p => p.grupo === g && p.temperaturaC !== null).length;

  return pontos.map(p => {
    if (p.temperaturaC === null || !Number.isFinite(p.temperaturaC)) {
      return { ponto: p.ponto, dTAmbiente: null, dTSimilares: null, prioridade: null, motivo: null, pendente: true };
    }
    const t = p.temperaturaC;
    const dTAmbiente = t - ambienteC;
    const dTSimilares = p.grupo && tamanhoGrupo(p.grupo) > 1 ? t - (frioPorGrupo.get(p.grupo) ?? t) : null;

    let prioridade: Prioridade | null = null;
    let motivo: string | null = null;
    if (p.criterio === 'conexao') {
      const pa = prioridadeAmbiente(dTAmbiente);
      const ps = dTSimilares !== null ? prioridadeSimilares(dTSimilares) : null;
      prioridade = pior(pa, ps);
      if (prioridade !== null) motivo = ps !== null && ps === prioridade ? 'ΔT entre similares' : 'ΔT contra o ambiente';
    } else if (p.criterio === 'similares') {
      prioridade = dTSimilares !== null ? prioridadeSimilares(dTSimilares) : null;
      if (prioridade !== null) motivo = 'ΔT entre similares';
    } else if (p.criterio === 'limite' && p.limiteC !== null) {
      if (t > p.limiteC) { prioridade = 1; motivo = 'Acima do limite do fabricante'; }
      else if (t > p.limiteC - 10) { prioridade = 3; motivo = 'Até 10 °C do limite do fabricante'; }
    }
    // pendente: critério de limite sem limite informado.
    const pendente = p.criterio === 'limite' && p.limiteC === null;
    return { ponto: p.ponto, dTAmbiente, dTSimilares, prioridade, motivo, pendente };
  });
}

export function resultadoTermografia(avaliacoes: AvaliacaoPonto[]): ResultadoEnsaio | null {
  if (!avaliacoes.length || avaliacoes.some(a => a.pendente)) return null;
  return avaliacoes.some(a => a.prioridade === 1 || a.prioridade === 2) ? 'reprovado' : 'aprovado';
}

export function piorPrioridade(avaliacoes: AvaliacaoPonto[]): Prioridade | null {
  return pior(...avaliacoes.map(a => a.prioridade));
}

// Pontos sugeridos ao abrir o formulário (dá pra apagar, renomear e incluir outros).
export function pontosPadrao(tipo: 'motor' | 'transformador'): PontoTermografia[] {
  const p = (ponto: string, grupo: string | null, criterio: CriterioPonto, limiteC: number | null = null): PontoTermografia =>
    ({ ponto, grupo, criterio, temperaturaC: null, limiteC });
  if (tipo === 'motor') {
    return [
      p('Conexão fase A (caixa de ligação)', 'Conexões', 'conexao'),
      p('Conexão fase B (caixa de ligação)', 'Conexões', 'conexao'),
      p('Conexão fase C (caixa de ligação)', 'Conexões', 'conexao'),
      p('Mancal dianteiro (LA)', null, 'limite', 90),
      p('Mancal traseiro (LOA)', null, 'limite', 90),
      p('Carcaça', null, 'registro'),
    ];
  }
  return [
    p('Conexão H fase A', 'Conexões H', 'conexao'),
    p('Conexão H fase B', 'Conexões H', 'conexao'),
    p('Conexão H fase C', 'Conexões H', 'conexao'),
    p('Conexão X fase A', 'Conexões X', 'conexao'),
    p('Conexão X fase B', 'Conexões X', 'conexao'),
    p('Conexão X fase C', 'Conexões X', 'conexao'),
    p('Bobina fase A', 'Bobinas', 'similares'),
    p('Bobina fase B', 'Bobinas', 'similares'),
    p('Bobina fase C', 'Bobinas', 'similares'),
  ];
}

export function formatarTemp(v: number | null | undefined, sinal = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const t = v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${sinal && v > 0 ? '+' : ''}${t} °C`;
}
