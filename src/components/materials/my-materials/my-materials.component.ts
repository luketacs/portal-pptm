import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialService } from '../../../services/material.service';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { Material } from '../../../models/material.model';
import { PurchaseRequest, RequestStatus } from '../../../models/request.model';

interface MyMaterialRow {
  material: Material;
  requests: PurchaseRequest[];
  latestRequest: PurchaseRequest | null;
  hasOpenRequest: boolean;
  hasAnyRequest: boolean;
}

const OPEN_STATUSES: RequestStatus[] = [
  'Pendente', 'Aprovado no Portal', 'Aprovado no MRP',
  'SC Criada', 'Em Cotação', 'Aprovado em RD', 'Pedido Criado', 'Material Recebido',
];

const STATUS_CLASSES: Record<string, string> = {
  'Pendente':           'bg-yellow-100 text-yellow-800',
  'Aprovado no Portal': 'bg-cyan-100 text-cyan-800',
  'Reprovado':          'bg-red-100 text-red-800',
  'Aprovado no MRP':    'bg-blue-100 text-blue-800',
  'SC Criada':          'bg-sky-100 text-sky-800',
  'Em Cotação':         'bg-indigo-100 text-indigo-800',
  'Aprovado em RD':     'bg-teal-100 text-teal-800',
  'Reprovado em RD':    'bg-rose-100 text-rose-800',
  'Pedido Criado':      'bg-violet-100 text-violet-800',
  'Material Recebido':  'bg-lime-100 text-lime-800',
  'Finalizado':         'bg-green-100 text-green-800',
};

@Component({
  selector: 'app-my-materials',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, FormsModule],
  templateUrl: './my-materials.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyMaterialsComponent implements OnInit {
  rows = signal<MyMaterialRow[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  searchTerm = signal('');
  statusFilter = signal<'all' | 'pendente' | 'liberado'>('all');
  requestFilter = signal<'all' | 'com' | 'sem' | 'aberta'>('all');
  dateFrom = signal('');
  dateTo = signal('');

  currentPage = signal(1);
  readonly pageSize = 15;

  filteredRows = computed(() => {
    const term = this.normalizeText(this.searchTerm().trim());
    const status = this.statusFilter();
    const reqFilter = this.requestFilter();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.rows().filter(row => {
      const m = row.material;
      if (status !== 'all' && (m.status ?? 'pendente') !== status) return false;
      if (reqFilter === 'com' && !row.hasAnyRequest) return false;
      if (reqFilter === 'sem' && row.hasAnyRequest) return false;
      if (reqFilter === 'aberta' && !row.hasOpenRequest) return false;
      if (term) {
        const text = this.normalizeText([m.codigo ?? '', m.descricao_breve, m.ncm ?? ''].join(' '));
        if (!text.includes(term)) return false;
      }
      if (from) {
        const f = new Date(from); f.setHours(0, 0, 0, 0);
        if (new Date(m.created_at ?? '') < f) return false;
      }
      if (to) {
        const t = new Date(to); t.setHours(23, 59, 59, 999);
        if (new Date(m.created_at ?? '') > t) return false;
      }
      return true;
    });
  });

  totalPages = computed(() => Math.ceil(this.filteredRows().length / this.pageSize) || 1);
  paginatedRows = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize;
    return this.filteredRows().slice(start, start + this.pageSize);
  });
  startItem = computed(() => this.filteredRows().length === 0 ? 0 : (this.currentPage() - 1) * this.pageSize + 1);
  endItem = computed(() => Math.min(this.currentPage() * this.pageSize, this.filteredRows().length));
  visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.push(i);
    return pages;
  });

  constructor(
    private materialService: MaterialService,
    private requestService: RequestService,
    private authService: AuthService,
    private toast: NotificationService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const userId = this.authService.currentUser()?.id;
      if (!userId) return;

      const { data: materials, error } = await this.materialService.getAllMaterials();
      if (error || !materials) {
        this.errorMessage.set('Erro ao carregar materiais.');
        return;
      }

      // Filtra apenas materiais do usuário logado
      const myMaterials = materials.filter(m => m.created_by === userId);

      // Cruza com as solicitações já carregadas em memória
      const allRequests = this.requestService.requests();

      const rows: MyMaterialRow[] = myMaterials.map(material => {
        const code = (material.codigo ?? '').trim().toUpperCase();
        const relatedRequests = code
          ? allRequests.filter(r => r.materialCode.trim().toUpperCase() === code)
          : [];

        const sorted = [...relatedRequests].sort(
          (a, b) => b.requestDate.getTime() - a.requestDate.getTime()
        );

        const hasOpenRequest = sorted.some(r => OPEN_STATUSES.includes(r.status));

        return {
          material,
          requests: sorted,
          latestRequest: sorted[0] ?? null,
          hasOpenRequest,
          hasAnyRequest: sorted.length > 0,
        };
      });

      this.rows.set(rows);
    } catch {
      this.errorMessage.set('Erro inesperado ao carregar materiais.');
    } finally {
      this.isLoading.set(false);
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  onFilterChange(): void {
    this.currentPage.set(1);
  }

  getStatusClass(status: string): string {
    return STATUS_CLASSES[status] ?? 'bg-gray-100 text-gray-700';
  }

  getMaterialStatusClass(status: string | undefined): string {
    return status === 'liberado'
      ? 'bg-green-100 text-green-800'
      : 'bg-yellow-100 text-yellow-800';
  }

  private normalizeText(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  get summary() {
    const all = this.rows();
    return {
      total: all.length,
      liberados: all.filter(r => r.material.status === 'liberado').length,
      pendentes: all.filter(r => (r.material.status ?? 'pendente') === 'pendente').length,
      comSolicitacao: all.filter(r => r.hasAnyRequest).length,
      semSolicitacao: all.filter(r => !r.hasAnyRequest).length,
    };
  }
}
