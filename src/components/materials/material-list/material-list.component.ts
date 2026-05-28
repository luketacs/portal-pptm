import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialService } from '../../../services/material.service';
import { UserService } from '../../../services/user.service';
import { EmailService } from '../../../services/email.service';
import { Material } from '../../../models/material.model';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';

@Component({
  selector: 'app-material-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './material-list.component.html',
  styleUrls: ['./material-list.component.css']
})
export class MaterialListComponent implements OnInit {
  materials = signal<Material[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');
  currentUser = this.authService.currentUser;

  // Filtros
  searchTerm = signal('');
  statusFilter = signal<'all' | 'pendente' | 'liberado'>('all');

  // Paginação
  currentPage = signal(1);
  pageSize = signal(15);

  // Confirmação customizada
  showConfirmDialog = signal(false);
  confirmMessage = signal('');
  private confirmResolve: ((value: boolean) => void) | null = null;

  totalPages = computed(() => Math.ceil(this.filteredMaterials().length / this.pageSize()) || 1);
  paginatedMaterials = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.filteredMaterials().slice(start, start + this.pageSize());
  });
  serverTotal = computed(() => this.filteredMaterials().length);
  startItem = computed(() => this.filteredMaterials().length === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1);
  endItem = computed(() => Math.min(this.currentPage() * this.pageSize(), this.filteredMaterials().length));

  // Material liberado aguardando notificação por e-mail
  lastLiberated = signal<{ material: Material; adminName: string } | null>(null);

  constructor(
    private materialService: MaterialService,
    private userService: UserService,
    private emailService: EmailService,
    private authService: AuthService,
    private router: Router,
    private toast: NotificationService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadMaterials();
  }

  async loadMaterials(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    const { data, error } = await this.materialService.getAllMaterials();
    if (error) {
      this.errorMessage.set('Erro ao carregar materiais');
    } else {
      this.materials.set(data || []);
      this.currentPage.set(1);
    }
    this.isLoading.set(false);
  }

  /**
   * Filtra materiais baseado no termo de busca
   */
  filteredMaterials = computed(() => {
    const rawTerm = this.normalizeText(this.searchTerm().trim());
    const status = this.statusFilter();

    let result = this.materials();

    // Filtrar por status
    if (status !== 'all') {
      result = result.filter(m => (m.status || 'pendente') === status);
    }

    if (!rawTerm) {
      return result;
    }

    const terms = rawTerm
      .split('-')
      .map(part => part.trim())
      .filter(Boolean);

    return result.filter(material => {
      const searchableText = this.normalizeText([
        material.descricao_breve,
        material.codigo || '',
        material.ncm,
        material.created_by_name || ''
      ].join(' '));

      return terms.every(term => searchableText.includes(term));
    });
  });

  /**
   * Normaliza texto para busca (case-insensitive + sem acentos)
   */
  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  async notifyCreatorByEmail(): Promise<void> {
    const entry = this.lastLiberated();
    if (!entry) return;
    const { material, adminName } = entry;

    // Busca e-mail do criador na lista de usuários (já carregada)
    await this.userService.loadUsers();
    const creator = this.userService.users().find(u => u.id === material.created_by);

    if (!creator?.email) {
      this.toast.showError('E-mail do criador não encontrado.');
      return;
    }

    this.emailService.openMaterialReleasedEmail({
      to: creator.email,
      creatorName: creator.name,
      materialDescription: material.descricao_breve,
      materialCode: material.codigo,
      releasedByName: adminName,
    });
  }

  /**
   * Atualiza termo de busca
   */
  onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchTerm.set(input.value);
    this.currentPage.set(1);
  }

  onStatusFilterChange(value: string): void {
    this.statusFilter.set(value as 'all' | 'pendente' | 'liberado');
    this.currentPage.set(1);
  }

  /**
   * Verifica se usuário é admin
   */
  isAdmin = computed(() => {
    return this.currentUser()?.role === 'Admin';
  });

  /**
   * Verifica se usuário pode criar materiais (Admin, Solicitante ou Visualizador)
   */
  canCreateMaterial = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'Admin' || role === 'Solicitante' || role === 'Visualizador';
  });

  /**
   * Abre diálogo de confirmação customizado
   */
  private confirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmMessage.set(message);
      this.showConfirmDialog.set(true);
      this.confirmResolve = resolve;
    });
  }

  onConfirmDialogResult(result: boolean): void {
    this.showConfirmDialog.set(false);
    if (this.confirmResolve) {
      this.confirmResolve(result);
      this.confirmResolve = null;
    }
  }

  /**
   * Visualiza/Edita material (navega para tela de detalhes)
   */
  viewMaterial(id: string): void {
    this.router.navigate(['/materials', id]);
  }

  /**
   * Edita material (navega para tela de edição) - apenas admin
   */
  editMaterial(id: string): void {
    this.router.navigate(['/materials', id]);
  }

  /**
   * Alterna status do material (apenas admin)
   */
  async toggleMaterialStatus(material: Material): Promise<void> {
    if (!this.isAdmin()) {
      this.toast.showWarning('Apenas administradores podem alterar o status dos materiais');
      return;
    }

    const novoStatus: 'liberado' = 'liberado';
    const confirmChange = await this.confirm(
      `Liberar o material "${material.descricao_breve}"?\nApós liberado, ele ficará disponível para uso em solicitações de compra.`
    );

    if (!confirmChange) {
      return;
    }

    const user = this.currentUser();
    const adminInfo = user ? { id: user.id, name: user.name } : undefined;
    const { error } = await this.materialService.updateMaterialStatus(material.id!, novoStatus, adminInfo);

    if (error) {
      console.error('[MaterialList] Error updating material status:', error);
      this.toast.showError('Erro ao atualizar status do material');
      return;
    }

    this.toast.showSuccess(`Material "${material.descricao_breve}" LIBERADO com sucesso!`);

    // Guarda referência para o banner de notificação por e-mail
    if (user) {
      this.lastLiberated.set({ material, adminName: user.name });
    }

    // Recarrega do servidor para garantir dados atualizados
    await this.loadMaterials();

  }

  /**
   * Deleta material (apenas admin)
   */
  async deleteMaterial(id: string, descricao: string): Promise<void> {
    if (!this.isAdmin()) {
      this.toast.showWarning('Apenas administradores podem deletar materiais');
      return;
    }

    const confirmDelete = await this.confirm(`Tem certeza que deseja deletar "${descricao}"?`);
    
    if (!confirmDelete) {
      return;
    }

    const user = this.currentUser();
    const adminInfo = user ? { id: user.id, name: user.name } : undefined;
    const { success, error } = await this.materialService.deleteMaterial(id, adminInfo);

    if (error) {
      console.error('[MaterialList] Error deleting material:', error);
      this.toast.showError('Erro ao deletar material');
      return;
    }

    if (success) {
      // Remover da lista
      this.materials.set(
        this.materials().filter(m => m.id !== id)
      );
      this.toast.showSuccess('Material deletado com sucesso!');
    }
  }

  /**
   * Formata data para exibição
   */
  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  /**
   * Exporta materiais para Excel via endpoint serverless
   */
  async exportToExcel(): Promise<void> {
    const user = this.currentUser();
    if (!user) return;

    this.isLoading.set(true);
    try {
      const token = await this.authService.getValidAccessToken();
      if (!token) { this.toast.showError('Sessão expirada.'); return; }

      const response = await fetch('/api/export-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          search: this.searchTerm() || undefined,
          status: this.statusFilter() !== 'all' ? this.statusFilter() : undefined,
        }),
      });

      if (!response.ok) { this.toast.showError('Erro ao exportar. Tente novamente.'); return; }

      const blob = await response.blob();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Relatorio_Materiais_${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      this.toast.showError('Erro ao exportar materiais para Excel.');
    } finally {
      this.isLoading.set(false);
    }
  }
}

