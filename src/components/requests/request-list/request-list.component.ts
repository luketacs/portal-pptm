import { ChangeDetectionStrategy, Component, computed, effect, signal, OnInit, OnDestroy, untracked } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { RequestFilterStateService } from '../../../services/request-filter-state.service';
import { MaterialService } from '../../../services/material.service';
import { StockInfo } from '../../../models/material.model';
import { PurchaseRequest, RequestStatus, MaterialType } from '../../../models/request.model';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-request-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './request-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestListComponent implements OnInit, OnDestroy {
  private routeSubscription?: Subscription;
  isLoading = signal(false);
  currentUser;
  
  mode: 'my' | 'admin' | 'in-progress' = 'my';
  pageTitle = 'Minhas Solicitações';

  // Filter states
  materialCodeFilter = signal('');
  materialTypeFilter = signal<MaterialType | 'all'>('all');
  statusFilter = signal<RequestStatus | 'all'>('all');
  searchQuery = signal(''); // Busca global
  dateFrom = signal(''); // Filtro de data inicial
  dateTo = signal(''); // Filtro de data final
  minValue = signal<number | null>(null); // Filtro de valor mínimo
  maxValue = signal<number | null>(null); // Filtro de valor máximo

  // Filter options
  materialTypes: (MaterialType | 'all')[] = ['all', 'Mecânica', 'Elétrica', 'SPCI', 'Refrigeração', 'Outros'];
  requestStatuses: (RequestStatus | 'all')[] = [
    'all', 
    'Pendente', 
    'Aprovado no Portal', 
    'Reprovado', 
    'Aprovado no MRP', 
    'SC Criada', 
    'Em Cotação', 
    'Aprovado em RD', 
    'Reprovado em RD', 
    'Pedido Criado', 
    'Material Recebido', 
    'Finalizado'
  ];

  // Paginação
  currentPage = signal(1);
  pageSize = signal(15);

  paginatedRequests = computed(() => {
    const all = this.filteredRequests();
    const size = this.pageSize();
    const total = Math.ceil(all.length / size) || 1;
    const page = Math.min(this.currentPage(), total);
    const start = (page - 1) * size;
    return all.slice(start, start + size);
  });

  totalPages = computed(() => Math.ceil(this.filteredRequests().length / this.pageSize()) || 1);
  startItem = computed(() => this.filteredRequests().length === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1);
  endItem = computed(() => Math.min(this.currentPage() * this.pageSize(), this.filteredRequests().length));

  visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  constructor(
    public route: ActivatedRoute,
    public router: Router,
    public requestService: RequestService,
    public authService: AuthService,
    private notificationService: NotificationService,
    private filterStateService: RequestFilterStateService,
    private materialService: MaterialService
  ) {
    this.currentUser = this.authService.currentUser;
    this.updateModeFromRoute();

    // Reseta para página 1 quando filtros mudam
    let isFirstRun = true;
    effect(() => {
      this.filteredRequests();
      untracked(() => {
        if (isFirstRun) { isFirstRun = false; return; }
        this.currentPage.set(1);
      });
    });
  }

  ngOnInit() {
    // Restaura filtros salvos ao voltar de uma tela de detalhe
    const saved = this.filterStateService.restore(this.mode);
    if (saved) {
      this.searchQuery.set(saved.searchQuery);
      this.statusFilter.set(saved.statusFilter);
      this.materialTypeFilter.set(saved.materialTypeFilter);
      this.materialCodeFilter.set(saved.materialCodeFilter);
      this.dateFrom.set(saved.dateFrom);
      this.dateTo.set(saved.dateTo);
      this.currentPage.set(saved.currentPage);
    }

    // Reage a mudanças de rota para atualizar o modo
    this.routeSubscription = this.route.data.subscribe(data => {
      const newMode = data['mode'] || 'my';
      if (newMode !== this.mode) {
        this.mode = newMode;
        this.updateModeFromRoute();
        this.clearFilters();
        this.currentPage.set(1);
      }
    });
  }

  ngOnDestroy() {
    // Salva estado dos filtros para restaurar ao voltar
    this.filterStateService.save({
      mode: this.mode,
      searchQuery: this.searchQuery(),
      statusFilter: this.statusFilter(),
      materialTypeFilter: this.materialTypeFilter(),
      materialCodeFilter: this.materialCodeFilter(),
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      currentPage: this.currentPage(),
    });
    this.routeSubscription?.unsubscribe();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.requestService.loadRequests(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  private updateModeFromRoute() {
    this.mode = this.route.snapshot.data['mode'] || 'my';
    if(this.mode === 'admin') this.pageTitle = 'Todas as Solicitações';
    else if(this.mode === 'in-progress') this.pageTitle = 'Solicitações em Andamento';
    else this.pageTitle = 'Minhas Solicitações';
  }

  // Determine if the current user can edit a specific request (used to show/hide actions in the list)
  canEditRequestInList(request: PurchaseRequest): boolean {
    const user = this.currentUser?.();
    if (!user) return false;

    // Visualizador nunca pode editar
    if (user.role === 'Visualizador') return false;
    // Admins can edit unless final or rejected
    if (user.role === 'Admin') {
      return !['Finalizado', 'Reprovado', 'Reprovado em RD'].includes(request.status);
    }
    // Requester can edit only their own pending requests
    if (user.role === 'Solicitante') {
      return request.requester?.id === user.id && request.status === 'Pendente';
    }
    return false;
  }

  filteredRequests = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    
    const allRequests = this.requestService.requests();
    let requestsToShow: PurchaseRequest[] = [];
    const excludedStatuses: RequestStatus[] = ['Finalizado', 'Reprovado', 'Reprovado em RD'];

    // Step 1: Base filtering by mode (who can see what)
    if (this.mode === 'admin') {
      requestsToShow = allRequests;
    } else if (this.mode === 'my') {
      requestsToShow = allRequests.filter(r => r.requester?.id === user.id);
    } else if (this.mode === 'in-progress') {
      requestsToShow = allRequests.filter(r => !excludedStatuses.includes(r.status));
    }
    
    // Step 2: Apply search query (busca global)
    const query = this.searchQuery().trim().toLowerCase();
    if (query) {
      requestsToShow = requestsToShow.filter(r =>
        r.materialCode.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query) ||
        (r.requester?.name || '').toLowerCase().includes(query) ||
        r.workOrder?.toLowerCase().includes(query)
      );
    }

    // Step 3: Apply status filter
    const currentStatusFilter = this.statusFilter();
    if (currentStatusFilter !== 'all') {
      requestsToShow = requestsToShow.filter(r => r.status === currentStatusFilter);
    }
    
    // Step 4: Apply material type filter
    const typeFilter = this.materialTypeFilter();
    if (typeFilter !== 'all') {
      requestsToShow = requestsToShow.filter(r => r.materialType === typeFilter);
    }

    // Step 5: Apply material code filter (campo específico)
    const codeFilter = this.materialCodeFilter().trim().toLowerCase();
    if (codeFilter) {
      requestsToShow = requestsToShow.filter(r => r.materialCode.toLowerCase().includes(codeFilter));
    }

    // Step 6: Apply date range filter
    const fromDate = this.dateFrom();
    const toDate = this.dateTo();
    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      requestsToShow = requestsToShow.filter(r => r.requestDate >= from);
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      requestsToShow = requestsToShow.filter(r => r.requestDate <= to);
    }

    // Step 7: Apply value range filter (se campo de valor existir)
    // Nota: PurchaseRequest não tem campo de valor total. 
    // Se adicionar no futuro, descomentar:
    // const minVal = this.minValue();
    // const maxVal = this.maxValue();
    // if (minVal !== null) {
    //   requestsToShow = requestsToShow.filter(r => (r.totalValue || 0) >= minVal);
    // }
    // if (maxVal !== null) {
    //   requestsToShow = requestsToShow.filter(r => (r.totalValue || 0) <= maxVal);
    // }

    return requestsToShow.sort((a, b) => b.requestDate.getTime() - a.requestDate.getTime());
  });

  getStatusClass(status: RequestStatus): string {
    switch (status) {
      case 'Pendente': return 'bg-yellow-100 text-yellow-800';
      case 'Aprovado no Portal': return 'bg-cyan-100 text-cyan-800';
      case 'Reprovado': return 'bg-red-100 text-red-800';
      case 'Aprovado no MRP': return 'bg-blue-100 text-blue-800';
      case 'SC Criada': return 'bg-sky-100 text-sky-800';
      case 'Em Cotação': return 'bg-blue-100 text-blue-800';
      case 'Aprovado em RD': return 'bg-teal-100 text-teal-800';
      case 'Reprovado em RD': return 'bg-rose-100 text-rose-800';
      case 'Pedido Criado': return 'bg-violet-100 text-violet-800';
      case 'Material Recebido': return 'bg-lime-100 text-lime-800';
      case 'Finalizado': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  getStatusEnteredAt(request: PurchaseRequest): Date {
    const historyDate = this.getStatusDateFromHistory(request);
    if (historyDate) return historyDate;

    const trackedDate = this.getTrackedStatusDate(request);
    if (trackedDate) return trackedDate;

    return request.requestDate;
  }

  getTimeInCurrentStatus(request: PurchaseRequest): string {
    const enteredAt = this.getStatusEnteredAt(request);
    const diffMs = Math.max(0, Date.now() - enteredAt.getTime());
    const totalMinutes = Math.floor(diffMs / 60000);

    if (totalMinutes < 60) {
      const minutes = Math.max(totalMinutes, 1);
      return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    }

    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    if (totalHours < 24) {
      if (totalHours < 6 && remainingMinutes > 0) {
        const hoursLabel = totalHours === 1 ? 'hora' : 'horas';
        const minutesLabel = remainingMinutes === 1 ? 'minuto' : 'minutos';
        return `${totalHours} ${hoursLabel} e ${remainingMinutes} ${minutesLabel}`;
      }
      return `${totalHours} ${totalHours === 1 ? 'hora' : 'horas'}`;
    }

    const totalDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    if (totalDays < 7 && remainingHours > 0) {
      const daysLabel = totalDays === 1 ? 'dia' : 'dias';
      const hoursLabel = remainingHours === 1 ? 'hora' : 'horas';
      return `${totalDays} ${daysLabel} e ${remainingHours} ${hoursLabel}`;
    }
    return `${totalDays} ${totalDays === 1 ? 'dia' : 'dias'}`;
  }

  getStatusEnteredAtLabel(request: PurchaseRequest): string {
    return `Desde ${this.getStatusEnteredAt(request).toLocaleString('pt-BR')}`;
  }

  private getTrackedStatusDate(request: PurchaseRequest): Date | undefined {
    const statusDateByState: Partial<Record<RequestStatus, Date | undefined>> = {
      'Aprovado no Portal': request.portalApprovedAt,
      'Aprovado no MRP': request.mrpApprovedAt,
      'Aprovado em RD': request.rdApprovedAt,
      Finalizado: request.finishedAt,
    };

    const trackedDate = statusDateByState[request.status];
    if (!trackedDate) return undefined;
    return Number.isNaN(trackedDate.getTime()) ? undefined : trackedDate;
  }

  private getStatusDateFromHistory(request: PurchaseRequest): Date | undefined {
    const history = request.history || [];
    if (history.length === 0) return undefined;
    const normalizedCurrentStatus = this.normalizeForSearch(request.status);
    let latestStatusChangeDate: Date | undefined;

    // Varrer de trás para frente garante usar a última alteração registrada no histórico.
    for (let index = history.length - 1; index >= 0; index--) {
      const event = history[index] as unknown as Record<string, unknown>;
      const eventDate = this.coerceHistoryDate(event?.['date']);
      if (!eventDate) continue;
      if (!this.isStatusHistoryEvent(event)) continue;

      if (!latestStatusChangeDate) {
        latestStatusChangeDate = eventDate;
      }

      const targetStatus = this.extractTargetStatusFromEvent(event);
      if (targetStatus && targetStatus === normalizedCurrentStatus) {
        return eventDate;
      }
    }

    // Fallback: última alteração de status encontrada (mesmo sem "para <status>").
    return latestStatusChangeDate;
  }

  private extractTargetStatusFromEvent(event: Record<string, unknown>): string | null {
    const explicitTargetKeys = ['newStatus', 'new_status', 'toStatus', 'to_status', 'status', 'new_value'];
    for (const key of explicitTargetKeys) {
      const rawValue = event[key];
      if (typeof rawValue === 'string' && rawValue.trim()) {
        return this.cleanStatusToken(rawValue);
      }
    }

    return this.extractTargetStatusFromDetails(String(event['details'] || ''));
  }

  private isStatusHistoryEvent(event: Partial<Record<string, unknown>>): boolean {
    const action = this.normalizeForSearch(String(event['action'] || ''));
    const details = this.normalizeForSearch(String(event['details'] || ''));
    const fieldChanged = this.normalizeForSearch(
      String(event['field_changed'] || event['fieldChanged'] || '')
    );

    if (action.includes('status')) return true;
    if (fieldChanged === 'status') return true;
    if (details.includes('status alterado')) return true;
    if (details.includes('status atualizado')) return true;
    if (details.includes("campo 'status' alterado")) return true;
    if (details.includes('campo "status" alterado')) return true;
    if (details.includes(' para ')) return true;
    if (details.includes('status') && (details.includes('alter') || details.includes('atualiz'))) return true;

    return false;
  }

  private extractTargetStatusFromDetails(details: string): string | null {
    const normalizedDetails = this.normalizeForSearch(details || '');
    if (!normalizedDetails) return null;

    const withQuotes = normalizedDetails.match(/para\s+"([^"]+)"/i);
    if (withQuotes?.[1]) {
      return this.cleanStatusToken(withQuotes[1]);
    }

    const withSingleQuotes = normalizedDetails.match(/para\s+'([^']+)'/i);
    if (withSingleQuotes?.[1]) {
      return this.cleanStatusToken(withSingleQuotes[1]);
    }

    const withoutQuotes = normalizedDetails.match(/para\s+([a-z0-9\s]+?)(?:\.|,|;|\s+motivo:|$)/i);
    if (withoutQuotes?.[1]) {
      return this.cleanStatusToken(withoutQuotes[1]);
    }

    return null;
  }

  private cleanStatusToken(token: string): string {
    return this.normalizeForSearch(token)
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
  }

  private coerceHistoryDate(value: unknown): Date | null {
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === 'number') {
      const fromTimestamp = new Date(value);
      if (!Number.isNaN(fromTimestamp.getTime())) return fromTimestamp;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    // dd/MM/yyyy[ HH:mm[:ss]] com 1 ou 2 dígitos para dia/hora.
    const brMatch = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (brMatch) {
      const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = brMatch;
      const parsed = new Date(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(min),
        Number(ss)
      );
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const nativeParsed = new Date(raw);
    if (!Number.isNaN(nativeParsed.getTime())) {
      return nativeParsed;
    }

    return null;
  }

  private normalizeForSearch(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  viewDetails(request: PurchaseRequest) {
    if (this.isLoading()) return;
    this.router.navigate(['/requests', request.id]);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set('all');
    this.materialTypeFilter.set('all');
    this.materialCodeFilter.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.minValue.set(null);
    this.maxValue.set(null);
  }

  goToPage(page: number): void {
    const total = this.totalPages();
    if (page >= 1 && page <= total) {
      this.currentPage.set(page);
    }
  }

  async exportToExcel(): Promise<void> {
    if (this.isLoading()) return;
    const user = this.currentUser();
    if (!user) return;

    const token = await this.authService.getValidAccessToken();
    if (!token) {
      this.notificationService.showError('Sessão expirada. Faça login novamente.');
      return;
    }

    this.isLoading.set(true);
    try {
      const response = await fetch('/api/export-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: this.mode,
          userId: user.id,
          search: this.searchQuery() || undefined,
          status: this.statusFilter() !== 'all' ? this.statusFilter() : undefined,
          materialType: this.materialTypeFilter() !== 'all' ? this.materialTypeFilter() : undefined,
          materialCode: this.materialCodeFilter() || undefined,
          dateFrom: this.dateFrom() || undefined,
          dateTo: this.dateTo() || undefined,
        }),
      });

      if (!response.ok) {
        this.notificationService.showError('Erro ao exportar. Tente novamente.');
        return;
      }

      const blob = await response.blob();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Solicitacoes_de_Compra_${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      this.notificationService.showError('Erro ao exportar para Excel.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Exclui uma solicitação (apenas Admin)
   */
  async deleteRequest(request: PurchaseRequest, event: Event): Promise<void> {
    event.stopPropagation(); // Previne navegação para detalhes
    
    const user = this.currentUser();
    if (!user || user.role !== 'Admin') {
      this.notificationService.showError('Apenas administradores podem excluir solicitações');
      return;
    }
    
    // Confirmação
    const confirmMessage = `Tem certeza que deseja EXCLUIR permanentemente a solicitação?\n\n` +
      `Código: ${request.materialCode}\n` +
      `Descrição: ${request.description}\n` +
      `Solicitante: ${request.requester?.name || 'Solicitante não identificado'}\n` +
      `Status: ${request.status}\n\n` +
      `ESTA AÇÃO NÃO PODE SER DESFEITA!`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    this.isLoading.set(true);
    try {
      await this.requestService.deleteRequest(request.id, user);
      this.notificationService.showSuccess(`Solicitação ${request.materialCode} excluída com sucesso`);
    } catch (error: any) {
      console.error('[RequestList] Error deleting request:', error);
      this.notificationService.showError(
        error.message || 'Erro ao excluir solicitação. Tente novamente.'
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Verifica se botão de excluir deve aparecer
   */
  canDeleteRequest(): boolean {
    const user = this.currentUser();
    return user?.role === 'Admin' && this.mode === 'admin';
  }

  // --- Consulta de saldo ---
  stockBalanceMap = signal<Record<string, { loading: boolean; estoques: StockInfo[] | null; error: string | null }>>({});

  async checkStockBalance(request: PurchaseRequest, event: Event): Promise<void> {
    event.stopPropagation();
    const code = request.materialCode;
    if (!code) return;

    // Atualizar estado para loading
    this.stockBalanceMap.update(map => ({
      ...map,
      [request.id]: { loading: true, estoques: null, error: null }
    }));

    try {
      const result = await firstValueFrom(this.materialService.getMaterialByCode(code));
      const estoques4922 = result.data?.estoques?.filter(
        (e: StockInfo) => e.localizacao === '4922'
      ) ?? [];
      if (result.success && estoques4922.length) {
        this.stockBalanceMap.update(map => ({
          ...map,
          [request.id]: { loading: false, estoques: estoques4922, error: null }
        }));
      } else {
        this.stockBalanceMap.update(map => ({
          ...map,
          [request.id]: { loading: false, estoques: null, error: result.error || 'Sem dados de estoque' }
        }));
      }
    } catch (err: any) {
      this.stockBalanceMap.update(map => ({
        ...map,
        [request.id]: { loading: false, estoques: null, error: 'Erro ao consultar saldo' }
      }));
    }
  }

  getStockBalance(requestId: string) {
    return this.stockBalanceMap()[requestId] || null;
  }

  dismissStockBalance(requestId: string, event: Event): void {
    event.stopPropagation();
    this.stockBalanceMap.update(map => {
      const newMap = { ...map };
      delete newMap[requestId];
      return newMap;
    });
  }
}



