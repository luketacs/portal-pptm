import { ChangeDetectionStrategy, Component, computed, signal, ElementRef, effect, viewChild, OnDestroy, EffectRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RequestService } from '../../services/request.service';
import { PurchaseRequest, RequestStatus } from '../../models/request.model';
import { AuthService } from '../../services/auth.service';
import { drawBarrasHorizontais, limparGrafico } from '../../utils/charts';

type DashboardPeriod = 'week' | 'month' | '3months' | 'year' | 'all';

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
    week: '7 dias',
    month: 'Mês atual',
    '3months': '3 meses',
    year: 'Ano atual',
    all: 'Todo período',
};

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, CurrencyPipe],
    templateUrl: './dashboard.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnDestroy {
    private effectRef?: EffectRef;

    readonly periods: DashboardPeriod[] = ['week', 'month', '3months', 'year', 'all'];
    readonly periodLabels = PERIOD_LABELS;
    selectedPeriod = signal<DashboardPeriod>('all');

    requests;
    canViewDashboard;

    private statusChartContainer = viewChild<ElementRef>('statusChart');
    private typeChartContainer = viewChild<ElementRef>('typeChart');
    private tempoChartContainer = viewChild<ElementRef>('tempoChart');

    dateRange = computed<{ from: Date; to: Date } | null>(() => {
        const period = this.selectedPeriod();
        const now = new Date();
        switch (period) {
            case 'week': {
                const from = new Date(now);
                from.setDate(now.getDate() - 7);
                from.setHours(0, 0, 0, 0);
                return { from, to: now };
            }
            case 'month': {
                const from = new Date(now.getFullYear(), now.getMonth(), 1);
                return { from, to: now };
            }
            case '3months': {
                const from = new Date(now);
                from.setMonth(now.getMonth() - 3);
                from.setHours(0, 0, 0, 0);
                return { from, to: now };
            }
            case 'year': {
                const from = new Date(now.getFullYear(), 0, 1);
                return { from, to: now };
            }
            case 'all':
                return null;
        }
    });

    filteredForPeriod = computed(() => {
        const range = this.dateRange();
        if (!range) return this.requests();
        return this.requests().filter(r => r.requestDate >= range.from && r.requestDate <= range.to);
    });

    // KPI Signals
    totalRequests;
    pendingApproval;
    inProgress;
    totalSpentInPeriod;
    totalSpentValue;
    avgTimePerStatus;
    statusChartData;
    totalStatusRequests;

    constructor(public requestService: RequestService, public authService: AuthService) {
        this.requests = this.requestService.requests;
        this.canViewDashboard = computed(() => {
            const role = this.authService.currentUser()?.role;
            return role === 'Admin' || role === 'Visualizador';
        });

        // Contagens de status: sempre mostram o estado real do sistema (sem filtro de período)
        this.totalRequests = computed(() => this.requests().length);
        this.pendingApproval = computed(() => this.requests().filter(r => r.status === 'Pendente').length);
        this.inProgress = computed(() => this.requests().filter(r => ['Aprovado no Portal', 'Aprovado no MRP', 'SC Criada', 'Em Cotação', 'Aprovado em RD', 'Pedido Criado', 'Material Recebido'].includes(r.status)).length);
        this.totalSpentInPeriod = computed(() => {
            const spentStatuses: RequestStatus[] = ['Aprovado em RD', 'Pedido Criado', 'Material Recebido', 'Finalizado'];
            return this.filteredForPeriod()
                .filter(r => spentStatuses.includes(r.status) && (r.approvedValue || r.totalValue))
                .reduce((sum, r) => sum + (r.approvedValue || r.totalValue || 0), 0);
        });
        this.totalSpentValue = computed(() => {
            const spentStatuses: RequestStatus[] = ['Aprovado em RD', 'Pedido Criado', 'Material Recebido', 'Finalizado'];
            return this.requests()
                .filter(r => spentStatuses.includes(r.status) && (r.approvedValue || r.totalValue))
                .reduce((sum, r) => sum + (r.approvedValue || r.totalValue || 0), 0);
        });
        this.avgTimePerStatus = computed(() => this.buildAvgTimePerStatus(this.filteredForPeriod()));
        this.statusChartData = computed(() => this.buildStatusChartData(this.filteredForPeriod()));
        this.totalStatusRequests = computed(() => this.statusChartData().reduce((sum, item) => sum + item.value, 0));

        this.effectRef = effect(() => {
            const filtered = this.filteredForPeriod();
            const statusChartEl = this.statusChartContainer();
            const typeChartEl = this.typeChartContainer();
            const tempoChartEl = this.tempoChartContainer();
            if (!this.canViewDashboard()) return;

            if (statusChartEl) {
                drawBarrasHorizontais(statusChartEl, this.statusChartData(), {
                    ariaLabel: 'Solicitações por status',
                    max: 12,
                });
            }
            if (typeChartEl) {
                drawBarrasHorizontais(typeChartEl, this.aggregateBy(filtered, 'materialType'), {
                    ariaLabel: 'Solicitações por tipo de material',
                });
            }
            if (tempoChartEl) {
                // Tempo médio por etapa, em horas — o comprimento compara as etapas; o
                // rótulo mostra no formato legível (2d 4h), o tooltip traz qtd e máximo.
                const porStatus = new Map(this.avgTimePerStatus().map(t => [t.status, t]));
                drawBarrasHorizontais(tempoChartEl,
                    this.avgTimePerStatus().map(t => ({ name: t.status, value: t.avgMs / 3_600_000 })), {
                    ariaLabel: 'Tempo médio por etapa do fluxo',
                    formatValue: h => this.formatDuration(h * 3_600_000),
                    mostrarPercentual: false,
                    max: 12,
                    detalhe: d => {
                        const t = porStatus.get(d.name);
                        return t ? `${t.count} SC${t.count !== 1 ? 's' : ''} · máx ${this.formatDuration(t.maxMs)}` : null;
                    },
                });
            }
        });
    }

    setPeriod(period: DashboardPeriod): void {
        this.selectedPeriod.set(period);
    }

    readonly printDate = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(new Date());

    exportPDF(): void {
        window.print();
    }

    ngOnDestroy() {
        this.effectRef?.destroy();
        limparGrafico(this.statusChartContainer());
        limparGrafico(this.typeChartContainer());
        limparGrafico(this.tempoChartContainer());
    }

    private buildAvgTimePerStatus(requests: PurchaseRequest[]) {
        const statusDurations: Record<string, number[]> = {};

        for (const req of requests) {
            const timeline = this.buildStatusTimeline(req);

            for (let i = 0; i < timeline.length - 1; i++) {
                const status = timeline[i].status;
                const duration = timeline[i + 1].date.getTime() - timeline[i].date.getTime();
                if (duration > 0) {
                    if (!statusDurations[status]) statusDurations[status] = [];
                    statusDurations[status].push(duration);
                }
            }

            const terminalStatuses = ['Finalizado', 'Reprovado', 'Reprovado em RD'];
            if (!terminalStatuses.includes(req.status) && timeline.length > 0) {
                const lastEntry = timeline[timeline.length - 1];
                if (lastEntry.status === req.status) {
                    const duration = Date.now() - lastEntry.date.getTime();
                    if (duration > 0) {
                        if (!statusDurations[req.status]) statusDurations[req.status] = [];
                        statusDurations[req.status].push(duration);
                    }
                }
            }
        }

        return Object.entries(statusDurations)
            .filter(([status]) => status !== 'SC Criada')
            .map(([status, durations]) => ({
                status,
                avgMs: durations.reduce((a, b) => a + b, 0) / durations.length,
                maxMs: Math.max(...durations),
                count: durations.length,
            }))
            .sort((a, b) => b.avgMs - a.avgMs);
    }

    private buildStatusTimeline(req: PurchaseRequest): { status: string; date: Date }[] {
        const timeline: { status: string; date: Date }[] = [];
        timeline.push({ status: 'Pendente', date: req.requestDate });

        for (const event of (req.history || [])) {
            if (event.action === 'Status Atualizado' && event.details) {
                const match = event.details.match(/para "([^"]+)"/);
                if (match && event.date) {
                    const date = event.date instanceof Date ? event.date : new Date(event.date as any);
                    if (!isNaN(date.getTime())) {
                        timeline.push({ status: match[1], date });
                    }
                }
            }
        }

        if (req.portalApprovedAt && !timeline.some(t => t.status === 'Aprovado no Portal')) {
            timeline.push({ status: 'Aprovado no Portal', date: req.portalApprovedAt });
        }
        if (req.mrpApprovedAt && !timeline.some(t => t.status === 'Aprovado no MRP')) {
            timeline.push({ status: 'Aprovado no MRP', date: req.mrpApprovedAt });
        }
        if (req.rdApprovedAt && !timeline.some(t => t.status === 'Aprovado em RD')) {
            timeline.push({ status: 'Aprovado em RD', date: req.rdApprovedAt });
        }

        timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
        return timeline;
    }

    formatDuration(ms: number): string {
        const totalMinutes = Math.floor(ms / 60000);
        if (totalMinutes < 60) return `${Math.max(totalMinutes, 1)} min`;

        const totalHours = Math.floor(totalMinutes / 60);
        if (totalHours < 24) {
            const remainingMin = totalMinutes % 60;
            return remainingMin > 0 ? `${totalHours}h ${remainingMin}min` : `${totalHours}h`;
        }

        const days = Math.floor(totalHours / 24);
        const hours = totalHours % 24;
        if (days < 30) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;

        const months = Math.floor(days / 30);
        const remainingDays = days % 30;
        return remainingDays > 0 ? `${months}m ${remainingDays}d` : `${months}m`;
    }

    private aggregateBy(requests: PurchaseRequest[], key: keyof PurchaseRequest) {
        const aggregation = requests.reduce((acc, req) => {
            const group = req[key] as string;
            acc[group] = (acc[group] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(aggregation).map(([name, value]) => ({ name, value }));
    }

    private buildStatusChartData(requests: PurchaseRequest[]) {
        const aggregated = this.aggregateBy(requests, 'status').sort((a, b) => b.value - a.value);
        const total = aggregated.reduce((sum, item) => sum + item.value, 0);
        return aggregated.map(item => ({
            ...item,
            percent: total > 0 ? Math.round((item.value / total) * 100) : 0,
        }));
    }
}