// Qualidade dos feedbacks de apontamento (SIGMA) — regras fixas, sem IA.
//
// Critério da gestão (Lucas, 13/11/2026): feedback bom descreve as atividades
// realizadas e, se gerou pendência, JÁ cita o número da OS aberta pra ela.
// Calibrado com os apontamentos reais de ago–nov/2026 (≈23% caíam em alguma regra).

export type MotivoFeedback =
  | 'curto'
  | 'generico'
  | 'pendencia_sem_os'
  | 'os_citada_inexistente'
  | 'pouco_detalhe'
  | 'copia_descricao'
  | 'repetido'
  | 'status_incoerente';

export const MOTIVO_LABEL: Record<MotivoFeedback, string> = {
  curto: 'Muito curto',
  generico: 'Genérico',
  pendencia_sem_os: 'Pendência sem nº da OS',
  os_citada_inexistente: 'OS citada não existe',
  pouco_detalhe: 'Pouco detalhe p/ as horas',
  copia_descricao: 'Copiou a descrição da OS',
  repetido: 'Mesmo texto em outras OS',
  status_incoerente: 'Executada, mas texto diz andamento',
};

export const MOTIVO_DICA: Record<MotivoFeedback, string> = {
  curto: 'Descrever o que foi feito no equipamento.',
  generico: 'Trocar "ok"/"executado" pelas atividades realizadas.',
  pendencia_sem_os: 'Informar o número da OS aberta para a pendência.',
  os_citada_inexistente: 'Conferir o número da OS citada — não existe no SIGMA.',
  pouco_detalhe: 'Muitas horas apontadas para um texto tão curto.',
  copia_descricao: 'Dizer o que foi executado, não repetir o título da OS.',
  repetido: 'Texto idêntico em OS diferentes — detalhar cada uma.',
  status_incoerente: 'Status EXEC com texto de atividade não concluída.',
};

export interface ApontamentoFeedback {
  id: string;
  numeroOs: string;
  data: string;          // YYYY-MM-DD
  executante: string;    // matrícula
  area: string;          // MECA, ELET, ...
  status: string;        // EXEC, EXPA, ...
  horas: number | null;
  feedback: string;
  descricaoOs: string;
}

export interface FeedbackAvaliado extends ApontamentoFeedback {
  motivos: MotivoFeedback[];
  osCitadas: string[];   // números de OS (6 dígitos) citados no texto, exceto a própria
  ruim: boolean;
}

export const MIN_CARACTERES = 20;
// Texto abaixo disso com muitas horas apontadas = pouco detalhe.
export const POUCO_DETALHE_CARACTERES = 50;
export const POUCO_DETALHE_HORAS = 4;
// Mesmo texto (normalizado) do mesmo executante em pelo menos N OS diferentes.
export const REPETIDO_MIN_OS = 3;

export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Vazio, só pontuação, "ok" / "executado" / "conforme plano" — sem dizer o que foi feito.
const GENERICO = new RegExp(
  '^\\W*(' + [
    'ok',
    'feito',
    'concluid[oa]',
    'finalizad[oa]',
    'executad[oa]',
    'realizad[oa]',
    '(ordem|os|o\\.s\\.?|servico|atividade|tarefa|preventiva|inspecao)s? (foi )?(executad[oa]s?|realizad[oa]s?|concluid[oa]s?|finalizad[oa]s?|ok)',
    '(executad[oa]|realizad[oa]|concluid[oa]|finalizad[oa])s? (a |o )?(ordem|os|servico|atividade|tarefa|preventiva|inspecao)s?',
    '(realizad[oa]s?|executad[oa]s?|feit[oa]s?) (a |as |o |os )?(preventivas?|ordem|ordens|inspecao|inspecoes|servico|atividade)? ?conforme (o )?(plano|procedimento|checklist|check list|os)( de manutencao)?',
    'atividade em andamento',
    'em andamento',
    'sem anormalidades?',
  ].join('|') + ')?\\W*$',
);

// Indica que o técnico achou/gerou pendência (precisa citar a OS).
const PENDENCIA = new RegExp([
  'pendenc',
  'anomalia',
  '\\b(os|o\\.s\\.?|ordem|ordens|nota|notas)( de servicos?)? (ja )?(foi |foram |sera |serao )?(abert|gerad|criad|contemplad|lancad)',
  '\\b(abert|gerad|criad|lancad)[ao]s? (uma |a |nova |novas |as |os )?(os|o\\.s|ordem|ordens|nota|notas)\\b',
  '\\b(abrir|gerar|criar|lancar) (uma |nova |novas |as |os )?(os|o\\.s|ordem|ordens|nota|notas)\\b',
  '\\bnovas? (os|ordem|ordens)\\b',
].join('|'));

// "sem pendência", "nenhuma anomalia", "não foram encontradas pendências"...
const NEGACAO_ANTES = /(sem|nenhum[a]?|nao (houve|ha|foi|foram|gerou|teve|tem|apresentou|encontrad[oa]s?|identificad[oa]s?|constatad[oa]s?)( encontrad[oa]s?| identificad[oa]s?)?|inexistencia de)\s+(\w+\s+){0,2}$/;

const EM_ANDAMENTO = /\b(em andamento|nao (foi )?conclu|nao (foi )?finaliz|falta concluir|continua(ra|r)? (na|no|amanha|proxim))/;

