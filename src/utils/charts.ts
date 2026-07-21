import { ElementRef } from '@angular/core';
import * as d3 from 'd3';

export interface ChartDatum {
  name: string;
  value: number;
}

export interface PieChartOptions<T extends ChartDatum> {
  height?: number;
  radiusInset?: number;
  innerRadiusRatio?: number;    // 0 = pizza cheia, >0 = donut
  labelRadiusOffset?: number;   // distância do rótulo além do raio externo
  minPercentForLabel?: number;  // pula o rótulo da fatia abaixo desse % do total
  label: (d: T) => string;
  tooltip?: (d: T) => string;
  centerLabel: string;          // texto pequeno abaixo do total, ex: "Materiais"
  colorScheme?: string[];
  colorFn?: (d: T) => string;   // tem prioridade sobre colorScheme
}

// Gráfico de pizza D3 — usado pelos dashboards de solicitações, materiais e apontamentos.
export function drawPieChart<T extends ChartDatum>(
  elementRef: ElementRef,
  data: T[],
  options: PieChartOptions<T>
): void {
  const element = elementRef.nativeElement;
  const width   = element.offsetWidth || 300;
  const height  = options.height ?? 260;
  const radius  = Math.min(width, height) / 2 - (options.radiusInset ?? 18);
  const inner   = radius * (options.innerRadiusRatio ?? 0.55);
  const minPct  = options.minPercentForLabel ?? 8;

  d3.select(element).select('svg').remove();
  if (!data.length) return;

  const svg = d3.select(element).append('svg')
    .attr('width', width).attr('height', height)
    .append('g').attr('transform', `translate(${width / 2},${height / 2})`);

  const colorScale = d3.scaleOrdinal<string>().range(options.colorScheme ?? d3.schemeTableau10 as unknown as string[]);
  const colorFor = (d: T): string => options.colorFn ? options.colorFn(d) : (colorScale(d.name) as string);

  const labelOffset = options.labelRadiusOffset ?? 14;
  const pie  = d3.pie<T>().value(d => d.value).sort(null);
  const arc  = d3.arc<d3.PieArcDatum<T>>().innerRadius(inner).outerRadius(radius);
  const lArc = d3.arc<d3.PieArcDatum<T>>().innerRadius(radius + labelOffset).outerRadius(radius + labelOffset);

  const total = data.reduce((s, d) => s + d.value, 0);

  const g = svg.selectAll('.arc').data(pie(data)).enter().append('g').attr('class', 'arc');

  g.append('path').attr('d', arc)
   .style('fill', d => colorFor(d.data))
   .attr('stroke', 'white').style('stroke-width', '1.5px');

  g.append('title').text(d => options.tooltip ? options.tooltip(d.data) : `${d.data.name}: ${d.data.value}`);

  g.filter(d => total > 0 && (d.data.value / total) * 100 >= minPct)
   .append('text')
   .attr('transform', d => `translate(${lArc.centroid(d)})`)
   .attr('dy', '0.35em').style('font-size', '12px').style('font-weight', '600').style('fill', '#334155')
   .style('text-anchor', d => lArc.centroid(d)[0] >= 0 ? 'start' : 'end')
   .text(d => options.label(d.data));

  svg.append('text').attr('dy', '-0.2em').style('text-anchor', 'middle')
     .style('font-size', '22px').style('font-weight', '700').style('fill', '#0f172a')
     .text(`${total}`);

  svg.append('text').attr('dy', '1.1em').style('text-anchor', 'middle')
     .style('font-size', '12px').style('fill', '#64748b').text(options.centerLabel);
}

export interface BarChartOptions<T extends ChartDatum> {
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  colorScheme?: string[];
  colorFn?: (d: T) => string;
  valueLabel?: (d: T) => string;
}

// Gráfico de barras verticais D3 — usado pelos dashboards de solicitações e materiais.
export function drawVerticalBarChart<T extends ChartDatum>(
  elementRef: ElementRef,
  data: T[],
  options: BarChartOptions<T> = {}
): void {
  const element = elementRef.nativeElement;
  const margin  = options.margin ?? { top: 20, right: 20, bottom: 40, left: 40 };
  const width   = (element.offsetWidth || 320) - margin.left - margin.right;
  const height  = (options.height ?? 260) - margin.top - margin.bottom;

  d3.select(element).select('svg').remove();
  if (!data.length) return;

  const svg = d3.select(element).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().range([0, width]).padding(0.25).domain(data.map(d => d.name));
  const maxVal = d3.max(data, d => d.value) ?? 1;
  const y = d3.scaleLinear().range([height, 0]).domain([0, maxVal * 1.1]);
  const colorScale = d3.scaleOrdinal<string>().range(options.colorScheme ?? d3.schemeTableau10 as unknown as string[]);
  const colorFor = (d: T): string => options.colorFn ? options.colorFn(d) : (colorScale(d.name) as string);

  svg.selectAll('.bar').data(data).enter().append('rect').attr('class', 'bar')
     .attr('x', d => x(d.name) ?? 0).attr('width', x.bandwidth())
     .attr('y', d => y(d.value)).attr('height', d => height - y(d.value))
     .attr('fill', d => colorFor(d)).attr('rx', 3);

  svg.selectAll('.label').data(data).enter().append('text')
     .attr('x', d => (x(d.name) ?? 0) + x.bandwidth() / 2)
     .attr('y', d => y(d.value) - 4)
     .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#475569')
     .text(d => options.valueLabel ? options.valueLabel(d) : String(d.value));

  svg.append('g').attr('transform', `translate(0,${height})`)
     .call(d3.axisBottom(x).tickSize(0))
     .select('.domain').remove();

  svg.append('g').call(d3.axisLeft(y).ticks(Math.min(maxVal, 5)).tickFormat(d3.format('d')));
}
