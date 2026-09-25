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
