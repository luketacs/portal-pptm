import { ElementRef } from '@angular/core';
import * as d3 from 'd3';

// Gráficos do portal (d3), no padrão da skill de dataviz:
// - Contagens por categoria (status, tipo, unidade, pessoa, área) = barras HORIZONTAIS
//   ordenadas. Pizza/donut foram aposentadas: comparam mal valores próximos, não cabem
//   muitas categorias e o nome longo não tem onde ficar.
// - Uma série = UMA cor (slot 1 da paleta). Cor diferente por barra dobrava a codificação
//   (o comprimento já diz o valor) e virava arco-íris.
// - Marcas finas (≤24px), ponta de dado arredondada 4px e base reta, valor na ponta,
//   eixo/grade em hairline recessiva, texto sempre em cor de texto (nunca na cor da barra).
// - Tooltip no hover E no foco do teclado; tabela oculta pra leitor de tela (o tooltip
//   nunca é o único jeito de ler um valor — o valor também fica escrito na ponta).
// Cores em tokens CSS (--viz-*, index.css) — trocar a paleta é mexer só lá.

export interface ChartDatum {
  name: string;
  value: number;
}

export interface BarrasOptions<T extends ChartDatum> {
  /** Título do gráfico pra leitor de tela (o título visível fica no card). */
  ariaLabel: string;
  /** Formata o valor da ponta da barra e do tooltip. Padrão: inteiro pt-BR. */
  formatValue?: (v: number) => string;
  /** Linha extra do tooltip (ex.: "12 SCs · máx 3d"). */
  detalhe?: (d: T) => string | null;
  /** Mostra "% do total" no tooltip (faz sentido pra contagem; não pra média). Padrão: true. */
  mostrarPercentual?: boolean;
  /** Máximo de barras; o resto vira "Outros" (somado). Padrão: 10. */
  max?: number;
  /** Ordena do maior pro menor. Padrão: true. */
  ordenar?: boolean;
}

const ALTURA_LINHA = 30;
const ESPESSURA_BARRA = 16; // ≤ 24px (skill: nunca preencher a faixa inteira)
const RAIO = 4;
const FONTE = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

const formatoPadrao = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

let canvasMedida: CanvasRenderingContext2D | null = null;
function larguraTexto(texto: string): number {
  canvasMedida ??= document.createElement('canvas').getContext('2d');
  if (!canvasMedida) return texto.length * 7;
  canvasMedida.font = FONTE;
  return canvasMedida.measureText(texto).width;
}

// Corta com "…" até caber — rótulo nunca vaza nem é cortado pela metade.
function caber(texto: string, largura: number): string {
  if (larguraTexto(texto) <= largura) return texto;
  let fim = texto.length;
  while (fim > 1 && larguraTexto(texto.slice(0, fim) + '…') > largura) fim--;
  return texto.slice(0, fim) + '…';
}

// Barra com ponta de dado arredondada (direita) e base reta (esquerda, na linha de base).
function caminhoBarra(x: number, y: number, w: number, h: number): string {
  if (w <= 0) return '';
  const r = Math.min(RAIO, w, h / 2);
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}

type ElementoComGrafico = HTMLElement & { __vizObserver?: ResizeObserver; __vizRedesenhar?: () => void };

/** Barras horizontais ordenadas — contagem (ou medida) por categoria, uma série só. */
export function drawBarrasHorizontais<T extends ChartDatum>(
  elementRef: ElementRef, dados: T[], options: BarrasOptions<T>,
): void {
  const el = elementRef.nativeElement as ElementoComGrafico;
  el.__vizRedesenhar = () => desenhar(el, dados, options);
  // Redesenha sozinho quando o card muda de largura (menu recolhido, janela, celular).
  if (!el.__vizObserver && typeof ResizeObserver !== 'undefined') {
    let largura = el.clientWidth;
    el.__vizObserver = new ResizeObserver(() => {
      if (el.clientWidth !== largura) { largura = el.clientWidth; el.__vizRedesenhar?.(); }
    });
    el.__vizObserver.observe(el);
  }
  desenhar(el, dados, options);
}

