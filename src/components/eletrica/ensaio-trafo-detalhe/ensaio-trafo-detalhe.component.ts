import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnexosGaleriaComponent } from '../anexos/anexos.component';
import { ComparacaoAnteriorComponent } from '../comparacao-anterior/comparacao-anterior.component';
import { QUEDA_IR_ALERTA_PCT, VARIACAO_OHMICA_ALERTA_PCT, compararTrafo, ensaioAnterior } from '../../../utils/eletrica-comparacao';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { EnsaioTrafo, Transformador } from '../../../models/eletrica-trafo.model';
import {
  RESULTADO_BADGE, RESULTADO_LABEL, formatarIndice, formatarMohm, formatarNumero, numeroEnsaio,
} from '../../../utils/eletrica-ensaio';
import {
  LIGACAO_SIMBOLO, MATERIAL_LABEL, MEIO_LABEL, avaliarTrafo, circuitoTrafoLabel, fatorCorrecao20, formatarPct,
  formatarRelacao, temperaturaEnsaio, tensoesTexto,
} from '../../../utils/eletrica-trafo';
import { dataBr } from '../../../utils/eletrica-reparo';
import { baixarPdfEnsaioTrafo } from '../../../utils/eletrica-trafo-pdf';

// Um ensaio de transformador: isolamento, ôhmica e TTR, cada item com a avaliação NETA.
@Component({
  selector: 'app-ensaio-trafo-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, AnexosGaleriaComponent, ComparacaoAnteriorComponent],
  templateUrl: './ensaio-trafo-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnsaioTrafoDetalheComponent implements OnInit {
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly circuitoLabel = circuitoTrafoLabel;
  readonly meioLabel = MEIO_LABEL;
  readonly materialLabel = MATERIAL_LABEL;
  readonly simbolo = LIGACAO_SIMBOLO;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly indice = formatarIndice;
  readonly fmt = formatarNumero;
  readonly pct = formatarPct;
  readonly relacao = formatarRelacao;
  readonly tensoes = tensoesTexto;

  private id = '';
  ensaio = signal<EnsaioTrafo | null>(null);
  trafo = signal<Transformador | null>(null);
  anterior = signal<EnsaioTrafo | null>(null);
  readonly regraComparacao = `Aviso quando a IR corrigida cai ${QUEDA_IR_ALERTA_PCT}% ou mais e quando a resistência ôhmica a 75 °C varia mais de ${VARIACAO_OHMICA_ALERTA_PCT}% (NETA MTS). Não muda o resultado.`;
  comparacao = computed(() => {
    const e = this.ensaio();
    const a = this.anterior();
    return e && a ? compararTrafo(e, a) : [];
  });
  anteriorRotulo = computed(() => {
    const a = this.anterior();
    return a ? `${numeroEnsaio(a.numero)} de ${dataBr(a.dataEnsaio)}` : null;
  });
  carregando = signal(true);
  gerandoPdf = signal(false);
  excluindo = signal(false);
  isAdmin = this.ensaioService.isAdmin;

  avaliacao = computed(() => {
    const e = this.ensaio();
    return e ? avaliarTrafo(e) : null;
  });

  temperatura = computed(() => {
    const e = this.ensaio();
    if (!e) return null;
    const t = temperaturaEnsaio(e);
    return { t, fator: fatorCorrecao20(t) };
  });

  podeCorrigir = computed(() => {
    const e = this.ensaio();
    return !!e && this.ensaioService.podeCorrigir(e);
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
      const e = await this.ensaioService.buscarEnsaioTrafo(this.id);
      this.ensaio.set(e);
      if (e) {
        const [t, lista] = await Promise.all([
          this.ensaioService.buscarTrafo(e.equipamentoId), this.ensaioService.ensaiosDoTrafo(e.equipamentoId),
        ]);
        this.trafo.set(t);
        this.anterior.set(ensaioAnterior(lista, e));
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o ensaio.');
    } finally {
      this.carregando.set(false);
    }
  }

  async baixarPdf(): Promise<void> {
    const e = this.ensaio();
    const t = this.trafo();
    if (!e || !t || this.gerandoPdf()) return;
    this.gerandoPdf.set(true);
    try {
      await baixarPdfEnsaioTrafo(e, t, this.anterior());
    } catch (err) {
      console.error('[ensaio-trafo] Falha ao gerar PDF:', err);
      this.notificationService.showError('Erro ao gerar o PDF.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  async excluir(): Promise<void> {
    const e = this.ensaio();
    if (!e || this.excluindo()) return;
    const ok = await this.confirmDialogService.confirm(
      `Excluir o ensaio ${numeroEnsaio(e.numero)} (${this.trafo()?.tag ?? ''}, ${dataBr(e.dataEnsaio)})? Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.ensaioService.excluirEnsaio(e.id);
      this.notificationService.showSuccess(`${numeroEnsaio(e.numero)} excluído.`);
      await this.router.navigate(['/eletrica/ensaios/trafos', e.equipamentoId]);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
