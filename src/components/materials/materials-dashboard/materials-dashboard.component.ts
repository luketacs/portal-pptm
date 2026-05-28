import {
  ChangeDetectionStrategy, Component, computed, signal,
  ElementRef, effect, viewChild, OnDestroy, EffectRef, OnInit,
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MaterialService } from '../../../services/material.service';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { Material } from '../../../models/material.model';
import * as d3 from 'd3';

@Component({
  selector: 'app-materials-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink],
  templateUrl: './materials-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialsDashboardComponent implements OnInit, OnDestroy {
  private effectRef?: EffectRef;
  private readonly statusColorScheme = ['#22c55e', '#fbbf24'];
  private readonly unitColorScheme   = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff', '#1e40af'];

  private statusChartContainer = viewChild<ElementRef>('statusChart');
  private unitChartContainer   = viewChild<ElementRef>('unitChart');
  private creatorChartContainer = viewChild<ElementRef>('creatorChart');

  materials = signal<Material[]>([]);
  isLoading = signal(true);

  // KPIs
  total       = computed(() => this.materials().length);
  liberados   = computed(() => this.materials().filter(m => m.status === 'liberado').length);
  pendentes   = computed(() => this.materials().filter(m => (m.status ?? 'pendente') === 'pendente').length);
  comEstoque  = computed(() => this.materials().filter(m => m.estoque_seguranca).length);
  semCodigo   = computed(() => this.materials().filter(m => !m.codigo).length);

  // Dados para gráficos
  statusChartData = computed(() => {
    const all = this.materials();
    if (!all.length) return [];
    const lib = all.filter(m => m.status === 'liberado').length;
    const pend = all.length - lib;
    const total = all.length;
    return [
      { name: 'Liberado',  value: lib,  percent: total ? Math.round((lib  / total) * 100) : 0, color: '#22c55e' },
      { name: 'Pendente',  value: pend, percent: total ? Math.round((pend / total) * 100) : 0, color: '#fbbf24' },
    ];
  });

  // Tempo médio de liberação (created_at → updated_at para materiais liberados)
  avgReleaseTime = computed(() => {
    const liberados = this.materials().filter(
      m => m.status === 'liberado' && m.created_at && m.updated_at
    );
    if (!liberados.length) return null;

    const durations = liberados.map(m => {
      const created = new Date(m.created_at!).getTime();
      const updated = new Date(m.updated_at!).getTime();
      return updated - created;
    }).filter(d => d > 0);

    if (!durations.length) return null;

    const avgMs  = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minMs  = Math.min(...durations);
    const maxMs  = Math.max(...durations);
    return { avgMs, minMs, maxMs, count: durations.length };
  });

  unitChartData = computed(() => this.aggregateBy(this.materials(), 'unidade'));

  creatorChartData = computed(() => {
    const map: Record<string, number> = {};
    for (const m of this.materials()) {
      const name = m.created_by_name || 'Desconhecido';
      map[name] = (map[name] || 0) + 1;
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  });

  // Cross-reference: materiais com/sem solicitação de compra
  requestCrossRef = computed(() => {
    const allRequests = this.requestService.requests();
    const codesWithRequests = new Set(allRequests.map(r => r.materialCode.toUpperCase()));
    const mats = this.materials().filter(m => m.codigo);
    const com = mats.filter(m => codesWithRequests.has((m.codigo ?? '').toUpperCase())).length;
    const sem = mats.length - com;
    return { com, sem, total: mats.length };
  });

  // 5 mais recentes
  recentMaterials = computed(() =>
    [...this.materials()]
      .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())
      .slice(0, 5)
  );

  constructor(
    private materialService: MaterialService,
    private requestService: RequestService,
    public authService: AuthService,
  ) {}

  async ngOnInit(): Promise<void> {
    const { data } = await this.materialService.getAllMaterials();
    this.materials.set(data ?? []);
    this.isLoading.set(false);

    this.effectRef = effect(() => {
      const mats = this.materials();
      if (!mats.length) return;

      const statusEl  = this.statusChartContainer();
      const unitEl    = this.unitChartContainer();
      const creatorEl = this.creatorChartContainer();

      if (statusEl)  this.drawPieChart(statusEl,  this.statusChartData(), this.statusColorScheme);
      if (unitEl)    this.drawBarChart(unitEl,     this.unitChartData(),   this.unitColorScheme);
      if (creatorEl) this.drawBarChart(creatorEl,  this.creatorChartData(), this.unitColorScheme);
    });
  }

  ngOnDestroy(): void {
    this.effectRef?.destroy();
    [this.statusChartContainer(), this.unitChartContainer(), this.creatorChartContainer()]
      .forEach(el => { if (el) d3.select(el.nativeElement).select('svg').remove(); });
  }

  private aggregateBy(items: Material[], key: keyof Material): { name: string; value: number }[] {
    const map: Record<string, number> = {};
    for (const item of items) {
      const k = String(item[key] ?? 'Sem dado');
      map[k] = (map[k] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('pt-BR').format(new Date(iso));
  }

  formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    if (totalMinutes < 60) return `${Math.max(totalMinutes, 1)} min`;
    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24) return `${totalHours}h`;
    const days = Math.floor(totalHours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    return remDays > 0 ? `${months}m ${remDays}d` : `${months}m`;
  }

  // ─── D3 Charts ───────────────────────────────────────────────────────────

  private drawPieChart(elementRef: ElementRef, data: { name: string; value: number; percent: number; color: string }[], colorScheme: string[]): void {
    const element = elementRef.nativeElement;
    const width   = element.offsetWidth || 300;
    const height  = 260;
    const radius  = Math.min(width, height) / 2 - 18;
    const inner   = radius * 0.55;

    d3.select(element).select('svg').remove();
    const svg = d3.select(element).append('svg')
      .attr('width', width).attr('height', height)
      .append('g').attr('transform', `translate(${width / 2},${height / 2})`);

    const color  = d3.scaleOrdinal<string>().range(colorScheme);
    const pie    = d3.pie<{ name: string; value: number }>().value(d => d.value).sort(null);
    const arc    = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(inner).outerRadius(radius);
    const lArc   = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(radius + 14).outerRadius(radius + 14);

    const g = svg.selectAll('.arc').data(pie(data)).enter().append('g').attr('class', 'arc');

    g.append('path').attr('d', arc).style('fill', d => color(d.data.name) as string)
     .attr('stroke', 'white').style('stroke-width', '1.5px');

    g.append('title').text(d => `${d.data.name}: ${d.data.value}`);

    type DataWithPercent = { name: string; value: number; percent: number; color: string };
    g.filter(d => ((d.data as unknown as DataWithPercent).percent ?? 0) >= 8)
     .append('text')
     .attr('transform', d => `translate(${lArc.centroid(d)})`)
     .attr('dy', '0.35em').style('font-size', '12px').style('font-weight', '600').style('fill', '#334155')
     .style('text-anchor', d => lArc.centroid(d)[0] >= 0 ? 'start' : 'end')
     .text(d => `${(d.data as unknown as DataWithPercent).percent}%`);

    svg.append('text').attr('dy', '-0.2em').style('text-anchor', 'middle')
       .style('font-size', '22px').style('font-weight', '700').style('fill', '#0f172a')
       .text(`${data.reduce((s, d) => s + d.value, 0)}`);

    svg.append('text').attr('dy', '1.1em').style('text-anchor', 'middle')
       .style('font-size', '12px').style('fill', '#64748b').text('Materiais');
  }

  private drawBarChart(elementRef: ElementRef, data: { name: string; value: number }[], colorScheme: string[]): void {
    const element = elementRef.nativeElement;
    const margin  = { top: 20, right: 20, bottom: 40, left: 40 };
    const width   = (element.offsetWidth || 320) - margin.left - margin.right;
    const height  = 220 - margin.top - margin.bottom;

    d3.select(element).select('svg').remove();
    const svg = d3.select(element).append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x     = d3.scaleBand().range([0, width]).padding(0.25);
    const y     = d3.scaleLinear().range([height, 0]);
    const color = d3.scaleOrdinal<string>().range(colorScheme);

    x.domain(data.map(d => d.name));
    const maxVal = d3.max(data, d => d.value) ?? 1;
    y.domain([0, maxVal * 1.1]);

    svg.selectAll('.bar').data(data).enter().append('rect').attr('class', 'bar')
       .attr('x', d => x(d.name) ?? 0).attr('width', x.bandwidth())
       .attr('y', d => y(d.value)).attr('height', d => height - y(d.value))
       .attr('fill', d => color(d.name) as string).attr('rx', 3);

    svg.selectAll('.label').data(data).enter().append('text')
       .attr('x', d => (x(d.name) ?? 0) + x.bandwidth() / 2)
       .attr('y', d => y(d.value) - 4)
       .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#475569')
       .text(d => d.value);

    svg.append('g').attr('transform', `translate(0,${height})`)
       .call(d3.axisBottom(x).tickSize(0))
       .select('.domain').remove();

    svg.append('g').call(d3.axisLeft(y).ticks(Math.min(maxVal, 5)).tickFormat(d3.format('d')));
  }
}
