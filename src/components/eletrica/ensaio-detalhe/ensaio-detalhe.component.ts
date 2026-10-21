import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnexosGaleriaComponent } from '../anexos/anexos.component';
import { ComparacaoAnteriorComponent } from '../comparacao-anterior/comparacao-anterior.component';
import { QUEDA_IR_ALERTA_PCT, compararMotor, ensaioAnterior } from '../../../utils/eletrica-comparacao';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { EnsaioIsolamento, Motor } from '../../../models/eletrica-ensaio.model';
import { CorSerie, SerieLinha, drawLinhas, limparGrafico } from '../../../utils/charts';
import {
  CLASSE_LABEL, RESULTADO_BADGE, RESULTADO_LABEL, TIPO_BOBINA_LABEL, avaliarEnsaio, circuitoLabel,
  criterioDoEnsaio, fatorCorrecao40, formatarIndice, formatarMohm, formatarNumero, ipMinimo, irMinimoMohm,
  irMinimoTexto, numeroEnsaio, temperaturaCorrecao, tensaoEnsaioAdequada, tensaoEnsaioRecomendada,
} from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';
import { baixarPdfEnsaio } from '../../../utils/eletrica-ensaio-pdf';

const COR_CIRCUITO: Record<string, CorSerie> = { A: 1, B: 2, C: 3, ABC: 4 };
const TEMPOS_MIN = [0.5, 1, 10];
const tempoTexto = (t: number) => (t < 1 ? '30 s' : `${t} min`);

// Um ensaio: leituras, avaliação IEEE 43 circuito a circuito, curva de absorção e PDF.
@Component({
  selector: 'app-ensaio-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, AnexosGaleriaComponent, ComparacaoAnteriorComponent],
  templateUrl: './ensaio-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnsaioDetalheComponent implements OnInit, OnDestroy {
  readonly classeLabel = CLASSE_LABEL;
  readonly bobinaLabel = TIPO_BOBINA_LABEL;
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly circuitoLabel = circuitoLabel;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly indice = formatarIndice;
  readonly fmt = formatarNumero;

  private id = '';
  ensaio = signal<EnsaioIsolamento | null>(null);
  motor = signal<Motor | null>(null);
  anterior = signal<EnsaioIsolamento | null>(null);
  readonly regraComparacao = `Aviso quando a IR corrigida cai ${QUEDA_IR_ALERTA_PCT}% ou mais (IEEE 43: acompanhar a tendência). Não muda o resultado.`;
  comparacao = computed(() => {
    const e = this.ensaio();
    const a = this.anterior();
    return e && a ? compararMotor(e, a) : [];
  });
  anteriorRotulo = computed(() => {
    const a = this.anterior();
    return a ? `${numeroEnsaio(a.numero)} de ${dataBr(a.dataEnsaio)}` : null;
  });
  carregando = signal(true);
  gerandoPdf = signal(false);
  excluindo = signal(false);
  isAdmin = this.ensaioService.isAdmin;

  private graficoCurva = viewChild<ElementRef>('graficoCurva');

  avaliacao = computed(() => {
    const e = this.ensaio();
    return e ? avaliarEnsaio(e.medicoes, criterioDoEnsaio(e)) : null;
  });

  info = computed(() => {
    const e = this.ensaio();
    if (!e) return null;
    const t = temperaturaCorrecao(e);
    const rec = tensaoEnsaioRecomendada(e.tensaoNominalV);
    return {
      temperatura: t,
      kt: fatorCorrecao40(t),
      irMin: irMinimoMohm(e.tipoBobina, e.tensaoNominalV),
      irMinTexto: irMinimoTexto(e.tipoBobina),
      ipMin: ipMinimo(e.classeIsolamento),
      tensaoOk: tensaoEnsaioAdequada(e.tensaoAplicadaV, e.tensaoNominalV),
      tensaoRec: rec.min === rec.max ? `${rec.min} V` : `${rec.min} a ${rec.max} V`,
    };
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

    effect(() => {
      const e = this.ensaio();
      const el = this.graficoCurva();
      if (!e || !el) return;
      // Leituras como medidas (sem correção): a forma da curva é o que interessa aqui.
      const series: SerieLinha[] = e.medicoes.map(l => ({
        nome: circuitoLabel(l.circuito).replace(' – Terra', ''),
        cor: COR_CIRCUITO[l.circuito] ?? 4,
        pontos: [l.r30s, l.r1min, l.r10min]
          .map((v, i) => ({ x: TEMPOS_MIN[i], y: v ?? NaN, nota: l.foraEscala ? 'fundo de escala' : undefined }))
          .filter(p => Number.isFinite(p.y)),
      }));
      drawLinhas(el, series, {
        ariaLabel: 'Curva de absorção: resistência de isolamento medida em 30 segundos, 1 minuto e 10 minutos',
        eixoX: 'log', ticksX: TEMPOS_MIN, formatX: tempoTexto, rotuloX: 'Tempo',
        formatY: v => `${formatarMohm(v)} MΩ`, yLog: true,
      });
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const e = await this.ensaioService.buscarEnsaio(this.id);
      if (!e) {
        const tipo = await this.ensaioService.tipoDoEnsaio(this.id);
        if (tipo && tipo !== 'motor') {
          await this.router.navigate(EletricaEnsaioService.rotaEnsaio(tipo, this.id), { replaceUrl: true });
          return;
        }
      }
      this.ensaio.set(e);
      if (e) {
        const [m, lista] = await Promise.all([
          this.ensaioService.buscarMotor(e.equipamentoId), this.ensaioService.ensaiosDoMotor(e.equipamentoId),
        ]);
        this.motor.set(m);
        this.anterior.set(ensaioAnterior(lista, e));
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o ensaio.');
    } finally {
      this.carregando.set(false);
    }
  }

  ngOnDestroy(): void {
    limparGrafico(this.graficoCurva());
  }

  async baixarPdf(): Promise<void> {
    const e = this.ensaio();
    const m = this.motor();
    if (!e || !m || this.gerandoPdf()) return;
    this.gerandoPdf.set(true);
    try {
      await baixarPdfEnsaio(e, m, this.anterior());
    } catch (err) {
      console.error('[ensaio] Falha ao gerar PDF:', err);
      this.notificationService.showError('Erro ao gerar o PDF.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  async excluir(): Promise<void> {
    const e = this.ensaio();
    if (!e || this.excluindo()) return;
    const ok = await this.confirmDialogService.confirm(
      `Excluir o ensaio ${numeroEnsaio(e.numero)} (${this.motor()?.tag ?? ''}, ${dataBr(e.dataEnsaio)})? Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.ensaioService.excluirEnsaio(e.id);
      this.notificationService.showSuccess(`${numeroEnsaio(e.numero)} excluído.`);
      await this.router.navigate(['/eletrica/ensaios/motores', e.equipamentoId]);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
