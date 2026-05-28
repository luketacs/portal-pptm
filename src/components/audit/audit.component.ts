import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { UserService } from '../../services/user.service';
import { AUDIT_EVENT_LABELS, AUDIT_EVENT_CATEGORIES } from '../../services/audit-log.service';

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const EVENT_COLOR_MAP: Record<string, string> = {
  login:                   'bg-green-100 text-green-800',
  logout:                  'bg-gray-100 text-gray-700',
  password_change:         'bg-purple-100 text-purple-800',
  password_reset:          'bg-orange-100 text-orange-800',
  user_created:            'bg-blue-100 text-blue-800',
  user_updated:            'bg-sky-100 text-sky-800',
  user_deleted:            'bg-red-100 text-red-800',
  request_created:         'bg-teal-100 text-teal-800',
  request_status_changed:  'bg-indigo-100 text-indigo-800',
  request_updated:         'bg-yellow-100 text-yellow-800',
  request_deleted:         'bg-rose-100 text-rose-800',
  material_created:        'bg-cyan-100 text-cyan-800',
  material_updated:        'bg-amber-100 text-amber-800',
  material_status_changed: 'bg-lime-100 text-lime-800',
  material_deleted:        'bg-red-100 text-red-800',
};

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './audit.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditComponent implements OnInit {
  entries = signal<AuditLogEntry[]>([]);
  total = signal(0);
  isLoading = signal(false);
  errorMessage = signal('');

  // Filtros
  selectedUserId = signal('');
  selectedEventType = signal('');
  selectedCategory = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  // Paginação
  currentPage = signal(1);
  readonly pageSize = 25;

  totalPages = computed(() => Math.ceil(this.total() / this.pageSize) || 1);
  startItem = computed(() => this.total() === 0 ? 0 : (this.currentPage() - 1) * this.pageSize + 1);
  endItem = computed(() => Math.min(this.currentPage() * this.pageSize, this.total()));
  visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.push(i);
    return pages;
  });

  readonly eventLabels = AUDIT_EVENT_LABELS;
  readonly eventCategories = AUDIT_EVENT_CATEGORIES;
  readonly categoryNames = Object.keys(AUDIT_EVENT_CATEGORIES);

  readonly allEventOptions = Object.entries(AUDIT_EVENT_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  filteredEventOptions = computed(() => {
    const cat = this.selectedCategory();
    if (!cat) return this.allEventOptions;
    const allowed = AUDIT_EVENT_CATEGORIES[cat] ?? [];
    return this.allEventOptions.filter(o => allowed.includes(o.value));
  });

  constructor(
    public userService: UserService,
    private supabaseService: SupabaseService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.userService.loadUsers();
    await this.loadPage();
  }

  async loadPage(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const offset = (this.currentPage() - 1) * this.pageSize;

      let query = this.supabaseService.client
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + this.pageSize - 1);

      if (this.selectedUserId()) query = query.eq('user_id', this.selectedUserId());
      if (this.selectedEventType()) {
        query = query.eq('event_type', this.selectedEventType());
      } else if (this.selectedCategory()) {
        const types = AUDIT_EVENT_CATEGORIES[this.selectedCategory()] ?? [];
        if (types.length > 0) query = query.in('event_type', types);
      }
      if (this.dateFrom()) query = query.gte('created_at', this.dateFrom());
      if (this.dateTo()) {
        const to = new Date(this.dateTo());
        to.setHours(23, 59, 59, 999);
        query = query.lte('created_at', to.toISOString());
      }

      const { data, count, error } = await query;
      if (error) throw error;

      this.entries.set((data ?? []) as AuditLogEntry[]);
      this.total.set(count ?? 0);
    } catch {
      this.errorMessage.set('Erro ao carregar logs de auditoria. Verifique se a tabela audit_logs foi criada no Supabase.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async applyFilters(): Promise<void> {
    this.currentPage.set(1);
    await this.loadPage();
  }

  async clearFilters(): Promise<void> {
    this.selectedUserId.set('');
    this.selectedEventType.set('');
    this.selectedCategory.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.currentPage.set(1);
    await this.loadPage();
  }

  onCategoryChange(): void {
    this.selectedEventType.set('');
  }

  async goToPage(page: number): Promise<void> {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      await this.loadPage();
    }
  }

  formatDate(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  }

  getEventLabel(eventType: string): string {
    return AUDIT_EVENT_LABELS[eventType] ?? eventType;
  }

  getEventClass(eventType: string): string {
    return EVENT_COLOR_MAP[eventType] ?? 'bg-gray-100 text-gray-700';
  }

  getResourceLink(entry: AuditLogEntry): string | null {
    if (entry.resource_type === 'request' && entry.resource_id) return `/requests/${entry.resource_id}`;
    if (entry.resource_type === 'material' && entry.resource_id) return `/materials/${entry.resource_id}`;
    return null;
  }

  getResourceLabel(entry: AuditLogEntry): string | null {
    const meta = entry.metadata;
    if (entry.resource_type === 'request') return (meta?.['material_code'] as string) ?? entry.resource_id;
    if (entry.resource_type === 'material') return (meta?.['code'] as string) ?? entry.resource_id;
    if (entry.resource_type === 'user') return (meta?.['email'] as string) ?? entry.resource_id;
    return null;
  }

  formatMetadata(entry: AuditLogEntry): string {
    if (!entry.metadata) return '';
    const exclude = ['material_code', 'code', 'email', 'target_user_id', 'target_user_name'];
    const filtered = Object.entries(entry.metadata)
      .filter(([k]) => !exclude.includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
    return filtered;
  }
}