// Números de 5–6 dígitos citados no texto → candidato a OS (zero à esquerda até 6).
export function numerosCitados(textoNorm: string): string[] {
  const nums = new Set<string>();
  for (const m of textoNorm.matchAll(/(?<![\d.,])\d{5,6}(?![\d.,]\d)/g)) nums.add(m[0].padStart(6, '0'));
  return [...nums];
}

export function mencionaPendencia(textoNorm: string): boolean {
  const re = new RegExp(PENDENCIA.source, 'g');
  for (const m of textoNorm.matchAll(re)) {
    const ini = m.index ?? 0;
    const antes = textoNorm.slice(Math.max(0, ini - 40), ini);
    // "Pendência NR-10" = item de adequação à norma (a própria OS), não pendência nova.
    const depois = textoNorm.slice(ini + m[0].length, ini + m[0].length + 12);
    if (/^\w*\s*(da |de |do )?nr\b/.test(depois)) continue;
    if (!NEGACAO_ANTES.test(antes)) return true;
  }
  return false;
}

/**
 * Avalia todos os apontamentos do período. `osExistentes` = números de OS que existem
 * no SIGMA (pelo menos os citados nos textos); sem ele, a regra de OS inexistente não roda.
 */
export function avaliarFeedbacks(
  apontamentos: ApontamentoFeedback[],
  osExistentes?: Set<string>,
): FeedbackAvaliado[] {
  // Repetição: mesmo executante + mesmo texto em OS diferentes.
  const osPorTexto = new Map<string, Set<string>>();
  for (const a of apontamentos) {
    const t = normalizarTexto(a.feedback);
    if (t.length < MIN_CARACTERES) continue;
    const chave = `${a.executante}|${t}`;
    const s = osPorTexto.get(chave) ?? new Set<string>();
    s.add(a.numeroOs);
    osPorTexto.set(chave, s);
  }

  return apontamentos.map(a => {
    const t = normalizarTexto(a.feedback);
    const motivos: MotivoFeedback[] = [];
    const proprio = (a.numeroOs ?? '').padStart(6, '0');
    const osCitadas = numerosCitados(t).filter(n => n !== proprio);

    const curto = t.replace(/\W/g, '').length < MIN_CARACTERES;
    const generico = GENERICO.test(t);
    if (generico) motivos.push('generico');
    else if (curto) motivos.push('curto');

    if (mencionaPendencia(t)) {
      if (osCitadas.length === 0) motivos.push('pendencia_sem_os');
      // Só acusa se NENHUM número citado é OS — número solto pode ser medida/código.
      else if (osExistentes && osCitadas.every(n => !osExistentes.has(n))) motivos.push('os_citada_inexistente');
    }

    if (!curto && !generico && t.length < POUCO_DETALHE_CARACTERES && (a.horas ?? 0) >= POUCO_DETALHE_HORAS) {
      motivos.push('pouco_detalhe');
    }

    const desc = normalizarTexto(a.descricaoOs);
    if (!generico && desc.length >= 10 && (t === desc || (t.length <= desc.length + 3 && desc.includes(t)))) {
      motivos.push('copia_descricao');
    }

    if (!curto && !generico && (osPorTexto.get(`${a.executante}|${t}`)?.size ?? 0) >= REPETIDO_MIN_OS) {
      motivos.push('repetido');
    }

    if (a.status.toUpperCase() === 'EXEC' && EM_ANDAMENTO.test(t)) motivos.push('status_incoerente');

    return { ...a, motivos, osCitadas, ruim: motivos.length > 0 };
  });
}

// ── Agregações ────────────────────────────────────────────────────────────

export interface ResumoGrupo {
  chave: string;
  total: number;
  ruins: number;
  pct: number; // 0–100
  porMotivo: Partial<Record<MotivoFeedback, number>>;
}

export function agruparPor(itens: FeedbackAvaliado[], chaveDe: (i: FeedbackAvaliado) => string): ResumoGrupo[] {
  const mapa = new Map<string, ResumoGrupo>();
  for (const i of itens) {
    const k = chaveDe(i) || '—';
    const g = mapa.get(k) ?? { chave: k, total: 0, ruins: 0, pct: 0, porMotivo: {} };
    g.total++;
    if (i.ruim) g.ruins++;
    for (const m of i.motivos) g.porMotivo[m] = (g.porMotivo[m] ?? 0) + 1;
    mapa.set(k, g);
  }
  return [...mapa.values()]
    .map(g => ({ ...g, pct: g.total ? Math.round((g.ruins / g.total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pct - a.pct || b.ruins - a.ruins);
}

// Segunda-feira (YYYY-MM-DD) da semana da data — pra tendência semanal.
export function segundaDaSemana(dataIso: string): string {
  const [y, m, d] = dataIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 dom
  dt.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function contarMotivos(itens: FeedbackAvaliado[]): { motivo: MotivoFeedback; count: number }[] {
  const c = new Map<MotivoFeedback, number>();
  for (const i of itens) for (const m of i.motivos) c.set(m, (c.get(m) ?? 0) + 1);
  return [...c.entries()].map(([motivo, count]) => ({ motivo, count })).sort((a, b) => b.count - a.count);
}
