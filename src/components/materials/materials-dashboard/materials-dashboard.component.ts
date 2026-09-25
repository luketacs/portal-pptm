import {
  ChangeDetectionStrategy, Component, computed, signal,
  ElementRef, effect, viewChild, OnDestroy, EffectRef, OnInit, inject, Injector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MaterialService } from '../../../services/material.service';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { Material } from '../../../models/material.model';
import { drawBarrasHorizontais, limparGrafico } from '../../../utils/charts';

@Component({
  selector: 'app-materials-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './materials-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialsDashboardComponent implements OnInit, OnDestroy {
  private readonly injector = inject(Injector);
  private effectRef?: EffectRef;
  private destroyed = false;

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
      { name: 'Liberado',  value: lib,  percent: total ? Math.round((lib  / total) * 100) : 0 },
      { name: 'Pendente',  value: pend, percent: total ? Math.round((pend / total) * 100) : 0 },
    ];
  });

  // Só 2 estados → um medidor (% liberados), não pizza de 2 fatias (anti-padrão da
  // skill de dataviz: "2-slice pie → a stat tile. The number is the chart").
  percentualLiberado = computed(() => this.statusChartData()[0]?.percent ?? 0);

  // Tempo médio de liberação (created_at → released_at para materiais liberados)
  avgReleaseTime = computed(() => {
    const liberados = this.materials().filter(
      m => m.status === 'liberado' && m.created_at && m.released_at
    );
    if (!liberados.length) return null;

    const durations = liberados.map(m => {
      const created = new Date(m.created_at!).getTime();
      const updated = new Date(m.released_at!).getTime();
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
      .sort((a, b) => b.value - a.value);
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
    if (this.destroyed) return;
    this.materials.set(data ?? []);
    this.isLoading.set(false);

    this.effectRef = effect(() => {
      const mats = this.materials();
      if (!mats.length) return;

      const unitEl    = this.unitChartContainer();
      const creatorEl = this.creatorChartContainer();

      if (unitEl) {
        drawBarrasHorizontais(unitEl, this.unitChartData(), { ariaLabel: 'Materiais por unidade de medida' });
      }
      if (creatorEl) {
        // Top 8 cadastradores; o resto vira "Outros" (antes era cortado sem aviso).
        drawBarrasHorizontais(creatorEl, this.creatorChartData(), { ariaLabel: 'Materiais por cadastrador', max: 8 });
      }
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.effectRef?.destroy();
    limparGrafico(this.unitChartContainer());
    limparGrafico(this.creatorChartContainer());
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

}
