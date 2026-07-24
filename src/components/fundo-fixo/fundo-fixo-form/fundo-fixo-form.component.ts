import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FundoFixoService, FUNDO_FIXO_LIMITE_POR_COMPRA, FUNDO_FIXO_SETORES } from '../../../services/fundo-fixo.service';
import { NotificationService } from '../../../services/toast.service';
import { FundoFixoSetor } from '../../../models/fundo-fixo.model';

@Component({
  selector: 'app-fundo-fixo-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './fundo-fixo-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoFormComponent {
  readonly setores = FUNDO_FIXO_SETORES;
  readonly limitePorCompra = FUNDO_FIXO_LIMITE_POR_COMPRA;

  setor = signal<FundoFixoSetor>('Manutenção');
  fornecedor = signal('');
  material = signal('');
  linkProduto = signal('');
  valorEstimado = signal<number | null>(null);
  observacoes = signal('');
  orcamento = signal<File | null>(null);

  isSubmitting = signal(false);
  errorMessage = signal('');

  constructor(
    private fundoFixoService: FundoFixoService,
    private notificationService: NotificationService,
    private router: Router,
  ) {}

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
    return !!this.material().trim() && valor > 0 && valor <= this.limitePorCompra && !this.isSubmitting();
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      await this.fundoFixoService.criarSolicitacao(
        {
          setor: this.setor(),
          fornecedor: this.fornecedor() || undefined,
          material: this.material(),
          linkProduto: this.linkProduto() || undefined,
          valorEstimado: this.valorEstimado() ?? 0,
          observacoes: this.observacoes() || undefined,
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
