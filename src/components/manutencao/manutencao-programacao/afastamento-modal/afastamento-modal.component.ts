import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../../services/apontamentos.service';
import { NotificationService } from '../../../../services/notification.service';
import { ConfirmDialogService } from '../../../../services/confirm-dialog.service';
import { AtestadoTecnico, FeriasTecnico, ManutencaoArea } from '../../../../models/manutencao-programacao.model';
import { formatarDataBr, tecnicosPorArea } from '../../../../utils/manutencao-regras';

export type TipoAfastamento = 'ferias' | 'atestado';

// Modal "Férias / Atestado médico" (Admin) — os dois usam exatamente o mesmo fluxo
// (área -> técnico -> período), parametrizado por `tipo`. Extraído de
// manutencao-programacao pra reduzir o tamanho do componente host. `semanaFiltro` chega
// como @Input clássico (não signal), por isso tecnicosParaAfastamento() é método simples,
// não computed().
@Component({
  selector: 'app-afastamento-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './afastamento-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AfastamentoModalComponent {
  @Input() areaFixa: ManutencaoArea | null = null;
  @Input() semanaFiltro = '';

  readonly ferias = this.manutencaoService.ferias;
  readonly atestados = this.manutencaoService.atestados;
  readonly formatarDataBr = formatarDataBr;
  isProcessando = signal(false);

  modal = signal<{
    tipo: TipoAfastamento;
    area: ManutencaoArea;
    tecnicoNome: string;
    tecnicoMatricula: string;
    dataInicio: string;
    dataFim: string;
  } | null>(null);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private apontamentosService: ApontamentosService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
  ) {}

  private tecnicosPorArea(area: ManutencaoArea): { nome: string; matricula: string | null }[] {
    return tecnicosPorArea(area, this.apontamentosService.colaboradores(), this.manutencaoService.equipesApoio(), this.semanaFiltro);
  }

  tecnicosParaAfastamento(): { nome: string; matricula: string | null }[] {
    const modal = this.modal();
    return modal ? this.tecnicosPorArea(modal.area) : [];
  }

  itensAfastamento(tipo: TipoAfastamento): (FeriasTecnico | AtestadoTecnico)[] {
    return tipo === 'ferias' ? this.ferias() : this.atestados();
  }

  abrir(tipo: TipoAfastamento): void {
    this.modal.set({
      tipo,
      area: this.areaFixa === 'MECANICA' ? 'MECANICA' : 'ELETRICA',
      tecnicoNome: '',
      tecnicoMatricula: '',
      dataInicio: '',
      dataFim: '',
    });
  }

  fechar(): void {
    this.modal.set(null);
  }

  onAreaSelected(area: ManutencaoArea): void {
    this.modal.update(m => m && ({ ...m, area, tecnicoNome: '', tecnicoMatricula: '' }));
  }

  onTecnicoSelected(nome: string): void {
    const modal = this.modal();
    if (!modal) return;
    const colaborador = this.tecnicosPorArea(modal.area).find(c => c.nome === nome);
    this.modal.set({ ...modal, tecnicoNome: nome, tecnicoMatricula: colaborador?.matricula ?? '' });
  }

  setDataInicio(valor: string): void {
    this.modal.update(m => m && ({ ...m, dataInicio: valor }));
  }

  setDataFim(valor: string): void {
    this.modal.update(m => m && ({ ...m, dataFim: valor }));
  }

  canConfirmar(): boolean {
    const modal = this.modal();
    return !!modal && !this.isProcessando() && !!modal.tecnicoNome.trim()
      && !!modal.dataInicio && !!modal.dataFim && modal.dataFim >= modal.dataInicio;
  }

  async confirmar(): Promise<void> {
    const modal = this.modal();
    if (!modal || !this.canConfirmar()) return;
    const label = modal.tipo === 'ferias' ? 'férias' : 'atestado médico';
    this.isProcessando.set(true);
    try {
      const payload = {
        tecnicoNome: modal.tecnicoNome,
        tecnicoMatricula: modal.tecnicoMatricula || null,
        area: modal.area,
        dataInicio: modal.dataInicio,
        dataFim: modal.dataFim,
      };
      if (modal.tipo === 'ferias') {
        await this.manutencaoService.criarFerias(payload);
        this.notificationService.showSuccess('Férias cadastradas.');
      } else {
        await this.manutencaoService.criarAtestado(payload);
        this.notificationService.showSuccess('Atestado médico cadastrado.');
      }
      this.modal.set({ ...modal, tecnicoNome: '', tecnicoMatricula: '', dataInicio: '', dataFim: '' });
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : `Erro ao cadastrar ${label}.`);
    } finally {
      this.isProcessando.set(false);
    }
  }

  async remover(tipo: TipoAfastamento, item: FeriasTecnico | AtestadoTecnico): Promise<void> {
    const label = tipo === 'ferias' ? 'férias' : 'atestado médico';
    if (this.isProcessando() || !(await this.confirmDialogService.confirm(`Remover ${label} de "${item.tecnicoNome}"?`))) return;
    this.isProcessando.set(true);
    try {
      if (tipo === 'ferias') {
        await this.manutencaoService.excluirFerias(item.id);
        this.notificationService.showSuccess('Férias removidas.');
      } else {
        await this.manutencaoService.excluirAtestado(item.id);
        this.notificationService.showSuccess('Atestado médico removido.');
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : `Erro ao remover ${label}.`);
    } finally {
      this.isProcessando.set(false);
    }
  }
}
