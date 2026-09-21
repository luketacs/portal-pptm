import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../../services/apontamentos.service';
import { NotificationService } from '../../../../services/notification.service';
import { ConfirmDialogService } from '../../../../services/confirm-dialog.service';
import { ManutencaoArea } from '../../../../models/manutencao-programacao.model';
import { DiaSemana, bloqueioDoTecnico, diaMesPadded, diasDaSemana, todosTecnicos } from '../../../../utils/manutencao-regras';

// Modal "Reunião em lote" (avisa toda a equipe Elétrica + Mecânica de uma vez) —
// extraído de manutencao-programacao pra reduzir o tamanho do componente host.
// `semanaFiltro` chega como @Input clássico (não signal), por isso
// todosTecnicos()/diasDaSemanaAtual() são métodos simples, não computed().
@Component({
  selector: 'app-modal-reuniao-lote',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-reuniao-lote.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalReuniaoLoteComponent {
  @Input() semanaFiltro = '';

  aberto = signal(false);
  dias = signal<string[]>([]);
  titulo = signal('Reunião');
  horario = signal('');
  local = signal('');
  isProcessando = signal(false);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private apontamentosService: ApontamentosService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
  ) {}

  todosTecnicos(): { nome: string; matricula: string | null; area: ManutencaoArea }[] {
    return todosTecnicos(this.apontamentosService.colaboradores(), this.manutencaoService.equipesApoio(), this.semanaFiltro);
  }

  diasDaSemanaAtual(): DiaSemana[] {
    return diasDaSemana(this.semanaFiltro);
  }

  readonly diaMesPadded = diaMesPadded;

  abrir(): void {
    this.dias.set([]);
    this.titulo.set('Reunião');
    this.horario.set('');
    this.local.set('');
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  toggleDia(dataIso: string): void {
    const atual = this.dias();
    this.dias.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  canConfirmar(): boolean {
    return this.dias().length > 0 && !!this.horario().trim() && !!this.local().trim()
      && this.todosTecnicos().length > 0 && !this.isProcessando();
  }

  async confirmar(): Promise<void> {
    if (!this.canConfirmar()) return;
    const dias = this.dias();
    // Quem já está de folga/férias/atestado em algum desses dias não entra — diferente
    // de Feriado (que vale igual pra todo mundo), reunião é algo que a pessoa precisa
    // comparecer, não faz sentido marcar pra quem não vai estar trabalhando.
    const bloqueados: string[] = [];
    const tecnicos = this.todosTecnicos().filter(t => {
      const bloqueado = !!bloqueioDoTecnico(
        this.manutencaoService.ferias(), this.manutencaoService.atestados(), this.manutencaoService.ordens(), t.nome, dias,
      );
      if (bloqueado) bloqueados.push(t.nome);
      return !bloqueado;
    });
    if (tecnicos.length === 0) {
      this.notificationService.showError('Todos os técnicos já estão de folga, férias ou atestado nesses dias — nenhuma reunião lançada.');
      return;
    }

    const titulo = this.titulo().trim() || 'Reunião';
    const aviso = bloqueados.length > 0
      ? `\n\n${bloqueados.length} técnico(s) de folga/férias nesses dias não vão entrar: ${bloqueados.join(', ')}.`
      : '';
    if (!(await this.confirmDialogService.confirm(`Lançar "${titulo}" pra ${tecnicos.length} técnicos (Elétrica + Mecânica)?${aviso}`))) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarReuniaoEmLote({
        diasPrevistos: dias,
        titulo,
        horario: this.horario(),
        local: this.local(),
        tecnicos,
      });
      this.notificationService.showSuccess(`"${titulo}" lançada pra ${tecnicos.length} técnicos.${bloqueados.length > 0 ? ` (${bloqueados.length} de folga/férias não entraram)` : ''}`);
      this.fechar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao lançar reunião.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
