import {
  ClasseIsolamento, EnsaioIsolamento, LeituraIsolamento, ResultadoEnsaio, SituacaoEquipamento, TipoAcionamento, TipoBobina,
} from '../models/eletrica-ensaio.model';

// Avaliação de resistência de isolamento de máquinas girantes pela IEEE 43-2013
// ("Recommended Practice for Testing Insulation Resistance of Electric Machinery"):
// - IR de 1 min corrigida para 40 °C (seção 6.4): R40 = R(T) × 0,5^((40 − T)/10) —
//   a resistência cai pela metade a cada 10 °C de aumento.
// - Mínimo de IR1min a 40 °C (tabela 3) pelo tipo de bobina.
// - Índice de polarização IP = R10min / R1min, mínimo pela classe térmica (tabela 4).
//   Não se aplica se IR1min a 40 °C passar de 5000 MΩ (seção 12.2.1) nem com leitura
//   em fundo de escala (a razão perde o sentido).
// - IA (absorção, R1min / R30s) não tem critério na norma: só informativo.
// Usado na tela, no PDF e pra gravar o resultado — uma regra só.

export const TEMPERATURA_REFERENCIA_C = 40;
export const IR_LIMITE_IP_MOHM = 5000;

export function numeroEnsaio(numero: number | null | undefined): string {
  return numero ? `EN-${String(numero).padStart(3, '0')}` : '';
}

// ── Tipo de acionamento (só motor) ──
export const TIPOS_ACIONAMENTO: TipoAcionamento[] = ['partida_direta', 'inversor', 'soft_starter', 'estrela_triangulo', 'compensadora'];

export const TIPO_ACIONAMENTO_LABEL: Record<TipoAcionamento, string> = {
  partida_direta: 'Partida direta',
  inversor: 'Inversor de frequência',
  soft_starter: 'Soft-starter',
  estrela_triangulo: 'Estrela-triângulo',
  compensadora: 'Chave compensadora',
};

// ── Situação do equipamento (motor e trafo) ──
export const SITUACOES: SituacaoEquipamento[] = ['instalado', 'reserva'];

export const SITUACAO_LABEL: Record<SituacaoEquipamento, string> = { instalado: 'Instalado', reserva: 'Reserva' };

// Cor neutra/informativa — verde e vermelho ficam pro resultado do ensaio.
export const SITUACAO_BADGE: Record<SituacaoEquipamento, string> = {
  instalado: 'bg-sky-100 text-sky-800',
  reserva: 'bg-violet-100 text-violet-800',
};

export function rotuloLocal(s: SituacaoEquipamento): string {
  return s === 'reserva' ? 'Local de armazenamento' : 'Local de instalação';
}

export function rotuloAplicacao(s: SituacaoEquipamento): string {
  return s === 'reserva' ? 'Reserva de' : 'Aplicação';
}

export const CLASSES_ISOLAMENTO: ClasseIsolamento[] = ['A', 'B', 'F', 'H'];

export const CLASSE_LABEL: Record<ClasseIsolamento, string> = {
  A: 'A (105 °C)',
  B: 'B (130 °C)',
  F: 'F (155 °C)',
  H: 'H (180 °C)',
};

export const TIPOS_BOBINA: TipoBobina[] = ['pre_formada', 'randomica', 'antiga'];

export const TIPO_BOBINA_LABEL: Record<TipoBobina, string> = {
  pre_formada: 'Pré-formada (motor de média tensão, fabricado após 1970)',
  randomica: 'Randômica (fios) ou pré-formada abaixo de 1 kV',
  antiga: 'Fabricado antes de 1970',
};

export const TIPO_BOBINA_CURTO: Record<TipoBobina, string> = {
  pre_formada: 'Pré-formada',
  randomica: 'Randômica / < 1 kV',
  antiga: 'Antes de 1970',
};

