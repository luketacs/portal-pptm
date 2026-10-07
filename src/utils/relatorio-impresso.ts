// Relatório impresso do Acompanhamento de Indicadores (botão "Gerar Relatório"): um
// documento montado página a página, separado da tela — ver
// components/manutencao/relatorio-indicadores-impresso. Aqui ficam as partes puras e
// testáveis: formatação pt-BR, as frases que contam o resultado do período e a
// geometria dos gráficos (SVG desenhado no template, sem lib).
import { CategoriaIndicador } from '../models/manutencao-programacao.model';
import { CATEGORIAS_INDICADOR, CATEGORIA_LABEL, ContagemExecucao, IndicadoresSemana } from './manutencao-indicadores';
import { numeroSemanaISO } from './manutencao-indicadores-periodo';

export interface ContagemImpressa {
  executadas: number;
  programadas: number;
  percentual: number;
}

export interface AreaImpressa {
  nome: string;
  atendimento: ContagemImpressa;
  cumprimento: ContagemImpressa;
}

export interface PontoTendencia {
  rotulo: string;    // eixo X: "S38" / "SET"
  nomeFrase: string; // no texto: "semana 38" / "setembro"
  atendimento: number;
  cumprimento: number;
}

export interface LinhaTecnicoImpressa {
  nome: string;
  apontadas: number;
  programadas: number;
  disponiveis: number;
  eficiencia: number;
}

export interface DadosRelatorioImpresso {
  rotulo: string;      // "Semana 40" / "Setembro de 2026"
  intervalo: string;   // "28 set a 4 out 2026"
  emitidoEm: Date;
  meta: number;        // Atendimento e Cumprimento usam a mesma meta (95%)
  atendimento: ContagemImpressa;
  cumprimento: ContagemImpressa;
  areas: AreaImpressa[];
  corretivas: ContagemImpressa;
  preventivas: ContagemImpressa;
  hhDisponivel: number;
  hhIndisponivel: number;
  folgas: number;
  exames: number;
  ano: {
    ano: number;
    atendimento: ContagemImpressa;
    cumprimento: ContagemImpressa;
    disponibilidade: number | null;
    metaDisponibilidade: number;
    diasNavio: number | null;
    metaDiasNavio: number;
  };
  equipamentos: { nome: string; horas: number }[];
  atividades: { nome: string; horas: number }[];
  tecnicos: { area: string; linhas: LinhaTecnicoImpressa[] }[];
  unidadeTendencia: 'semanas' | 'meses';
  tendencia: PontoTendencia[];
  tendenciaAreas: { nome: string; pontos: number[] }[];
}

export const CSS_PAGINA_IMPRESSAO = '@media print { @page { size: A4 landscape; margin: 0; } }';

// ── Formatação ──
const formatoNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
export const num = (v: number): string => formatoNumero.format(v);
export const pct = (v: number): string => `${num(v)}%`;
const formatoDuasCasas = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const num2 = (v: number): string => formatoDuasCasas.format(v);
const pctDe = (c: ContagemImpressa): string => pct(c.programadas > 0 ? (c.executadas / c.programadas) * 100 : 100);

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const dataCurta = (d: Date): string => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;

export function intervaloSemana(segundaIso: string): string {
  const [a, m, d] = segundaIso.split('-').map(Number);
  const ini = new Date(a, m - 1, d);
  const fim = new Date(a, m - 1, d + 6);
  if (ini.getFullYear() !== fim.getFullYear()) return `${dataCurta(ini)} a ${dataCurta(fim)}`;
  if (ini.getMonth() !== fim.getMonth()) return `${ini.getDate()} ${MESES[ini.getMonth()]} a ${dataCurta(fim)}`;
  return `${ini.getDate()} a ${dataCurta(fim)}`;
}

