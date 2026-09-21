import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { NotificationService } from '../../../../services/notification.service';
import { ConfirmDialogService } from '../../../../services/confirm-dialog.service';
import { EquipeApoioItem, OperadorEscalaApoio } from '../../../../models/manutencao-programacao.model';
import { EquipeApoio } from '../../../../utils/escala-apoio';

// Modal "Gerenciar Apoio" (Admin) — cadastro de equipes/empresas do Apoio e da escala de
// turno (operador -> equipe). Extraído de manutencao-programacao pra reduzir o tamanho do
// componente host. Os signals equipesApoio/escalaApoio aqui são a MESMA referência
// readonly do serviço que o host também usa (pra Escala de turno/tecnicosPorArea) — dois
// componentes lendo o mesmo signal, sempre em sincronia automaticamente.
@Component({
  selector: 'app-gerenciar-apoio-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gerenciar-apoio-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GerenciarApoioModalComponent {
  aberto = signal(false);
  equipesApoio = this.manutencaoService.equipesApoio;
  escalaApoio = this.manutencaoService.escalaApoio;
  novaEquipeApoioNome = signal('');
  novoOperadorNome = signal('');
  novoOperadorEquipe = signal<EquipeApoio>('A');
  readonly equipesApoioOpcoes: EquipeApoio[] = ['A', 'B', 'C', 'D'];
  isProcessando = signal(false);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
  ) {}

  abrir(): void {
    this.novaEquipeApoioNome.set('');
    this.novoOperadorNome.set('');
    this.novoOperadorEquipe.set('A');
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  async adicionarEquipeApoio(): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarEquipeApoio(this.novaEquipeApoioNome());
      this.novaEquipeApoioNome.set('');
      this.notificationService.showSuccess('Equipe/empresa adicionada.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar equipe/empresa.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerEquipeApoio(item: EquipeApoioItem): Promise<void> {
    if (this.isProcessando() || !(await this.confirmDialogService.confirm(`Remover "${item.nome}" do cadastro? Lançamentos já feitos com essa equipe não são afetados.`))) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirEquipeApoio(item.id);
      this.notificationService.showSuccess('Equipe/empresa removida.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover equipe/empresa.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async adicionarOperadorEscala(): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarOperadorEscala(this.novoOperadorNome(), this.novoOperadorEquipe());
      this.novoOperadorNome.set('');
      this.notificationService.showSuccess('Operador adicionado à escala.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar operador.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerOperadorEscala(item: OperadorEscalaApoio): Promise<void> {
    if (this.isProcessando() || !(await this.confirmDialogService.confirm(`Remover "${item.nome}" da escala?`))) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirOperadorEscala(item.id);
      this.notificationService.showSuccess('Operador removido da escala.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover operador.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
