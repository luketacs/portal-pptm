import { ChangeDetectionStrategy, Component, computed, signal, ElementRef, effect, viewChild, OnDestroy, EffectRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RequestService } from '../../services/request.service';
import { PurchaseRequest, RequestStatus } from '../../models/request.model';
import { AuthService } from '../../services/auth.service';
import * as d3 from 'd3';

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
    private readonly statusColorScheme = ['#fbbf24', '#38bdf8', '#ef4444', '#60a5fa', '#0ea5e9', '#3b82f6', '#2dd4bf', '#f43f5e', '#8b5cf6', '#14b8a6', '#22c55e'];

    readonly periods: DashboardPeriod[] = ['week', 'month', '3months', 'year', 'all'];
    readonly periodLabels = PERIOD_LABELS;
    selectedPeriod = signal<DashboardPeriod>('all');

    requests;
    canViewDashboard;

    private statusChartContainer = viewChild<ElementRef>('statusChart');
    private typeChartContainer = viewChild<ElementRef>('typeChart');

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

            if (this.canViewDashboard() && filtered.length > 0) {
                if (statusChartEl) {
                    const data = this.statusChartData();
                    this.drawPieChart(statusChartEl, data, this.statusColorScheme);
                }
                if (typeChartEl) {
                    const data = this.aggregateBy(filtered, 'materialType');
                    this.drawBarChart(typeChartEl, data, ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa']);
                }
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
        // Clean up D3 chart elements from DOM
        const statusEl = this.statusChartContainer();
        const typeEl = this.typeChartContainer();
        if (statusEl) d3.select(statusEl.nativeElement).select('svg').remove();
        if (typeEl) d3.select(typeEl.nativeElement).select('svg').remove();
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

    private readonly STATUS_COLOR_MAP: Record<string, string> = {
        'Pendente': '#f59e0b',
        'Aprovado no Portal': '#06b6d4',
        'Reprovado': '#ef4444',
        'Aprovado no MRP': '#3b82f6',
        'SC Criada': '#0ea5e9',
        'Em Cotação': '#6366f1',
        'Aprovado em RD': '#14b8a6',
        'Reprovado em RD': '#f43f5e',
        'Pedido Criado': '#8b5cf6',
        'Material Recebido': '#84cc16',
        'Finalizado': '#22c55e',
    };

    getStatusColor(status: string): string {
        return this.STATUS_COLOR_MAP[status] || '#64748b';
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
        return aggregated.map((item, index) => ({
            ...item,
            percent: total > 0 ? Math.round((item.value / total) * 100) : 0,
            color: this.statusColorScheme[index % this.statusColorScheme.length],
        }));
    }

    private drawPieChart(elementRef: ElementRef, data: any[], colorScheme: string[]) {
        const element = elementRef.nativeElement;
        const width = element.offsetWidth;
        const height = 300;
        const radius = Math.min(width, height) / 2 - 18;
        const innerRadius = radius * 0.55;
        
        d3.select(element).select("svg").remove();

        const svg = d3.select(element).append("svg")
            .attr("width", width)
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${width / 2}, ${height / 2})`);

        const color = d3.scaleOrdinal<string>().range(colorScheme);
        const pie = d3.pie().value((d: any) => d.value).sort(null);
        const arc = d3.arc<any, any>().innerRadius(innerRadius).outerRadius(radius);
        const labelArc = d3.arc<any, any>().innerRadius(radius + 16).outerRadius(radius + 16);

        const g = svg.selectAll(".arc")
            .data(pie(data))
            .enter().append("g")
            .attr("class", "arc");

        g.append("path")
            .attr("d", arc as any)
            .style("fill", (d: any) => color(d.data.name) as string)
            .attr("stroke", "white")
            .style("stroke-width", "1.5px");

        g.append("title")
            .text((d: any) => `${d.data.name}: ${d.data.value} (${d.data.percent}%)`);

        g.filter((d: any) => d.data.percent >= 8)
            .append("text")
            .attr("transform", (d: any) => `translate(${labelArc.centroid(d)})`)
            .attr("dy", "0.35em")
            .style("font-size", "12px")
            .style("font-weight", "600")
            .style("fill", "#334155")
            .style("text-anchor", (d: any) => labelArc.centroid(d)[0] >= 0 ? "start" : "end")
            .text((d: any) => `${d.data.percent}%`);

        svg.append("text")
            .attr("dy", "-0.2em")
            .style("text-anchor", "middle")
            .style("font-size", "22px")
            .style("font-weight", "700")
            .style("fill", "#0f172a")
            .text(`${data.reduce((sum, item) => sum + item.value, 0)}`);

        svg.append("text")
            .attr("dy", "1.1em")
            .style("text-anchor", "middle")
            .style("font-size", "12px")
            .style("fill", "#64748b")
            .text("Solicitações");
    }
    
    private drawBarChart(elementRef: ElementRef, data: any[], colorScheme: string[]) {
        const element = elementRef.nativeElement;
        const margin = { top: 20, right: 20, bottom: 30, left: 40 };
        const width = element.offsetWidth - margin.left - margin.right;
        const height = 250 - margin.top - margin.bottom;

        d3.select(element).select("svg").remove();
        
        const svg = d3.select(element).append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        const x = d3.scaleBand().range([0, width]).padding(0.1);
        const y = d3.scaleLinear().range([height, 0]);
        const color = d3.scaleOrdinal<string>().range(colorScheme);
        
        x.domain(data.map(d => d.name));
        y.domain([0, d3.max(data, (d: any) => d.value)]);

        svg.selectAll(".bar")
            .data(data)
            .enter().append("rect")
            .attr("class", "bar")
            .attr("x", (d: any) => x(d.name) ?? 0)
            .attr("width", x.bandwidth())
            .attr("y", (d: any) => y(d.value))
            .attr("height", (d: any) => height - y(d.value))
            .attr("fill", (d: any) => color(d.name) as string);
            
        svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
        svg.append("g").call(d3.axisLeft(y));
    }
}