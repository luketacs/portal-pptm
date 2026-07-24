import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FundoFixoService, FUNDO_FIXO_GESTORES, FUNDO_FIXO_LIMITE_POR_COMPRA, FUNDO_FIXO_SETORES } from '../../../services/fundo-fixo.service';
import { NotificationService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { UserService } from '../../../services/user.service';
import { FundoFixoSetor } from '../../../models/fundo-fixo.model';

@Component({
  selector: 'app-fundo-fixo-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './fundo-fixo-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoFormComponent implements OnInit {
  readonly setores = FUNDO_FIXO_SETORES;
  readonly limitePorCompra = FUNDO_FIXO_LIMITE_POR_COMPRA;
  readonly gestores = FUNDO_FIXO_GESTORES;

  setor = signal<FundoFixoSetor>('Manutenção');
  fornecedor = signal('');
  material = signal('');
  linkProduto = signal('');
  valorEstimado = signal<number | null>(null);
  observacoes = signal('');
  orcamento = signal<File | null>(null);
  gestorAprovador = signal('');

  // Só Admin vê/usa: registrar em nome de outra pessoa e direcionar o comprador.
  solicitanteId = signal<string>('');
  compradorId = signal<string>('');

  isSubmitting = signal(false);
  errorMessage = signal('');

  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');
  usuarios = this.userService.users;
  admins = computed(() => this.usuarios().filter(u => u.role === 'Admin'));

  constructor(
    private fundoFixoService: FundoFixoService,
    private notificationService: NotificationService,
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.userService.loadUsers().catch(() => {});
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && file.size > 15 * 1024 * 1024) {
      this.errorMessage.set('Arquivo muito grande (máx. 15 MB).');
      input.value = '';
      return;
    }
    this.orcamento.set(file);
  }

  removerAnexo(): void {
    this.orcamento.set(null);
  }

  canSubmit(): boolean {
    const valor = this.valorEstimado() ?? 0;
    return !!this.material().trim() && !!this.gestorAprovador()
      && valor > 0 && valor <= this.limitePorCompra && !this.isSubmitting();
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      const solicitante = this.usuarios().find(u => u.id === this.solicitanteId());
      const comprador = this.usuarios().find(u => u.id === this.compradorId());

      await this.fundoFixoService.criarSolicitacao(
        {
          setor: this.setor(),
          fornecedor: this.fornecedor() || undefined,
          material: this.material(),
          linkProduto: this.linkProduto() || undefined,
          valorEstimado: this.valorEstimado() ?? 0,
          observacoes: this.observacoes() || undefined,
          gestorAprovador: this.gestorAprovador() || undefined,
          solicitanteId: solicitante?.id,
          solicitanteNome: solicitante?.name,
          compradorId: comprador?.id,
          compradorNome: comprador?.name,
        },
        this.orcamento(),
      );
      this.notificationService.showSuccess('Solicitação enviada! Aguarde a aprovação.');
      await this.router.navigateByUrl('/fundo-fixo/lista');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar solicitação.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
