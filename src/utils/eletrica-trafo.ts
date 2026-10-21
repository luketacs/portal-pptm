import {
  CriterioTrafo, EnsaioTrafo, LeituraIsolamentoTrafo, Ligacao, MaterialEnrolamento, MeioIsolante, OhmicaEnrolamento,
  Secundario, TtrSecundario,
} from '../models/eletrica-trafo.model';
import { ResultadoEnsaio } from '../models/eletrica-ensaio.model';
import { SituacaoItem } from './eletrica-ensaio';

// Avaliação dos ensaios de transformador pela ANSI/NETA MTS (Maintenance Testing
// Specifications — a referência de ensaio em campo; a NBR 5356 cobre ensaio de fábrica):
// - Resistência de isolamento (tabela 100.5): mínimo de 1 min corrigida a 20 °C, pela
//   tensão do enrolamento ensaiado e pelo meio isolante (seco / óleo). Correção pela
//   tabela 100.14 ≈ a resistência dobra a cada 10 °C a menos: R20 = R(T) × 2^((T − 20)/10).
// - IP (10 min ÷ 1 min) — ou, sem a leitura de 10 min, IA (1 min ÷ 30 s) — não pode ser
//   menor que 1,0 (seção 7.2). Fundo de escala: não se aplica.
// - Relação de transformação (TTR): desvio máximo de 0,5 % da relação calculada (seção 7.2).
// - Resistência ôhmica: diferença entre fases do mesmo enrolamento até 2 % (prática da
//   IEEE C57.152 para comparação entre fases); valor corrigido a 75 °C pra comparar ensaios.
// Uma regra só pra tela, PDF e pro resultado gravado.

export const TEMPERATURA_REFERENCIA_IR_C = 20;
export const TEMPERATURA_REFERENCIA_OHMICA_C = 75;
export const INDICE_MINIMO = 1.0;
export const TTR_DESVIO_MAX_PCT = 0.5;
export const OHMICA_DESEQUILIBRIO_MAX_PCT = 2;

export const LIGACAO_LABEL: Record<Ligacao, string> = { D: 'Triângulo (Δ)', Y: 'Estrela (Y)' };
export const LIGACAO_SIMBOLO: Record<Ligacao, string> = { D: 'Δ', Y: 'Y' };
export const MEIO_LABEL: Record<MeioIsolante, string> = { seco: 'Seco (resina / ar)', oleo: 'Óleo' };
export const MATERIAL_LABEL: Record<MaterialEnrolamento, string> = { cobre: 'Cobre', aluminio: 'Alumínio' };

// ── Terminais ───────────────────────────────────────────────────────────────
// Primário = 'H' → H1, H2, H3, H0. Secundário 'X' → X1…; '1X' → 1X1…
const terminal = (enrolamento: string, n: number) => `${enrolamento}${n}`;

// Pares de medição de um enrolamento (ôhmica e TTR): Δ entre linhas, Y fase-neutro.
// Mesma ordem da planilha: 1-3, 2-1, 3-2.
export function paresEnrolamento(enrolamento: string, ligacao: Ligacao): string[] {
  if (ligacao === 'D') {
    return [[1, 3], [2, 1], [3, 2]].map(([a, b]) => `${terminal(enrolamento, a)}-${terminal(enrolamento, b)}`);
  }
  return [1, 2, 3].map(a => `${terminal(enrolamento, a)}-${terminal(enrolamento, 0)}`);
}

// ── Isolamento ──────────────────────────────────────────────────────────────
// Na ordem da planilha: H-TE, H-cada secundário, cada secundário-TE, secundário-secundário.
export function circuitosIsolamento(secundarios: Secundario[]): string[] {
  const nomes = secundarios.map(s => s.nome);
  const entre: string[] = [];
  for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) entre.push(`${nomes[i]}-${nomes[j]}`);
  return ['H-TE', ...nomes.map(n => `H-${n}`), ...nomes.map(n => `${n}-TE`), ...entre];
}

export function circuitoTrafoLabel(c: string): string {
  return c.split('-').map(p => (p === 'TE' ? 'Terra' : p)).join(' – ');
}

// Tensão nominal que manda no circuito: a do enrolamento de maior tensão envolvido.
export function tensaoCircuito(circuito: string, c: Pick<CriterioTrafo, 'tensaoPrimariaV' | 'secundarios'>): number {
  const tensoes = circuito.split('-').filter(p => p !== 'TE')
    .map(p => (p === 'H' ? c.tensaoPrimariaV : c.secundarios.find(s => s.nome === p)?.tensaoV ?? 0));
  return Math.max(0, ...tensoes);
}

// Tabela 100.5 — mínimo a 20 °C (MΩ).
export function irMinimoTrafoMohm(tensaoEnrolamentoV: number, meio: MeioIsolante): number {
  if (tensaoEnrolamentoV <= 600) return meio === 'seco' ? 500 : 100;
  if (tensaoEnrolamentoV <= 5000) return meio === 'seco' ? 5000 : 1000;
  return meio === 'seco' ? 25000 : 5000;
}

