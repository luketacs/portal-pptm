import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AnexosGaleriaComponent } from '../anexos/anexos.component';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { EnsaioTermografia } from '../../../models/eletrica-termografia.model';
import { RESULTADO_BADGE, RESULTADO_LABEL, formatarNumero, numeroEnsaio } from '../../../utils/eletrica-ensaio';
import {
  CRITERIO_PONTO_LABEL, PRIORIDADE_ACAO, PRIORIDADE_BADGE, avaliarPontos, formatarTemp, piorPrioridade,
} from '../../../utils/eletrica-termografia';
import { EquipamentoResumo, baixarPdfTermografia } from '../../../utils/eletrica-termografia-pdf';
import { dataBr } from '../../../utils/eletrica-reparo';

// Uma termografia: pontos com a prioridade NETA, imagens térmicas e PDF.
@Component({
  selector: 'app-termografia-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, AnexosGaleriaComponent],
  templateUrl: './termografia-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermografiaDetalheComponent implements OnInit {
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly criterioLabel = CRITERIO_PONTO_LABEL;
  readonly prioridadeAcao = PRIORIDADE_ACAO;
  readonly prioridadeBadge = PRIORIDADE_BADGE;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly temp = formatarTemp;
  readonly fmt = formatarNumero;

  private id = '';
  ensaio = signal<EnsaioTermografia | null>(null);
  equipamento = signal<EquipamentoResumo & { id: string } | null>(null);
  carregando = signal(true);
  gerandoPdf = signal(false);
  excluindo = signal(false);
  isAdmin = this.ensaioService.isAdmin;

  avaliacao = computed(() => {
    const e = this.ensaio();
    return e ? avaliarPontos(e.pontos, e.temperaturaAmbienteC) : [];
  });
  pior = computed(() => piorPrioridade(this.avaliacao()));
  podeCorrigir = computed(() => {
    const e = this.ensaio();
    return !!e && this.ensaioService.podeCorrigir(e);
  });
  linkEquipamento = computed(() => {
    const eq = this.equipamento();
    return eq ? [eq.tipo === 'motor' ? '/eletrica/ensaios/motores' : '/eletrica/ensaios/trafos', eq.id] : ['/eletrica/ensaios'];
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
  }

  async ngOnInit(): Promise<void> {
    try {
      const e = await this.ensaioService.buscarTermografia(this.id);
      this.ensaio.set(e);
      if (e) {
        const eq = await this.ensaioService.buscarEquipamento(e.equipamentoId);
        if (eq) {
          const x = eq.tipo === 'motor' ? eq.motor : eq.trafo;
          this.equipamento.set({ id: x.id, tag: x.tag, tipo: eq.tipo, descricao: x.descricao, aplicacao: x.aplicacao, localInstalacao: x.localInstalacao });
        }
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar a termografia.');
    } finally {
      this.carregando.set(false);
    }
  }

  async baixarPdf(): Promise<void> {
    const e = this.ensaio();
    const eq = this.equipamento();
    if (!e || !eq || this.gerandoPdf()) return;
    this.gerandoPdf.set(true);
    try {
      await baixarPdfTermografia(e, eq);
    } catch (err) {
      console.error('[termografia] Falha ao gerar PDF:', err);
      this.notificationService.showError('Erro ao gerar o PDF.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  async excluir(): Promise<void> {
    const e = this.ensaio();
    if (!e || this.excluindo()) return;
    const ok = await this.confirmDialogService.confirm(
      `Excluir a termografia ${numeroEnsaio(e.numero)} (${this.equipamento()?.tag ?? ''}, ${dataBr(e.dataEnsaio)})? Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.ensaioService.excluirEnsaio(e.id);
      this.notificationService.showSuccess(`${numeroEnsaio(e.numero)} excluída.`);
      await this.router.navigate(this.linkEquipamento());
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