// Sugestão pro cadastro: motor de média tensão quase sempre tem bobina pré-formada.
export function tipoBobinaSugerido(tensaoV: number): TipoBobina {
  return tensaoV >= 1000 ? 'pre_formada' : 'randomica';
}

export const RESULTADO_LABEL: Record<ResultadoEnsaio, string> = {
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
};

export const RESULTADO_BADGE: Record<ResultadoEnsaio, string> = {
  aprovado: 'bg-green-100 text-green-800',
  reprovado: 'bg-red-100 text-red-800',
};

export const CIRCUITO_LABEL: Record<string, string> = {
  A: 'Fase A – Terra',
  B: 'Fase B – Terra',
  C: 'Fase C – Terra',
  ABC: 'Fases A+B+C – Terra',
};

export const circuitoLabel = (c: string) => CIRCUITO_LABEL[c] ?? c;

// Tabela 3 — mínimo de IR1min a 40 °C, em MΩ.
export function irMinimoMohm(tipo: TipoBobina, tensaoNominalV: number): number {
  if (tipo === 'pre_formada') return 100;
  if (tipo === 'randomica') return 5;
  return tensaoNominalV / 1000 + 1; // kV + 1
}

export function irMinimoTexto(tipo: TipoBobina): string {
  if (tipo === 'pre_formada') return '100 MΩ';
  if (tipo === 'randomica') return '5 MΩ';
  return 'kV + 1 MΩ';
}

// Tabela 4 — mínimo de IP pela classe térmica.
export function ipMinimo(classe: ClasseIsolamento): number {
  return classe === 'A' ? 1.5 : 2.0;
}

// Tabela 1 — tensão CC de ensaio recomendada pela tensão nominal (fase-fase) do enrolamento.
export function tensaoEnsaioRecomendada(tensaoNominalV: number): { min: number; max: number } {
  if (tensaoNominalV < 1000) return { min: 500, max: 500 };
  if (tensaoNominalV <= 2500) return { min: 500, max: 1000 };
  if (tensaoNominalV <= 5000) return { min: 1000, max: 2500 };
  if (tensaoNominalV <= 12000) return { min: 2500, max: 5000 };
  return { min: 5000, max: 10000 };
}

export function tensaoEnsaioAdequada(tensaoAplicadaV: number, tensaoNominalV: number): boolean {
  const { min, max } = tensaoEnsaioRecomendada(tensaoNominalV);
  return tensaoAplicadaV >= min && tensaoAplicadaV <= max;
}

// Fator Kt que leva a leitura da temperatura do ensaio para 40 °C.
export function fatorCorrecao40(temperaturaC: number): number {
  return Math.pow(0.5, (TEMPERATURA_REFERENCIA_C - temperaturaC) / 10);
}

// Temperatura usada na correção: a do enrolamento quando medida (é o que a norma pede);
// senão a ambiente — vale para motor parado há horas, em equilíbrio térmico.
export function temperaturaCorrecao(e: Pick<EnsaioIsolamento, 'temperaturaAmbienteC' | 'temperaturaEnrolamentoC'>): number {
  return e.temperaturaEnrolamentoC ?? e.temperaturaAmbienteC;
}

export type SituacaoItem = 'ok' | 'falha' | 'na' | 'pendente';

export interface AvaliacaoCircuito {
  circuito: string;
  r1min40: number | null;
  ia: number | null;
  ip: number | null;
  ir: SituacaoItem;
  ipSituacao: SituacaoItem;
  ipMotivoNa: string | null;
  // 'pendente' = falta leitura obrigatória (não dá pra concluir).
  situacao: 'aprovado' | 'reprovado' | 'pendente';
}

export interface CriterioEnsaio {
  tensaoNominalV: number;
  classeIsolamento: ClasseIsolamento;
  tipoBobina: TipoBobina;
  temperaturaC: number;
}