/** Remove gráfico, tooltip e observer (chamar no ngOnDestroy). */
export function limparGrafico(elementRef: ElementRef | undefined): void {
  const el = elementRef?.nativeElement as ElementoComGrafico | undefined;
  if (!el) return;
  el.__vizObserver?.disconnect();
  el.__vizObserver = undefined;
  el.__vizRedesenhar = undefined;
  d3.select(el).selectAll('.viz-root').remove();
}

function desenhar<T extends ChartDatum>(el: HTMLElement, dadosBrutos: T[], options: BarrasOptions<T>): void {
  const fmt = options.formatValue ?? formatoPadrao;
  const max = options.max ?? 10;
  const mostrarPct = options.mostrarPercentual ?? true;

  let dados: (T | ChartDatum)[] = options.ordenar === false
    ? [...dadosBrutos]
    : [...dadosBrutos].sort((a, b) => b.value - a.value);
  if (dados.length > max) {
    const resto = dados.slice(max - 1).reduce((s, d) => s + d.value, 0);
    dados = [...dados.slice(0, max - 1), { name: 'Outros', value: resto }];
  }
  const total = dadosBrutos.reduce((s, d) => s + d.value, 0);

  d3.select(el).selectAll('.viz-root').remove();
  const root = d3.select(el).append('div').attr('class', 'viz-root');

  if (dados.length === 0 || total === 0) {
    root.append('p').attr('class', 'viz-vazio').text('Sem dados no período.');
    return;
  }

  const largura = Math.max(el.clientWidth || 320, 240);
  const valores = dados.map(d => fmt(d.value));
  const larguraValor = Math.max(...valores.map(larguraTexto)) + 10;
  const larguraRotulo = Math.min(Math.max(...dados.map(d => larguraTexto(d.name))) + 12, largura * 0.42, 200);
  const larguraPlot = Math.max(largura - larguraRotulo - larguraValor, 40);
  const altura = dados.length * ALTURA_LINHA;

  const x = d3.scaleLinear().domain([0, d3.max(dados, d => d.value) ?? 1]).range([0, larguraPlot]);

  const svg = root.append('svg')
    .attr('width', largura).attr('height', altura)
    .attr('role', 'img').attr('aria-label', options.ariaLabel)
    .style('display', 'block').style('overflow', 'visible');

  // Linha de base (hairline): de onde todas as barras crescem.
  svg.append('line').attr('class', 'viz-baseline')
    .attr('x1', larguraRotulo).attr('x2', larguraRotulo).attr('y1', 0).attr('y2', altura);

  const tooltip = root.append('div').attr('class', 'viz-tooltip').attr('role', 'tooltip').style('opacity', '0');

  const linha = svg.selectAll('g.viz-linha').data(dados).enter().append('g')
    .attr('class', 'viz-linha')
    .attr('transform', (_, i) => `translate(0,${i * ALTURA_LINHA})`)
    .attr('tabindex', 0)
    .attr('aria-label', d => textoAcessivel(d, total, fmt, mostrarPct));

  // Área de hover = linha inteira (bem maior que a barra).
  linha.append('rect').attr('class', 'viz-hit')
    .attr('x', 0).attr('y', 0).attr('width', largura).attr('height', ALTURA_LINHA).attr('rx', 4);

  linha.append('text').attr('class', 'viz-rotulo')
    .attr('x', larguraRotulo - 8).attr('y', ALTURA_LINHA / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
    .text(d => caber(d.name, larguraRotulo - 12));

  const topoBarra = (ALTURA_LINHA - ESPESSURA_BARRA) / 2;
  linha.append('path').attr('class', 'viz-barra')
    .attr('d', d => caminhoBarra(larguraRotulo, topoBarra, Math.max(x(d.value), d.value > 0 ? 2 : 0), ESPESSURA_BARRA));

  linha.append('text').attr('class', 'viz-valor')
    .attr('x', d => larguraRotulo + x(d.value) + 6).attr('y', ALTURA_LINHA / 2).attr('dy', '0.35em')
    .text((_, i) => valores[i]);

  const mostrar = (evento: MouseEvent | FocusEvent, d: T | ChartDatum, alvo: SVGGElement) => {
    const extra = options.detalhe && d.name !== 'Outros' ? options.detalhe(d as T) : null;
    const pct = mostrarPct ? ` · ${Math.round((d.value / total) * 100)}% do total` : '';
    tooltip.html('')
      .call(t => t.append('div').attr('class', 'viz-tooltip-titulo').text(d.name))
      .call(t => t.append('div').text(`${fmt(d.value)}${pct}`))
      .call(t => { if (extra) t.append('div').attr('class', 'viz-tooltip-extra').text(extra); });
    const caixa = el.getBoundingClientRect();
    const linhaCaixa = alvo.getBoundingClientRect();
    const px = evento instanceof MouseEvent ? evento.clientX - caixa.left : larguraRotulo + 12;
    const py = linhaCaixa.top - caixa.top;
    const larguraTooltip = (tooltip.node() as HTMLElement).offsetWidth;
    tooltip
      .style('left', `${Math.min(Math.max(px + 12, 0), largura - larguraTooltip)}px`)
      .style('top', `${Math.max(py - 8 - (tooltip.node() as HTMLElement).offsetHeight, 0)}px`)
      .style('opacity', '1');
    d3.select(alvo).classed('ativo', true);
  };
  const esconder = (alvo: SVGGElement) => {
    tooltip.style('opacity', '0');
    d3.select(alvo).classed('ativo', false);
  };

  linha
    .on('mousemove', function (evento: MouseEvent, d) { mostrar(evento, d, this as SVGGElement); })
    .on('focus', function (evento: FocusEvent, d) { mostrar(evento, d, this as SVGGElement); })
    .on('mouseleave blur', function () { esconder(this as SVGGElement); });

  // Tabela equivalente, só pra leitor de tela.
  const tabela = root.append('table').attr('class', 'sr-only');
  tabela.append('caption').text(options.ariaLabel);
  const cab = tabela.append('thead').append('tr');
  cab.append('th').text('Categoria');
  cab.append('th').text('Valor');
  if (mostrarPct) cab.append('th').text('% do total');
  const corpo = tabela.append('tbody');
  dados.forEach((d, i) => {
    const tr = corpo.append('tr');
    tr.append('td').text(d.name);
    tr.append('td').text(valores[i]);
    if (mostrarPct) tr.append('td').text(`${Math.round((d.value / total) * 100)}%`);
  });
}

function textoAcessivel(d: ChartDatum, total: number, fmt: (v: number) => string, mostrarPct: boolean): string {
  const pct = mostrarPct ? ` (${Math.round((d.value / total) * 100)}% do total)` : '';
  return `${d.name}: ${fmt(d.value)}${pct}`;
}

// ── Linhas (tendência / curva) ───────────────────────────────────────────────
// Até 4 séries, cor fixa por ENTIDADE (quem chama passa `cor` 1–4 — a fase A é sempre
// a cor 1, mesmo que a B não apareça). Linha 2px, marcador 8px com anel branco, legenda
// sempre (≥ 2 séries) + rótulo direto no último ponto, linha de referência tracejada com
// o próprio rótulo (ex.: mínimo da norma). Hover: régua vertical + tooltip com todas as
// séries naquele x; teclado: foco no gráfico e ←/→.

export interface PontoLinha {
  x: number; // timestamp (eixo 'data') ou valor (eixo 'log')
  y: number;
  /** Texto extra no tooltip (ex.: "fundo de escala"). */
  nota?: string;
}

export interface SerieLinha {
  nome: string;
  /** Slot da paleta categórica (1–4), fixo por entidade. */
  cor: 1 | 2 | 3 | 4;
  pontos: PontoLinha[];
}

export interface LinhasOptions {
  ariaLabel: string;
  eixoX: 'data' | 'log';
  /** Ticks do eixo x quando 'log' (ex.: [0.5, 1, 10] minutos). */
  ticksX?: number[];
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  /** Escala log no y (valores que variam em décadas, ex.: MΩ). */
  yLog?: boolean;
  /** Linha horizontal de referência (ex.: mínimo IEEE 43). */
  referencia?: { valor: number; rotulo: string };
  /** Cabeçalho da coluna x na tabela pra leitor de tela. */
  rotuloX: string;
  altura?: number;
}

export function drawLinhas(elementRef: ElementRef, series: SerieLinha[], options: LinhasOptions): void {
  const el = elementRef.nativeElement as ElementoComGrafico;
  el.__vizRedesenhar = () => desenharLinhas(el, series, options);
  if (!el.__vizObserver && typeof ResizeObserver !== 'undefined') {
    let largura = el.clientWidth;
    el.__vizObserver = new ResizeObserver(() => {
      if (el.clientWidth !== largura) { largura = el.clientWidth; el.__vizRedesenhar?.(); }
    });
    el.__vizObserver.observe(el);
  }
  desenharLinhas(el, series, options);
}

function desenharLinhas(el: HTMLElement, seriesBrutas: SerieLinha[], options: LinhasOptions): void {
  d3.select(el).selectAll('.viz-root').remove();
  const root = d3.select(el).append('div').attr('class', 'viz-root');

  const series = seriesBrutas
    .map(s => ({
      ...s,
      pontos: s.pontos.filter(p => Number.isFinite(p.y) && (!options.yLog || p.y > 0)).sort((a, b) => a.x - b.x),
    }))
    .filter(s => s.pontos.length > 0);
  if (!series.length) {
    root.append('p').attr('class', 'viz-vazio').text('Sem leituras para mostrar.');
    return;
  }

  // Legenda (HTML) — identidade nunca só pela cor.
  if (series.length >= 2) {
    const legenda = root.append('div').attr('class', 'viz-legenda');
    series.forEach(s => {
      const item = legenda.append('span').attr('class', `viz-legenda-item viz-cor-${s.cor}`);
      item.append('span').attr('class', 'viz-legenda-cor');
      item.append('span').text(s.nome);
    });
  }

  const xs = [...new Set(series.flatMap(s => s.pontos.map(p => p.x)))].sort((a, b) => a - b);
  const ys = series.flatMap(s => s.pontos.map(p => p.y));
  if (options.referencia) ys.push(options.referencia.valor);

  const largura = Math.max(el.clientWidth || 320, 260);
  const altura = options.altura ?? 240;
  const margemDireita = Math.min(Math.max(...series.map(s => larguraTexto(s.nome))) + 16, largura * 0.25);

  // Escala y
  const yMin = d3.min(ys) ?? 0;
  const yMax = d3.max(ys) ?? 1;
  let y: d3.ScaleContinuousNumeric<number, number>;
  let ticksY: number[];
  if (options.yLog) {
    // Sem .nice(): no log ele arredonda pra potência de 10 e achata curvas que variam pouco.
    const s = d3.scaleLog().domain([Math.max(yMin / 1.35, 1e-3), yMax * 1.35]);
    // Potências de 10 quando o dado cobre várias décadas; senão a sequência 1-2-5
    // (100, 200, 500, 1.000...); se a faixa for estreita demais, até 6 ticks da própria faixa.
    const dez = s.ticks().filter(t => Math.abs(Math.log10(t) - Math.round(Math.log10(t))) < 1e-9);
    const umDoisCinco = s.ticks().filter(t => /^[125](\.0+)?e/.test(t.toExponential()));
    if (dez.length >= 3) {
      ticksY = dez;
    } else if (umDoisCinco.length >= 3) {
      ticksY = umDoisCinco;
    } else {
      const todos = s.ticks(6);
      const passo = Math.ceil(todos.length / 6);
      ticksY = todos.filter((_, i) => i % passo === 0);
    }
    y = s;
  } else {
    const s = d3.scaleLinear().domain([0, yMax * 1.15 || 1]).nice();
    ticksY = s.ticks(5);
    y = s;
  }
  const margemEsquerda = Math.max(...ticksY.map(t => larguraTexto(options.formatY(t)))) + 12;
  const margem = { top: 14, right: margemDireita, bottom: 26, left: margemEsquerda };
  const plotW = Math.max(largura - margem.left - margem.right, 60);
  const plotH = altura - margem.top - margem.bottom;
  y.range([plotH, 0]);

  // Escala x
  let x: (v: number) => number;
  let ticksX: number[];
  if (options.eixoX === 'log') {
    const todos = [...xs, ...(options.ticksX ?? [])];
    const s = d3.scaleLog().domain([Math.min(...todos) / 1.4, Math.max(...todos) * 1.4]).range([0, plotW]);
    x = v => s(v);
    ticksX = options.ticksX ?? xs;
  } else {
    const ini = xs[0];
    const fim = xs[xs.length - 1];
    const folga = fim === ini ? 30 * 86400000 : (fim - ini) * 0.06;
    const s = d3.scaleTime().domain([new Date(ini - folga), new Date(fim + folga)]).range([0, plotW]);
    x = v => s(new Date(v));
    // As próprias datas dos ensaios quando couberem; senão ticks automáticos.
    const cabem = Math.max(2, Math.floor(plotW / 64)); // "dd/mm/aa" ≈ 50px
    ticksX = xs.length <= cabem ? xs : s.ticks(cabem).map(d => d.getTime());
  }

  const svg = root.append('svg')
    .attr('width', largura).attr('height', altura)
    .attr('role', 'img').attr('aria-label', options.ariaLabel)
    .attr('tabindex', 0)
    .style('display', 'block').style('overflow', 'visible');
  const g = svg.append('g').attr('transform', `translate(${margem.left},${margem.top})`);

  // Grade horizontal + eixos (recessivos)
  ticksY.forEach(t => {
    g.append('line').attr('class', 'viz-grade').attr('x1', 0).attr('x2', plotW).attr('y1', y(t)).attr('y2', y(t));
    g.append('text').attr('class', 'viz-eixo').attr('x', -8).attr('y', y(t)).attr('dy', '0.35em')
      .attr('text-anchor', 'end').text(options.formatY(t));
  });
  g.append('line').attr('class', 'viz-baseline').attr('x1', 0).attr('x2', plotW).attr('y1', plotH).attr('y2', plotH);
  ticksX.forEach(t => {
    g.append('text').attr('class', 'viz-eixo').attr('x', x(t)).attr('y', plotH + 17)
      .attr('text-anchor', 'middle').text(options.formatX(t));
  });

  if (options.referencia) {
    const ry = y(options.referencia.valor);
    g.append('line').attr('class', 'viz-referencia').attr('x1', 0).attr('x2', plotW).attr('y1', ry).attr('y2', ry);
    g.append('text').attr('class', 'viz-referencia-rotulo').attr('x', 4).attr('y', ry - 5).text(options.referencia.rotulo);
  }

  const linha = d3.line<PontoLinha>().x(p => x(p.x)).y(p => y(p.y));
  series.forEach(s => {
    const gs = g.append('g').attr('class', `viz-cor-${s.cor}`);
    gs.append('path').attr('class', 'viz-serie').attr('d', linha(s.pontos) ?? '');
    gs.selectAll(null).data(s.pontos).enter().append('circle')
      .attr('class', 'viz-marcador').attr('r', 4).attr('cx', p => x(p.x)).attr('cy', p => y(p.y));
  });

  // Rótulo direto no último ponto, empurrado pra baixo quando encosta no vizinho.
  const rotulos = series
    .map(s => {
      const p = s.pontos[s.pontos.length - 1];
      return { nome: s.nome, xPos: x(p.x), yPos: y(p.y) };
    })
    .sort((a, b) => a.yPos - b.yPos);
  for (let i = 1; i < rotulos.length; i++) {
    if (rotulos[i].yPos - rotulos[i - 1].yPos < 14) rotulos[i].yPos = rotulos[i - 1].yPos + 14;
  }
  rotulos.forEach(r => {
    g.append('text').attr('class', 'viz-rotulo-direto').attr('x', r.xPos + 8).attr('y', r.yPos).attr('dy', '0.35em')
      .text(caber(r.nome, Math.max(plotW + margemDireita - r.xPos - 10, 20)));
  });

  // Hover / teclado
  const regua = g.append('line').attr('class', 'viz-regua').attr('y1', 0).attr('y2', plotH).style('opacity', '0');
  const tooltip = root.append('div').attr('class', 'viz-tooltip').attr('role', 'tooltip').style('opacity', '0');
  let atual = -1;
  const mostrar = (i: number) => {
    atual = i;
    const vx = xs[i];
    const px = x(vx);
    regua.attr('x1', px).attr('x2', px).style('opacity', '1');
    g.selectAll<SVGCircleElement, PontoLinha>('circle.viz-marcador').classed('ativo', p => p.x === vx);
    tooltip.html('');
    tooltip.append('div').attr('class', 'viz-tooltip-titulo').text(options.formatX(vx));
    series.forEach(s => {
      const p = s.pontos.find(q => q.x === vx);
      if (!p) return;
      const l = tooltip.append('div').attr('class', `viz-tooltip-serie viz-cor-${s.cor}`);
      l.append('span').attr('class', 'viz-legenda-cor');
      l.append('span').text(`${s.nome}: ${options.formatY(p.y)}${p.nota ? ` (${p.nota})` : ''}`);
    });
    if (options.referencia) tooltip.append('div').attr('class', 'viz-tooltip-extra').text(options.referencia.rotulo);
    const node = tooltip.node() as HTMLElement;
    const topoSvg = (svg.node() as SVGSVGElement).getBoundingClientRect().top - el.getBoundingClientRect().top;
    const esquerda = margem.left + px + 14;
    tooltip
      .style('left', `${esquerda + node.offsetWidth > largura ? Math.max(margem.left + px - node.offsetWidth - 14, 0) : esquerda}px`)
      .style('top', `${topoSvg + margem.top}px`)
      .style('opacity', '1');
  };
  const esconder = () => {
    atual = -1;
    regua.style('opacity', '0');
    g.selectAll('circle.viz-marcador').classed('ativo', false);
    tooltip.style('opacity', '0');
  };
  // Área de hover = plot inteiro (bem maior que os marcadores); pega o x mais próximo.
  g.append('rect').attr('class', 'viz-hit').attr('width', plotW).attr('height', plotH)
    .on('mousemove', (evento: MouseEvent) => {
      const [mx] = d3.pointer(evento);
      let melhor = 0;
      xs.forEach((v, i) => { if (Math.abs(x(v) - mx) < Math.abs(x(xs[melhor]) - mx)) melhor = i; });
      if (melhor !== atual) mostrar(melhor);
    })
    .on('mouseleave', esconder);
  svg
    .on('focus', () => mostrar(xs.length - 1))
    .on('blur', esconder)
    .on('keydown', (evento: KeyboardEvent) => {
      if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
      evento.preventDefault();
      const passo = evento.key === 'ArrowLeft' ? -1 : 1;
      mostrar(Math.min(Math.max(atual < 0 ? xs.length - 1 : atual + passo, 0), xs.length - 1));
    });

  // Tabela equivalente, só pra leitor de tela.
  const tabela = root.append('table').attr('class', 'sr-only');
  tabela.append('caption').text(options.ariaLabel);
  const cab = tabela.append('thead').append('tr');
  cab.append('th').text(options.rotuloX);
  series.forEach(s => cab.append('th').text(s.nome));
  const corpo = tabela.append('tbody');
  xs.forEach(vx => {
    const tr = corpo.append('tr');
    tr.append('td').text(options.formatX(vx));
    series.forEach(s => {
      const p = s.pontos.find(q => q.x === vx);
      tr.append('td').text(p ? `${options.formatY(p.y)}${p.nota ? ` (${p.nota})` : ''}` : '—');
    });
  });
}
