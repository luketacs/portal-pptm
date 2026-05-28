import {
  ChangeDetectionStrategy, Component, OnInit,
  computed, signal, ElementRef, viewChild, effect, OnDestroy, EffectRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApontamentosService, Apontamento, ApontamentosStats, EquipeTab,
} from '../../services/apontamentos.service';
import * as d3 from 'd3';

type Periodo = 15 | 30 | 60 | 90;

const STATUS_CORES: Record<string, string> = {
  EXEC: '#22c55e', EXPA: '#3b82f6', PREP: '#f59e0b',
  CONC: '#6366f1', INSP: '#14b8a6', SUSP: '#ef4444',
};

const EQUIPE_LABEL: Record<EquipeTab, string> = {
  eletrica: '⚡ Elétrica',
  mecanica: '🔧 Mecânica',
  operacao: '🏗 Operação',
};

@Component({
  selector: 'app-apontamentos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './apontamentos.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApontamentosComponent implements OnInit, OnDestroy {
  private efectRef?: EffectRef;
  private statusChartEl = viewChild<ElementRef>('statusChart');
  private areaChartEl   = viewChild<ElementRef>('areaChart');

  equipeAtiva  = signal<EquipeTab>('eletrica');
  periodoAtivo = signal<Periodo>(90);          // carrega sempre 90 dias (janela máxima)
  mesSelecionado = signal('');                 // '' = sem filtro de mês, 'YYYY-MM' = mês específico
  readonly periodos: Periodo[] = [15, 30, 60, 90];
  readonly equipes: EquipeTab[] = ['eletrica', 'mecanica', 'operacao'];
  readonly equipeLabel = EQUIPE_LABEL;

  // Gera os últimos 12 meses para o dropdown
  readonly meses = (() => {
    const result: { value: string; label: string }[] = [{ value: '', label: 'Todos os meses' }];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return result;
  })();

  searchExecutante = signal('');
  searchOS         = signal('');

  private _todos = signal<Apontamento[]>([]);
  totalBruto = signal(0);
  amostraExecutantes = signal<string[]>([]);

  dadosDaEquipe = computed(() => {
    const equipe = this.service.filtrarPorEquipe(this._todos(), this.equipeAtiva());
    const mes = this.mesSelecionado();
    if (!mes) return equipe;
    // Filtra pelo mês selecionado
    return equipe.filter(a => a.data && a.data.startsWith(mes));
  });

  dadosFiltrados = computed(() => {
    const dados = this.dadosDaEquipe();
    const exec  = this.searchExecutante().trim().toLowerCase();
    const os    = this.searchOS().trim().toLowerCase();
    if (!exec && !os) return dados;
    return dados.filter(a =>
      (!exec || (a.executante ?? '').toLowerCase().includes(exec)) &&
      (!os   || (a.id_sigma_os ?? '').toLowerCase().includes(os))
    );
  });

  stats = computed<ApontamentosStats>(() =>
    this.service.calcularStats(this.dadosFiltrados(), this.equipeAtiva())
  );

  countPorEquipe = computed(() => {
    const todos = this._todos();
    return {
      eletrica: this.service.filtrarPorEquipe(todos, 'eletrica').length,
      mecanica: this.service.filtrarPorEquipe(todos, 'mecanica').length,
      operacao: this.service.filtrarPorEquipe(todos, 'operacao').length,
    };
  });

  membrosEquipe = computed(() =>
    this.service.getColaboradoresPorEquipe(this.equipeAtiva()).length
  );

  diagnostico = computed(() => {
    const membros = this.service.getColaboradoresPorEquipe(this.equipeAtiva());
    return {
      totalSIGMA: this.totalBruto(),
      totalEquipe: this.dadosDaEquipe().length,
      amostraExecutantes: this.amostraExecutantes().join(' · ') || '—',
      amostraMembros: membros.slice(0, 5).map(c => c.nome).join(' · ') || '—',
      qtdMembros: membros.length,
    };
  });

  isLoading        = this.service.isLoading;
  lastUpdated      = this.service.lastUpdated;
  error            = this.service.error;
  ultimaImportacao = this.service.ultimaImportacao;
  isImporting      = signal(false);
  importError      = signal('');
  importSuccess    = signal('');

  constructor(public service: ApontamentosService) {}

  async ngOnInit(): Promise<void> {
    await this.service.loadColaboradores();
    await this.carregar();

    this.efectRef = effect(() => {
      const s = this.stats();
      const statusEl = this.statusChartEl();
      const areaEl   = this.areaChartEl();
      if (s.totalOS === 0) return;
      if (statusEl) this.desenharPizza(statusEl, s.porStatus.map(x => ({ name: x.status, value: x.count })));
      if (areaEl)   this.desenharBarras(areaEl,   s.porArea.map(x => ({ name: x.area, value: x.horas })));
    });
  }

  ngOnDestroy(): void { this.efectRef?.destroy(); }

  async carregar(): Promise<void> {
    const dados = await this.service.loadApontamentos(this.periodoAtivo());
    this._todos.set(dados);
    this.totalBruto.set(dados.length);
    const exec = [...new Set(dados.map(d => d.executante).filter(Boolean))].slice(0, 8);
    this.amostraExecutantes.set(exec);
  }

  async atualizar(): Promise<void> { await this.carregar(); }

  async onFileImport(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';

    this.isImporting.set(true);
    this.importError.set('');
    this.importSuccess.set('');
    try {
      const { inseridos } = await this.service.importarArquivo(file);
      this.importSuccess.set(`✅ ${inseridos} apontamentos importados com sucesso!`);
      setTimeout(() => this.importSuccess.set(''), 5000);
      await this.carregar(); // recarrega os dados
    } catch (err: unknown) {
      this.importError.set(err instanceof Error ? err.message : 'Erro ao importar.');
    } finally {
      this.isImporting.set(false);
    }
  }

  setEquipe(e: EquipeTab): void   { this.equipeAtiva.set(e); }
  setPeriodo(p: Periodo): void    { this.periodoAtivo.set(p); this.carregar(); }

  formatDate(str: string): string { return this.service.formatDate(str); }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      EXEC: 'bg-green-100 text-green-800', EXPA: 'bg-blue-100 text-blue-800',
      PREP: 'bg-yellow-100 text-yellow-800', CONC: 'bg-indigo-100 text-indigo-800',
      SUSP: 'bg-red-100 text-red-800',
    };
    return map[status?.trim().toUpperCase()] ?? 'bg-gray-100 text-gray-700';
  }

  // ── D3 Charts ─────────────────────────────────────────────────────────────

  private desenharPizza(ref: ElementRef, data: { name: string; value: number }[]): void {
    const el = ref.nativeElement;
    const W = el.offsetWidth || 320, H = 240, R = Math.min(W, H) / 2 - 16;
    d3.select(el).select('svg').remove();
    if (!data.length) return;

    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H)
      .append('g').attr('transform', `translate(${W / 2},${H / 2})`);

    const colors = d3.scaleOrdinal<string>().domain(data.map(d => d.name))
      .range(data.map(d => STATUS_CORES[d.name] ?? '#94a3b8'));
    const pie  = d3.pie<{ name: string; value: number }>().value(d => d.value).sort(null);
    const arc  = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(R * 0.5).outerRadius(R);
    const larc = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(R + 12).outerRadius(R + 12);

    const g = svg.selectAll('.arc').data(pie(data)).enter().append('g');
    g.append('path').attr('d', arc).style('fill', d => colors(d.data.name) as string)
     .attr('stroke', 'white').style('stroke-width', '1.5px');
    g.append('title').text(d => `${d.data.name}: ${d.data.value}`);

    const total = data.reduce((s, d) => s + d.value, 0);
    g.filter(d => d.data.value / total >= 0.07)
     .append('text')
     .attr('transform', d => `translate(${larc.centroid(d)})`)
     .attr('dy', '0.35em').style('font-size', '11px').style('font-weight', '600').style('fill', '#334155')
     .style('text-anchor', d => larc.centroid(d)[0] >= 0 ? 'start' : 'end')
     .text(d => `${d.data.name} (${d.data.value})`);

    svg.append('text').attr('dy', '-0.2em').style('text-anchor', 'middle')
       .style('font-size', '20px').style('font-weight', '700').style('fill', '#0f172a').text(total);
    svg.append('text').attr('dy', '1.1em').style('text-anchor', 'middle')
       .style('font-size', '11px').style('fill', '#64748b').text('Apontamentos');
  }

  private desenharBarras(ref: ElementRef, data: { name: string; value: number }[]): void {
    const el = ref.nativeElement;
    d3.select(el).select('svg').remove();
    const top = data.slice(0, 8);
    if (!top.length) return;

    const margin = { top: 10, right: 55, bottom: 10, left: 140 };
    const W = (el.offsetWidth || 400) - margin.left - margin.right;
    const H = top.length * 32;

    const svg = d3.select(el).append('svg')
      .attr('width', W + margin.left + margin.right).attr('height', H + margin.top + margin.bottom)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand().range([0, H]).domain(top.map(d => d.name)).padding(0.3);
    const x = d3.scaleLinear().range([0, W]).domain([0, (d3.max(top, d => d.value) ?? 1) * 1.05]);

    svg.selectAll('.bar').data(top).enter().append('rect')
       .attr('y', d => y(d.name) ?? 0).attr('height', y.bandwidth())
       .attr('x', 0).attr('width', d => x(d.value)).attr('fill', '#3b82f6').attr('rx', 3);

    svg.selectAll('.label').data(top).enter().append('text')
       .attr('y', d => (y(d.name) ?? 0) + y.bandwidth() / 2).attr('x', d => x(d.value) + 5)
       .attr('dy', '0.35em').style('font-size', '11px').style('fill', '#475569')
       .text(d => `${d.value}h`);

    svg.append('g').call(d3.axisLeft(y).tickSize(0))
       .selectAll('text').style('font-size', '11px').style('fill', '#475569');
    svg.select('.domain').remove();
  }
}