const valido = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function avaliarCircuito(l: LeituraIsolamento, c: CriterioEnsaio): AvaliacaoCircuito {
  const r1min40 = valido(l.r1min) ? l.r1min * fatorCorrecao40(c.temperaturaC) : null;
  const ia = valido(l.r1min) && valido(l.r30s) ? l.r1min / l.r30s : null;
  const ip = valido(l.r1min) && valido(l.r10min) ? l.r10min / l.r1min : null;

  const ir: SituacaoItem = r1min40 === null ? 'pendente'
    : r1min40 >= irMinimoMohm(c.tipoBobina, c.tensaoNominalV) ? 'ok' : 'falha';

  let ipSituacao: SituacaoItem;
  let ipMotivoNa: string | null = null;
  if (l.foraEscala) {
    ipSituacao = 'na';
    ipMotivoNa = 'Leitura em fundo de escala';
  } else if (r1min40 !== null && r1min40 > IR_LIMITE_IP_MOHM) {
    ipSituacao = 'na';
    ipMotivoNa = `IR 1 min a 40 °C acima de ${IR_LIMITE_IP_MOHM.toLocaleString('pt-BR')} MΩ`;
  } else if (ip === null) {
    ipSituacao = 'pendente';
  } else {
    ipSituacao = ip >= ipMinimo(c.classeIsolamento) ? 'ok' : 'falha';
  }

  const situacao = ir === 'falha' || ipSituacao === 'falha' ? 'reprovado'
    : ir === 'pendente' || ipSituacao === 'pendente' ? 'pendente'
    : 'aprovado';

  return { circuito: l.circuito, r1min40, ia, ip, ir, ipSituacao, ipMotivoNa, situacao };
}

export interface AvaliacaoEnsaio {
  circuitos: AvaliacaoCircuito[];
  // null enquanto faltar leitura obrigatória em algum circuito.
  resultado: ResultadoEnsaio | null;
  // Menor IR1min a 40 °C entre os circuitos (o que manda na tendência da lista).
  menorR1min40: number | null;
}

export function avaliarEnsaio(medicoes: LeituraIsolamento[], c: CriterioEnsaio): AvaliacaoEnsaio {
  const circuitos = medicoes.map(l => avaliarCircuito(l, c));
  const resultado: ResultadoEnsaio | null = !circuitos.length ? null
    : circuitos.some(a => a.situacao === 'reprovado') ? 'reprovado'
    : circuitos.some(a => a.situacao === 'pendente') ? null
    : 'aprovado';
  const irs = circuitos.map(a => a.r1min40).filter((v): v is number => v !== null);
  return { circuitos, resultado, menorR1min40: irs.length ? Math.min(...irs) : null };
}

export function criterioDoEnsaio(e: Pick<EnsaioIsolamento,
  'tensaoNominalV' | 'classeIsolamento' | 'tipoBobina' | 'temperaturaAmbienteC' | 'temperaturaEnrolamentoC'>): CriterioEnsaio {
  return {
    tensaoNominalV: e.tensaoNominalV,
    classeIsolamento: e.classeIsolamento,
    tipoBobina: e.tipoBobina,
    temperaturaC: temperaturaCorrecao(e),
  };
}

// MΩ com casas conforme a grandeza: 0,85 · 12,4 · 975 · 12.500
export function formatarMohm(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const casas = v < 10 ? 2 : v < 100 ? 1 : 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function formatarIndice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarNumero(v: number | null | undefined, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
}

// "220 kW (300 cv)" a partir do que estiver preenchido.
export function potenciaTexto(kw: number | null, cv: number | null): string {
  const partes = [kw !== null ? `${formatarNumero(kw)} kW` : '', cv !== null ? `${formatarNumero(cv)} cv` : ''].filter(Boolean);
  return partes.length === 2 ? `${partes[0]} (${partes[1]})` : partes[0] ?? '';
}

// Aceita "1.234,5", "1234.5", "1234,5" — o pessoal digita do jeito que lê no instrumento.
export function lerNumero(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  let t = texto.trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 12.500 = doze mil e quinhentos
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
