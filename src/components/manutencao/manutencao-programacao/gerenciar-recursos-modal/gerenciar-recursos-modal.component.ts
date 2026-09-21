import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { NotificationService } from '../../../../services/notification.service';
import { ConfirmDialogService } from '../../../../services/confirm-dialog.service';
import { RecursoEspecialItem } from '../../../../models/manutencao-programacao.model';

// Modal "Gerenciar Recursos" (Admin) — cadastro dos "recursos especiais" (Munck/
// Guindaste/Andaime/Fontebras...) que sugerem no campo Recursos e espelham
// automaticamente uma OS pro Apoio (ver recursosEquipamentoOpcoes/recursoParaEmpresaApoio
// no host, que continuam lá — só o cadastro em si virou este componente). Extraído de
// manutencao-programacao pra reduzir o tamanho do componente host; totalmente
// autocontido (estado + CRUD próprios), sem nenhum dado que precise voltar pro host.
@Component({
  selector: 'app-gerenciar-recursos-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gerenciar-recursos-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GerenciarRecursosModalComponent {
  aberto = signal(false);
  recursosEspeciais = this.manutencaoService.recursosEspeciais;
  novoRecursoOpcao = signal('');
  novoRecursoEmpresa = signal('');
  isProcessando = signal(false);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
  ) {}

  abrir(): void {
    this.novoRecursoOpcao.set('');
    this.novoRecursoEmpresa.set('');
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  async adicionarRecursoEspecial(): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarRecursoEspecial(this.novoRecursoOpcao(), this.novoRecursoEmpresa());
      this.novoRecursoOpcao.set('');
      this.novoRecursoEmpresa.set('');
      this.notificationService.showSuccess('Recurso adicionado.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar recurso.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerRecursoEspecial(item: RecursoEspecialItem): Promise<void> {
    if (this.isProcessando() || !(await this.confirmDialogService.confirm(`Remover "${item.opcao}" do cadastro? Lançamentos já feitos com esse recurso não são afetados.`))) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirRecursoEspecial(item.id);
      this.notificationService.showSuccess('Recurso removido.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover recurso.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