// Tabela 100.5 — tensão CC mínima de ensaio.
export function tensaoEnsaioTrafo(tensaoEnrolamentoV: number): number {
  if (tensaoEnrolamentoV <= 600) return 1000;
  if (tensaoEnrolamentoV <= 5000) return 2500;
  return 5000;
}

export function fatorCorrecao20(temperaturaC: number): number {
  return Math.pow(2, (temperaturaC - TEMPERATURA_REFERENCIA_IR_C) / 10);
}

export interface AvaliacaoIsolamentoTrafo {
  circuito: string;
  minimo: number;
  r1min20: number | null;
  indice: number | null;
  indiceTipo: 'IP' | 'IA' | null;
  ia: number | null;
  ip: number | null;
  ir: SituacaoItem;
  indiceSituacao: SituacaoItem;
  tensaoBaixa: boolean; // tensão aplicada abaixo da mínima da tabela 100.5
  situacao: 'aprovado' | 'reprovado' | 'pendente';
}

const valido = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function avaliarIsolamentoTrafo(l: LeituraIsolamentoTrafo, c: CriterioTrafo, temperaturaC: number): AvaliacaoIsolamentoTrafo {
  const vCircuito = tensaoCircuito(l.circuito, c);
  const minimo = irMinimoTrafoMohm(vCircuito, c.meioIsolante);
  const r1min20 = valido(l.r1min) ? l.r1min * fatorCorrecao20(temperaturaC) : null;
  const ia = valido(l.r1min) && valido(l.r30s) ? l.r1min / l.r30s : null;
  const ip = valido(l.r1min) && valido(l.r10min) ? l.r10min / l.r1min : null;
  const indiceTipo = ip !== null ? 'IP' : ia !== null ? 'IA' : null;
  const indice = ip ?? ia;

  const ir: SituacaoItem = r1min20 === null ? 'pendente' : r1min20 >= minimo ? 'ok' : 'falha';
  const indiceSituacao: SituacaoItem = l.foraEscala ? 'na'
    : indice === null ? 'pendente'
    : indice >= INDICE_MINIMO ? 'ok' : 'falha';

  const situacao = ir === 'falha' || indiceSituacao === 'falha' ? 'reprovado'
    : ir === 'pendente' || indiceSituacao === 'pendente' ? 'pendente'
    : 'aprovado';

  return {
    circuito: l.circuito, minimo, r1min20, indice, indiceTipo, ia, ip, ir, indiceSituacao, situacao,
    tensaoBaixa: valido(l.tensaoV) && l.tensaoV < tensaoEnsaioTrafo(vCircuito),
  };
}

// ── Resistência ôhmica ──────────────────────────────────────────────────────
const CONSTANTE_MATERIAL: Record<MaterialEnrolamento, number> = { cobre: 234.5, aluminio: 225 };

export function fatorCorrecao75(material: MaterialEnrolamento, temperaturaC: number): number {
  const k = CONSTANTE_MATERIAL[material];
  return (k + TEMPERATURA_REFERENCIA_OHMICA_C) / (k + temperaturaC);
}

export interface AvaliacaoOhmica {
  enrolamento: string;
  media75: number | null;
  desequilibrioPct: number | null;
  situacao: 'aprovado' | 'reprovado' | 'pendente';
}

export function avaliarOhmica(o: OhmicaEnrolamento, material: MaterialEnrolamento, temperaturaC: number): AvaliacaoOhmica {
  const valores = o.pares.map(p => p.valor);
  if (!valores.length || !valores.every(valido)) {
    return { enrolamento: o.enrolamento, media75: null, desequilibrioPct: null, situacao: 'pendente' };
  }
  const v = valores as number[];
  const media = v.reduce((s, x) => s + x, 0) / v.length;
  const desequilibrioPct = ((Math.max(...v) - Math.min(...v)) / media) * 100;
  return {
    enrolamento: o.enrolamento,
    media75: media * fatorCorrecao75(material, temperaturaC),
    desequilibrioPct,
    situacao: desequilibrioPct <= OHMICA_DESEQUILIBRIO_MAX_PCT ? 'aprovado' : 'reprovado',
  };
}

// ── Relação de transformação ────────────────────────────────────────────────
// O TTR mede tensão do par do primário ÷ tensão do par do secundário. Par fase-neutro
// (Y) enxerga a tensão de linha ÷ √3. Ex.: Δ/Δ 13.800/690 = 20; Δ/Y 13.800/(690/√3) = 34,641.
export function relacaoCalculada(tapTensaoV: number, ligacaoPrimaria: Ligacao, s: Secundario): number {
  const vp = ligacaoPrimaria === 'D' ? tapTensaoV : tapTensaoV / Math.sqrt(3);
  const vs = s.ligacao === 'D' ? s.tensaoV : s.tensaoV / Math.sqrt(3);
  return vp / vs;
}