// Descrição de OS vem em CAIXA ALTA do SIGMA — no documento vira frase, mas código de
// equipamento (tem dígito: EAC05, 90BLG) continua como está.
export function frase(texto: string): string {
  const palavras = texto.trim().replace(/^["'“”]+|["'“”]+$/g, '').split(/\s+/).map(p => (/\d/.test(p) ? p : p.toLowerCase()));
  if (palavras.length === 0 || !palavras[0]) return '';
  palavras[0] = palavras[0][0].toUpperCase() + palavras[0].slice(1);
  return palavras.join(' ');
}

// Nome de área no meio da frase: minúsculo, exceto sigla. Com artigo: "a mecânica",
// "o SPCI".
const nomeNaFrase = (nome: string): string => (nome === nome.toUpperCase() ? nome : nome.toLowerCase());
const comArtigo = (nome: string): string => `${nome === nome.toUpperCase() ? 'o' : 'a'} ${nomeNaFrase(nome)}`;
const maiuscula = (t: string): string => t[0].toUpperCase() + t.slice(1);

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

// ── Frases ──
export function tituloResumo(p: { rotulo: string; meta: number; atendimento: ContagemImpressa; cumprimento: ContagemImpressa }): string {
  const at = p.atendimento.percentual;
  const cu = p.cumprimento.percentual;
  if (at >= p.meta && cu >= p.meta) {
    return at >= 100 && cu >= 100
      ? `${p.rotulo} fechou com a programação cumprida por completo`
      : `${p.rotulo} fechou dentro da meta, com ${pct(at)} de atendimento à programação`;
  }
  if (at < p.meta) return `${p.rotulo} fechou com ${pct(at)} de atendimento à programação, abaixo da meta de ${pct(p.meta)}`;
  return `${p.rotulo} cumpriu a programação, mas o plano de manutenção ficou em ${pct(cu)}`;
}

export function ledeResumo(p: {
  meta: number; atendimento: ContagemImpressa; cumprimento: ContagemImpressa; areas: AreaImpressa[]; atendimentoAno: number;
}): string {
  const partes: string[] = [];
  const { atendimento: at, cumprimento: cu } = p;
  if (at.executadas === at.programadas && cu.executadas === cu.programadas) {
    partes.push(`As ${num(at.programadas)} ordens programadas foram executadas, entre elas as ${num(cu.programadas)} do plano de manutenção.`);
  } else {
    partes.push(`Foram executadas ${num(at.executadas)} das ${num(at.programadas)} ordens programadas (${pctDe(at)}) `
      + `e ${num(cu.executadas)} das ${num(cu.programadas)} do plano de manutenção (${pctDe(cu)}).`);
  }

  const abaixo = p.areas.filter(a => a.atendimento.percentual < p.meta);
  if (abaixo.length === 0) {
    partes.push(`Nenhuma das ${p.areas.length} áreas ficou abaixo da meta de ${pct(p.meta)}.`);
  } else {
    const naoExec = (a: AreaImpressa) => a.atendimento.programadas - a.atendimento.executadas;
    const totalNaoExec = p.areas.reduce((s, a) => s + naoExec(a), 0);
    const maior = [...p.areas].sort((a, b) => naoExec(b) - naoExec(a))[0];
    const concentra = totalNaoExec > 0 && naoExec(maior) / totalNaoExec >= 0.5
      ? `; ${comArtigo(maior.nome)} concentra ${num(naoExec(maior))} das ${num(totalNaoExec)} ordens não executadas`
      : '';
    if (abaixo.length === 1) {
      const so = abaixo[0];
      const mesma = concentra && maior === so;
      partes.push(`Só ${comArtigo(so.nome)} ficou abaixo da meta, com ${pct(so.atendimento.percentual)}`
        + (mesma ? `, e concentra ${num(naoExec(so))} das ${num(totalNaoExec)} ordens não executadas.` : `${concentra}.`));
    } else {
      // Muitas áreas: contar em vez de listar (lista de 5 nomes vira parágrafo ilegível).
      const quem = abaixo.length === p.areas.length ? `Todas as ${p.areas.length} áreas`
        : abaixo.length > 3 ? `${abaixo.length} das ${p.areas.length} áreas`
          : maiuscula(listar(abaixo.map(a => nomeNaFrase(a.nome))));
      partes.push(`${quem} ficaram abaixo da meta de ${pct(p.meta)}${concentra}.`);
    }
  }

  partes.push(`No acumulado do ano, o atendimento à programação está em ${pct(p.atendimentoAno)}.`);
  return partes.join(' ');
}

export function ledeTendencia(p: {
  meta: number; pontos: PontoTendencia[]; areas: { nome: string; pontos: number[] }[]; unidade: 'semanas' | 'meses';
}): string {
  const n = p.pontos.length;
  const abaixoAt = p.pontos.filter(x => x.atendimento < p.meta);
  const partes: string[] = [];
  if (abaixoAt.length === 0) {
    partes.push(`O atendimento ficou acima da meta ${p.unidade === 'semanas' ? 'em todas as' : 'em todos os'} ${n} ${p.unidade}.`);
  } else {
    const lista = abaixoAt.slice(0, 3).map(x => `${p.unidade === 'semanas' ? 'na' : 'em'} ${x.nomeFrase} (${pct(x.atendimento)})`);
    partes.push(`O atendimento ficou acima da meta em ${n - abaixoAt.length} das ${n} ${p.unidade}; abaixo ${listar(lista)}.`);
  }

  const abaixoPlano = p.pontos.map((x, i) => ({ ...x, i })).filter(x => x.cumprimento < p.meta);
  if (abaixoPlano.length === 0) {
    partes.push('O plano de manutenção também ficou acima da meta em todo o período.');
  } else if (abaixoPlano.length === 1) {
    const x = abaixoPlano[0];
    const pior = p.areas
      .map(a => ({ nome: a.nome, v: a.pontos[x.i] }))
      .filter(a => a.v !== undefined && a.v < p.meta)
      .sort((a, b) => a.v - b.v)[0];
    const causa = !pior ? ''
      : pior.v === 0 ? `, quando ${comArtigo(pior.nome)} não executou nenhuma ordem`
        : `, com ${comArtigo(pior.nome)} em ${pct(pior.v)}`;
    partes.push(`No plano, a única abaixo da meta foi a ${x.nomeFrase} (${pct(x.cumprimento)})${causa}.`);
  } else {
    partes.push(`No plano, ficaram abaixo da meta: ${listar(abaixoPlano.slice(0, 4).map(x => `${x.nomeFrase} (${pct(x.cumprimento)})`))}.`);
  }
  return partes.join(' ');
}

// ── Geometria ──
// Piso do eixo Y em degraus que dão rótulos redondos (passo 5/10/15/20/25).
export function eixoMinimo(valores: number[]): number {
  const menor = Math.min(100, ...valores);
  const bruto = Math.max(0, Math.floor((menor - 5) / 10) * 10);
  return [80, 60, 40, 20, 0].find(d => d <= bruto) ?? 0;
}

export interface GeometriaLinhas {
  series: { x: number; y: number }[][];
  gradeY: { valor: number; y: number }[];
  xs: number[];
  yMeta: number;
}

export function geometriaLinhas(p: {
  series: number[][]; largura: number; altura: number;
  margem: { esq: number; dir: number; topo: number; base: number }; ymin: number; meta: number;
}): GeometriaLinhas {
  const { esq, dir, topo, base } = p.margem;
  const n = Math.max(1, ...p.series.map(s => s.length));
  const larguraUtil = p.largura - esq - dir;
  const alturaUtil = p.altura - topo - base;
  const x = (i: number) => (n <= 1 ? esq + larguraUtil / 2 : esq + (i / (n - 1)) * larguraUtil);
  const y = (v: number) => topo + (1 - (Math.max(p.ymin, Math.min(100, v)) - p.ymin) / (100 - p.ymin)) * alturaUtil;
  const arred = (v: number) => Math.round(v * 10) / 10;
  return {
    series: p.series.map(s => s.map((v, i) => ({ x: arred(x(i)), y: arred(y(v)) }))),
    gradeY: [0, 1, 2, 3, 4].map(k => {
      const valor = p.ymin + ((100 - p.ymin) * k) / 4;
      return { valor, y: arred(y(valor)) };
    }),
    xs: Array.from({ length: n }, (_, i) => arred(x(i))),
    yMeta: arred(y(p.meta)),
  };
}

export const pontosSvg = (pts: { x: number; y: number }[]): string => pts.map(p => `${p.x},${p.y}`).join(' ');

// ── Montagem a partir do que a tela já calcula ──
const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const contagem = (c: ContagemExecucao): ContagemImpressa => ({ executadas: c.executadas, programadas: c.programadas, percentual: c.atendimento });

export interface FonteRelatorioImpresso {
  modo: 'semana' | 'mes';
  periodoIso: string; // segunda-feira ('YYYY-MM-DD') no modo semana, 'YYYY-MM' no modo mês
  semanasDoPeriodo: string[];
  emitidoEm: Date;
  meta: number;
  indicadores: IndicadoresSemana;
  corretivas: ContagemImpressa;
  preventivas: ContagemImpressa;
  hh: { disponivel: number; indisponivel: number };
  folgas: number;
  exames: number;
  ano: IndicadoresSemana;
  anoNumero: number;
  disponibilidade: number | null;
  metaDisponibilidade: number;
  diasNavio: number | null;
  metaDiasNavio: number;
  equipamentos: { equipamento: string; horas: number }[];
  atividades: { atividade: string; horas: number }[];
  tecnicos: {
    area: string;
    itens: { colaborador: { nome: string }; horasApontadas: number; horasProgramadas: number; horasDisponiveis: number; eficiencia: number }[];
  }[];
  // Série completa em ordem cronológica (chave = segunda-feira ou 'YYYY-MM'); o
  // documento usa só as últimas JANELA_TENDENCIA.
  tendencia: { chave: string; atendimento: number; cumprimento: number }[];
  tendenciaAreas: Map<CategoriaIndicador, Map<string, { atendimento: number }>>;
}

export const JANELA_TENDENCIA = 13;

export function montarDadosRelatorioImpresso(f: FonteRelatorioImpresso): DadosRelatorioImpresso {
  const mensal = f.modo === 'mes';
  const rotuloDaChave = (chave: string): { rotulo: string; nomeFrase: string } => {
    if (mensal) {
      const m = Number(chave.slice(5, 7)) - 1;
      return { rotulo: maiuscula(MESES[m]), nomeFrase: MESES_NOME[m] };
    }
    const n = numeroSemanaISO(chave);
    return { rotulo: `S${n}`, nomeFrase: `semana ${n}` };
  };

  const janela = f.tendencia.slice(-JANELA_TENDENCIA);
  const semanas = f.semanasDoPeriodo;
  const [ano, mes] = f.periodoIso.split('-').map(Number);

  return {
    rotulo: mensal ? `${maiuscula(MESES_NOME[mes - 1])} de ${ano}` : `Semana ${numeroSemanaISO(f.periodoIso)}`,
    intervalo: !mensal ? intervaloSemana(f.periodoIso)
      : semanas.length ? `semanas ${numeroSemanaISO(semanas[0])} a ${numeroSemanaISO(semanas[semanas.length - 1])}`
        : `${MESES_NOME[mes - 1]} de ${ano}`,
    emitidoEm: f.emitidoEm,
    meta: f.meta,
    atendimento: contagem(f.indicadores.geral),
    cumprimento: contagem(f.indicadores.cumprimentoPlano),
    areas: CATEGORIAS_INDICADOR
      .map(cat => ({ cat, a: f.indicadores.porArea.find(x => x.categoria === cat) }))
      .filter(({ a }) => !!a && a.programadas > 0)
      .map(({ cat, a }) => ({ nome: CATEGORIA_LABEL[cat], atendimento: contagem(a!), cumprimento: contagem(a!.cumprimentoPlano) })),
    corretivas: f.corretivas,
    preventivas: f.preventivas,
    hhDisponivel: f.hh.disponivel,
    hhIndisponivel: f.hh.indisponivel,
    folgas: f.folgas,
    exames: f.exames,
    ano: {
      ano: f.anoNumero,
      atendimento: contagem(f.ano.geral),
      cumprimento: contagem(f.ano.cumprimentoPlano),
      disponibilidade: f.disponibilidade,
      metaDisponibilidade: f.metaDisponibilidade,
      diasNavio: f.diasNavio,
      metaDiasNavio: f.metaDiasNavio,
    },
    equipamentos: f.equipamentos.map(e => ({ nome: e.equipamento, horas: e.horas })),
    atividades: f.atividades.map(a => ({ nome: frase(a.atividade), horas: a.horas })),
    tecnicos: f.tecnicos
      .filter(g => g.itens.length > 0)
      .map(g => ({
        area: g.area,
        linhas: g.itens.map(t => ({
          nome: t.colaborador.nome, apontadas: t.horasApontadas, programadas: t.horasProgramadas,
          disponiveis: t.horasDisponiveis, eficiencia: t.eficiencia,
        })),
      })),
    unidadeTendencia: mensal ? 'meses' : 'semanas',
    tendencia: janela.map(p => ({ ...rotuloDaChave(p.chave), atendimento: p.atendimento, cumprimento: p.cumprimento })),
    // Período sem ordem programada pra área = 100% (mesmo critério de contarExecucao:
    // nada previsto = cumprido), pra série ficar alinhada com as chaves da janela.
    tendenciaAreas: CATEGORIAS_INDICADOR.map(cat => ({
      nome: CATEGORIA_LABEL[cat],
      pontos: janela.map(p => f.tendenciaAreas.get(cat)?.get(p.chave)?.atendimento ?? 100),
    })),
  };
}

// "Últimas 13 semanas" / "Últimos 10 meses".
export const tituloTendencia = (n: number, unidade: 'semanas' | 'meses'): string =>
  `${unidade === 'semanas' ? 'Últimas' : 'Últimos'} ${n} ${unidade}`;
