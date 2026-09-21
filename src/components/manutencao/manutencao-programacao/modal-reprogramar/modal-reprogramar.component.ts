import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { ManutencaoPlanosService } from '../../../../services/manutencao-planos.service';
import { NotificationService } from '../../../../services/notification.service';
import { ManutencaoOrdem } from '../../../../models/manutencao-programacao.model';
import { diasDaSemana } from '../../../../utils/manutencao-regras';

// Modal "Reprogramar" (move uma OS pra outra semana) — extraído de manutencao-programacao
// pra reduzir o tamanho do componente host. Diferente de Editar: mexe em semana_inicio,
// que o formulário normal nunca toca. Dias dentro da semana nova são preenchidos
// automaticamente como dias úteis (Seg-Sex) — dá pra ajustar depois em "Editar" se
// precisar de dias específicos.
@Component({
  selector: 'app-modal-reprogramar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-reprogramar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalReprogramarComponent {
  @Input() semanas: { value: string; label: string }[] = [];

  alvo = signal<ManutencaoOrdem | null>(null);
  novaSemana = signal('');
  recalcular = signal(false);
  isProcessando = signal(false);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private manutencaoPlanosService: ManutencaoPlanosService,
    private notificationService: NotificationService,
  ) {}

  abrir(o: ManutencaoOrdem): void {
    this.alvo.set(o);
    const atual = this.semanas.findIndex(s => s.value === o.semanaInicio);
    const proxima = atual >= 0 && atual + 1 < this.semanas.length ? this.semanas[atual + 1].value : this.semanas[this.semanas.length - 1].value;
    this.novaSemana.set(proxima);
    this.recalcular.set(false);
  }

  fechar(): void {
    this.alvo.set(null);
  }

  async confirmar(): Promise<void> {
    const ordem = this.alvo();
    const novaSemana = this.novaSemana();
    if (!ordem || !novaSemana || this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      const novosDias = diasDaSemana(novaSemana).filter(d => d.label !== 'SAB' && d.label !== 'DOM').map(d => d.data);
      await this.manutencaoService.reprogramarOrdem(ordem.id, novaSemana, novosDias, this.recalcular());
      await this.manutencaoPlanosService.load();

      this.notificationService.showSuccess('Ordem reprogramada.');
      this.fechar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao reprogramar.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
