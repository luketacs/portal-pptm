import {
  ChangeDetectionStrategy, Component, OnInit,
  computed, signal, ElementRef, viewChild, effect, OnDestroy, EffectRef, Injector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApontamentosService, Apontamento, ApontamentosStats, EquipeTab,
} from '../../services/apontamentos.service';
import { AuthService } from '../../services/auth.service';
import { ActivatedRoute } from '@angular/router';
import { drawPieChart } from '../../utils/charts';
import * as d3 from 'd3';

const STATUS_CORES: Record<string, string> = {
  EXEC: '#22c55e', EXPA: '#3b82f6', PREP: '#f59e0b',
  CONC: '#6366f1', INSP: '#14b8a6', SUSP: '#ef4444',
};

const EQUIPE_LABEL: Record<EquipeTab, string> = {
  eletrica: 'Elétrica',
  mecanica: 'Mecânica',
  operacao: 'Operação',
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

  equipeAtiva       = signal<EquipeTab>('eletrica');
  filtroTipo        = signal<'mes' | 'semana'>('mes');
  mesSelecionado    = signal('');   // '' = todos, 'YYYY-MM' = mês
  semanaSelecionada = signal('');   // '' = todas, 'YYYY-MM-DD' = segunda da semana
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

  // Gera as últimas 20 semanas (segunda → domingo)
  readonly semanas = (() => {
    const iso  = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const br   = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    const result: { value: string; label: string; fim: string }[] = [
      { value: '', label: 'Todas as semanas', fim: '' },
    ];
    const hoje = new Date();
    const dow  = hoje.getDay(); // 0=Dom … 6=Sab
    const seg  = new Date(hoje);
    seg.setDate(hoje.getDate() + (dow === 0 ? -6 : 1 - dow));
    seg.setHours(0, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const ini = new Date(seg); ini.setDate(seg.getDate() - i * 7);
      const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
      result.push({ value: iso(ini), label: `${br(ini)} a ${br(fim)}/${fim.getFullYear()}`, fim: iso(fim) });
    }
    return result;
  })();

  searchExecutante = signal('');
  searchOS         = signal('');

  // Label descritivo do período selecionado
  periodoLabel = computed(() => {
    if (this.filtroTipo() === 'semana') {
      const semana = this.semanaSelecionada();
      if (!semana) return 'todas as semanas';
      const s = this.semanas.find(w => w.value === semana);
      return s ? `semana ${s.label}` : semana;
    }
    const mes = this.mesSelecionado();
    if (!mes) {
      const s = this.stats();
      if (s.periodoInicio && s.periodoFim) {
        const fmt = (d: string) => `${d.substring(5,7)}/${d.substring(0,4)}`;
        const inicio = fmt(s.periodoInicio);
        const fim    = fmt(s.periodoFim);
        return inicio === fim ? inicio : `${inicio} a ${fim}`;
      }
      return `ano (${new Date().getFullYear()})`;
    }
    const [ano, m] = mes.split('-').map(Number);
    const d = new Date(ano, m - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  });

  private _todos = signal<Apontamento[]>([]);
  totalBruto = signal(0);
  amostraExecutantes = signal<string[]>([]);

  dadosDaEquipe = computed(() => {
    const equipe = this.service.filtrarPorEquipe(this._todos(), this.equipeAtiva())
      .filter(a => !!a.data);

    if (this.filtroTipo() === 'semana') {
      const semana = this.semanaSelecionada();
      if (!semana) return equipe;
      const s = this.semanas.find(w => w.value === semana);
      if (!s) return equipe;
      return equipe.filter(a => a.data >= s.value && a.data <= s.fim);
    }

    const mes = this.mesSelecionado();
    if (!mes) return equipe;
    return equipe.filter(a => a.data.startsWith(mes));
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
    this.service.calcularStats(this.dadosFiltrados(), this.equipeAtiva(), this.mesSelecionado())
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

  publicMode = signal(false);
  isAdmin    = computed(() => this.authService.currentUser()?.role === 'Admin');

  // Relógio usado só para o countdown de rotação do modo TV (ver tvProximaEm).
  private now = signal(Date.now());
  private nowTimer?: ReturnType<typeof setInterval>;

  // Modo TV — ativado via ?tv=1 no link público. Alterna automaticamente entre as
  // equipes (Elétrica → Mecânica → Operação) para exibição contínua em painel/TV,
  // sem necessidade de interação manual.
  private readonly TV_ROTATION_MS = 25_000;
  // Sem botão "Atualizar" visível no modo TV — relê os dados do Supabase periodicamente
  // para refletir alguma atualização manual feita por um Admin, sem precisar recarregar a página.
  // Não baixa do SIGMA — só relê o que já está no banco.
  private readonly TV_REFRESH_MS = 5 * 60 * 1000;
  tvMode = signal(false);
  private tvRotationTimer?: ReturnType<typeof setInterval>;
  private tvRefreshTimer?: ReturnType<typeof setInterval>;
  private tvRotationStart = Date.now();

  tvProximaEm = computed(() => {
    if (!this.tvMode()) return 0;
    const decorrido = (this.now() - this.tvRotationStart) % this.TV_ROTATION_MS;
    return Math.max(0, Math.ceil((this.TV_ROTATION_MS - decorrido) / 1000));
  });

  private iniciarRotacaoTv(): void {
    this.tvRotationStart = Date.now();
    this.tvRotationTimer = setInterval(() => {
      const idx = this.equipes.indexOf(this.equipeAtiva());
      this.equipeAtiva.set(this.equipes[(idx + 1) % this.equipes.length]);
      this.tvRotationStart = Date.now();
    }, this.TV_ROTATION_MS);

    this.tvRefreshTimer = setInterval(() => this.carregar(), this.TV_REFRESH_MS);
  }

  constructor(
    public service: ApontamentosService,
    private injector: Injector,
    private authService: AuthService,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    // Detecta modo público via dados da rota
    this.publicMode.set(!!this.route.snapshot.data['publicMode']);

    // Modo TV — ?tv=1 no link público liga a rotação automática entre equipes
    if (this.publicMode() && this.route.snapshot.queryParamMap.get('tv') === '1') {
      this.tvMode.set(true);
      this.iniciarRotacaoTv();
    }

    await this.service.loadColaboradores();
    await this.carregar();

    // Atualiza o relógio a cada segundo para o countdown do modo TV
    this.nowTimer = setInterval(() => this.now.set(Date.now()), 1000);

    this.efectRef = effect(() => {
      const s = this.stats();
      const statusEl = this.statusChartEl();
      const areaEl   = this.areaChartEl();
      if (s.totalOS === 0) return;
      if (statusEl) {
        drawPieChart(statusEl, s.porStatus.map(x => ({ name: x.status, value: x.count })), {
          height: 240,
          radiusInset: 16,
          innerRadiusRatio: 0.5,
          labelRadiusOffset: 12,
          minPercentForLabel: 7,
          colorFn: d => STATUS_CORES[d.name] ?? '#94a3b8',
          label: d => `${d.name} (${d.value})`,
          centerLabel: 'Apontamentos',
        });
      }
      if (areaEl)   this.desenharBarras(areaEl,   s.porArea.map(x => ({ name: x.area, value: x.horas })));
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.efectRef?.destroy();
    clearInterval(this.nowTimer);
    clearInterval(this.tvRotationTimer);
    clearInterval(this.tvRefreshTimer);
  }

  async carregar(): Promise<void> {
    const dados = await this.service.loadApontamentos();

    this._todos.set(dados);
    this.totalBruto.set(dados.length);
    const exec = [...new Set(dados.map(d => d.executante).filter(Boolean))].slice(0, 8);
    this.amostraExecutantes.set(exec);
  }

  async onFileImport(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';

    this.isImporting.set(true);
    this.importError.set('');
    this.importSuccess.set('');
    try {
      const { inseridos, porMes } = await this.service.importarArquivo(file);
      const resumoMeses = Object.entries(porMes ?? {}).sort()
        .map(([m, n]) => `${m.substring(5)}/${m.substring(0,4)}: ${n}`).join(' | ');
      this.importSuccess.set(`✅ ${inseridos} registros importados. Meses: ${resumoMeses || '—'}`);
      setTimeout(() => this.importSuccess.set(''), 5000);
      await this.carregar(); // recarrega os dados
    } catch (err: unknown) {
      this.importError.set(err instanceof Error ? err.message : 'Erro ao importar.');
    } finally {
      this.isImporting.set(false);
    }
  }

  setEquipe(e: EquipeTab): void   { this.equipeAtiva.set(e); }

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
