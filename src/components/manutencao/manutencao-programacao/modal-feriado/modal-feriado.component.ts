import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../../services/apontamentos.service';
import { NotificationService } from '../../../../services/notification.service';
import { ConfirmDialogService } from '../../../../services/confirm-dialog.service';
import { DiaSemana, diaMesPadded, diasDaSemana, todosTecnicos } from '../../../../utils/manutencao-regras';
import { ManutencaoArea } from '../../../../models/manutencao-programacao.model';

// Modal "Feriado" (folga em lote pra toda a equipe Elétrica + Mecânica) — extraído de
// manutencao-programacao pra reduzir o tamanho do componente host. `semanaFiltro` chega
// como @Input clássico (não signal), por isso todosTecnicos()/diasDaSemanaAtual() são
// métodos simples, não computed() — computed() só rastreia leitura de signal, então
// envolver um @Input puro nele congelaria no primeiro valor.
@Component({
  selector: 'app-modal-feriado',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-feriado.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalFeriadoComponent {
  @Input() semanaFiltro = '';

  aberto = signal(false);
  diasSelecionados = signal<string[]>([]);
  motivo = signal('Feriado');
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
    this.diasSelecionados.set([]);
    this.motivo.set('Feriado');
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  toggleDia(dataIso: string): void {
    const atual = this.diasSelecionados();
    this.diasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  canConfirmar(): boolean {
    return this.diasSelecionados().length > 0 && this.todosTecnicos().length > 0 && !this.isProcessando();
  }

  async confirmar(): Promise<void> {
    if (!this.canConfirmar()) return;
    const dias = this.diasSelecionados();
    const motivo = this.motivo().trim() || 'Feriado';

    // Quem já tem qualquer coisa marcada pra algum desses dias não entra — feriado
    // empilhado em cima de OS/reunião/outra folga gera a mesma inconsistência já
    // corrigida pro lote de Reunião (ver ModalReuniaoLoteComponent).
    const bloqueados: string[] = [];
    const tecnicos = this.todosTecnicos().filter(t => {
      const existente = this.manutencaoService.ordens().find(o =>
        o.tecnicoNome === t.nome && o.diasPrevistos.some(d => dias.includes(d)),
      );
      if (existente) bloqueados.push(t.nome);
      return !existente;
    });
    if (tecnicos.length === 0) {
      this.notificationService.showError('Todos os técnicos já têm algo lançado nesses dias — nenhum feriado lançado.');
      return;
    }

    const aviso = bloqueados.length > 0
      ? `\n\n${bloqueados.length} técnico(s) já têm algo lançado nesses dias e não vão entrar: ${bloqueados.join(', ')}.`
      : '';
    if (!(await this.confirmDialogService.confirm(`Lançar "${motivo}" pra ${tecnicos.length} técnicos (Elétrica + Mecânica)?${aviso}`))) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarFolgaEmLote({
        diasPrevistos: dias,
        motivo,
        tecnicos,
      });
      this.notificationService.showSuccess(`"${motivo}" lançado pra ${tecnicos.length} técnicos.${bloqueados.length > 0 ? ` (${bloqueados.length} pulados por já ter algo marcado)` : ''}`);
      this.fechar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao lançar feriado.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