export function paresTtr(ligacaoPrimaria: Ligacao, s: Secundario): string[] {
  const prim = paresEnrolamento('H', ligacaoPrimaria);
  const sec = paresEnrolamento(s.nome, s.ligacao);
  return prim.map((p, i) => `${p} / ${sec[i]}`);
}

export interface AvaliacaoTtr {
  secundario: string;
  calculada: number;
  desvios: (number | null)[];
  maiorDesvioPct: number | null;
  situacao: 'aprovado' | 'reprovado' | 'pendente';
}

export function avaliarTtr(t: TtrSecundario, c: CriterioTrafo): AvaliacaoTtr {
  const s = c.secundarios.find(x => x.nome === t.secundario);
  const calculada = s ? relacaoCalculada(c.tapTensaoV, c.ligacaoPrimaria, s) : NaN;
  const desvios = t.pares.map(p => (valido(p.medida) && Number.isFinite(calculada) ? ((p.medida - calculada) / calculada) * 100 : null));
  if (!desvios.length || desvios.some(d => d === null)) {
    return { secundario: t.secundario, calculada, desvios, maiorDesvioPct: null, situacao: 'pendente' };
  }
  const maior = Math.max(...desvios.map(d => Math.abs(d as number)));
  return {
    secundario: t.secundario, calculada, desvios, maiorDesvioPct: maior,
    situacao: maior <= TTR_DESVIO_MAX_PCT ? 'aprovado' : 'reprovado',
  };
}

// ── Ensaio completo ─────────────────────────────────────────────────────────
export interface AvaliacaoTrafo {
  isolamento: AvaliacaoIsolamentoTrafo[];
  ohmica: AvaliacaoOhmica[];
  ttr: AvaliacaoTtr[];
  resultado: ResultadoEnsaio | null; // null = falta leitura em alguma parte feita
}

export function temperaturaEnsaio(e: Pick<EnsaioTrafo, 'temperaturaAmbienteC' | 'temperaturaEnrolamentoC'>): number {
  return e.temperaturaEnrolamentoC ?? e.temperaturaAmbienteC;
}

export function avaliarTrafo(
  e: Pick<EnsaioTrafo, 'criterio' | 'isolamento' | 'ohmica' | 'ttr' | 'temperaturaAmbienteC' | 'temperaturaEnrolamentoC'>,
): AvaliacaoTrafo {
  const t = temperaturaEnsaio(e);
  const isolamento = e.isolamento.map(l => avaliarIsolamentoTrafo(l, e.criterio, t));
  const ohmica = e.ohmica.map(o => avaliarOhmica(o, e.criterio.materialEnrolamento, t));
  const ttr = e.ttr.map(x => avaliarTtr(x, e.criterio));
  const todos = [...isolamento, ...ohmica, ...ttr].map(a => a.situacao);
  const resultado: ResultadoEnsaio | null = !todos.length ? null
    : todos.includes('reprovado') ? 'reprovado'
    : todos.includes('pendente') ? null
    : 'aprovado';
  return { isolamento, ohmica, ttr, resultado };
}

// Linhas vazias pra um trafo (o formulário parte daqui).
export function isolamentoVazio(c: Pick<CriterioTrafo, 'tensaoPrimariaV' | 'secundarios'>): LeituraIsolamentoTrafo[] {
  return circuitosIsolamento(c.secundarios).map(circuito => ({
    circuito, tensaoV: tensaoEnsaioTrafo(tensaoCircuito(circuito, c)), r30s: null, r1min: null, r10min: null, foraEscala: false,
  }));
}

export function ohmicaVazia(c: Pick<CriterioTrafo, 'ligacaoPrimaria' | 'secundarios'>): OhmicaEnrolamento[] {
  return [
    { enrolamento: 'H', pares: paresEnrolamento('H', c.ligacaoPrimaria).map(par => ({ par, valor: null })) },
    ...c.secundarios.map(s => ({ enrolamento: s.nome, pares: paresEnrolamento(s.nome, s.ligacao).map(par => ({ par, valor: null })) })),
  ];
}

export function ttrVazio(c: Pick<CriterioTrafo, 'ligacaoPrimaria' | 'secundarios'>): TtrSecundario[] {
  return c.secundarios.map(s => ({ secundario: s.nome, pares: paresTtr(c.ligacaoPrimaria, s).map(par => ({ par, medida: null })) }));
}

export function formatarPct(v: number | null | undefined, sinal = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const t = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sinal && v > 0 ? '+' : ''}${t}%`;
}

export function formatarRelacao(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// "13.800 / 690 V (Δ/Δ-Y)"
export function tensoesTexto(primariaV: number, ligacaoPrimaria: Ligacao, secundarios: Secundario[]): string {
  const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const vs = [...new Set(secundarios.map(s => fmt(s.tensaoV)))].join(' / ');
  const lig = `${LIGACAO_SIMBOLO[ligacaoPrimaria]}/${secundarios.map(s => LIGACAO_SIMBOLO[s.ligacao]).join('-')}`;
  return `${fmt(primariaV)} / ${vs} V (${lig})`;
}
