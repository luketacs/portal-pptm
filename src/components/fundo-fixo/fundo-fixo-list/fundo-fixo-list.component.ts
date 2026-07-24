import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FundoFixoService, FUNDO_FIXO_LIMITE_MENSAL, FUNDO_FIXO_SETORES } from '../../../services/fundo-fixo.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { FundoFixoSolicitacao, FundoFixoStatus } from '../../../models/fundo-fixo.model';

type StatusFiltro = 'todos' | FundoFixoStatus;

const STATUS_LABEL: Record<FundoFixoStatus, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  comprado: 'Comprado',
};

const STATUS_BADGE: Record<FundoFixoStatus, string> = {
  pendente: 'bg-amber-100 text-amber-700',
  aprovado: 'bg-blue-100 text-blue-700',
  recusado: 'bg-red-100 text-red-700',
  comprado: 'bg-green-100 text-green-700',
};

@Component({
  selector: 'app-fundo-fixo-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe],
  templateUrl: './fundo-fixo-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoListComponent implements OnInit {
  readonly limiteMensal = FUNDO_FIXO_LIMITE_MENSAL;
  readonly setores = FUNDO_FIXO_SETORES;
  readonly statusLabel = STATUS_LABEL;
  readonly statusBadge = STATUS_BADGE;

  errorMessage = signal('');

  // Filtros
  mesFiltro = signal(this.fundoFixoService.mesAtual());
  statusFiltro = signal<StatusFiltro>('todos');
  setorFiltro = signal<'todos' | string>('todos');
  searchTerm = signal('');

  readonly meses = (() => {
    const result: { value: string; label: string }[] = [];
    const hoje = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return result;
  })();

  // Modais
  recusarAlvo = signal<FundoFixoSolicitacao | null>(null);
  motivoRecusa = signal('');
  comprarAlvo = signal<FundoFixoSolicitacao | null>(null);
  comprarValorFinal = signal<number | null>(null);
  comprarFornecedor = signal('');
  comprarNotaFiscal = signal<File | null>(null);
  isProcessando = signal(false);

  isLoading = this.fundoFixoService.isLoading;
  currentUser = this.authService.currentUser;
  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');
  podeSolicitar = computed(() => this.authService.currentUser()?.role !== 'Visualizador');

  solicitacoesDoMes = computed(() =>
    this.fundoFixoService.solicitacoes().filter(s => s.mesReferencia === this.mesFiltro())
  );

  totalComprometido = computed(() => this.fundoFixoService.totalComprometidoMes(this.mesFiltro()));
  saldoRestante = computed(() => Math.max(0, this.limiteMensal - this.totalComprometido()));
  percentualUsado = computed(() => Math.min(100, (this.totalComprometido() / this.limiteMensal) * 100));

  totalComprado = computed(() =>
    this.solicitacoesDoMes()
      .filter(s => s.status === 'comprado')
      .reduce((sum, s) => sum + (s.valorFinal ?? 0), 0)
  );
  countPendentes = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'pendente').length);
  countAguardandoNota = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'aprovado').length);

  listaFiltrada = computed(() => {
    const status = this.statusFiltro();
    const setor = this.setorFiltro();
    const termo = this.searchTerm().trim().toLowerCase();

    return this.solicitacoesDoMes().filter(s => {
      if (status !== 'todos' && s.status !== status) return false;
      if (setor !== 'todos' && s.setor !== setor) return false;
      if (termo) {
        const texto = `${s.material} ${s.solicitanteNome} ${s.fornecedor ?? ''}`.toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  });

  constructor(
    private fundoFixoService: FundoFixoService,
    private authService: AuthService,
    private notificationService: NotificationService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.fundoFixoService.load();
    } catch {
      this.errorMessage.set('Erro ao carregar solicitações do Fundo Fixo.');
    }
  }

  podeAnexarNota(s: FundoFixoSolicitacao): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return s.status === 'aprovado' && (this.isAdmin() || s.solicitanteId === user.id);
  }

  // ── Aprovar ────────────────────────────────────────────────────────────
  async aprovar(s: FundoFixoSolicitacao): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.aprovar(s.id);
      this.notificationService.showSuccess(`Solicitação de ${s.solicitanteNome} aprovada.`);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao aprovar.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Recusar ────────────────────────────────────────────────────────────
  abrirRecusar(s: FundoFixoSolicitacao): void {
    this.recusarAlvo.set(s);
    this.motivoRecusa.set('');
  }

  fecharRecusar(): void {
    this.recusarAlvo.set(null);
  }

  async confirmarRecusa(): Promise<void> {
    const alvo = this.recusarAlvo();
    if (!alvo || this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.recusar(alvo.id, this.motivoRecusa());
      this.notificationService.showSuccess('Solicitação recusada.');
      this.fecharRecusar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao recusar.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Marcar como comprado (anexar nota fiscal) ─────────────────────────
  abrirComprar(s: FundoFixoSolicitacao): void {
    this.comprarAlvo.set(s);
    this.comprarValorFinal.set(s.valorEstimado);
    this.comprarFornecedor.set(s.fornecedor ?? '');
    this.comprarNotaFiscal.set(null);
  }

  fecharComprar(): void {
    this.comprarAlvo.set(null);
  }

  onNotaFiscalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.comprarNotaFiscal.set(input.files?.[0] ?? null);
  }

  canConfirmarCompra(): boolean {
    return !!this.comprarNotaFiscal() && (this.comprarValorFinal() ?? 0) > 0 && !this.isProcessando();
  }

  async confirmarCompra(): Promise<void> {
    const alvo = this.comprarAlvo();
    const nota = this.comprarNotaFiscal();
    if (!alvo || !nota || !this.canConfirmarCompra()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.marcarComprado(
        alvo.id, nota, this.comprarValorFinal() ?? alvo.valorEstimado, this.comprarFornecedor(),
      );
      this.notificationService.showSuccess('Compra registrada com sucesso!');
      this.fecharComprar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao registrar compra.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  formatDate(d: Date | null): string {
    if (!d) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }
}
