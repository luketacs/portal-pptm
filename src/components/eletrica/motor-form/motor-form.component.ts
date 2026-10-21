import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ClasseIsolamento, TipoBobina } from '../../../models/eletrica-ensaio.model';
import {
  CLASSES_ISOLAMENTO, CLASSE_LABEL, TIPOS_BOBINA, TIPO_BOBINA_LABEL, formatarIndice, formatarNumero, ipMinimo,
  irMinimoMohm, irMinimoTexto, lerNumero, tensaoEnsaioRecomendada, tipoBobinaSugerido,
} from '../../../utils/eletrica-ensaio';

// Dados de placa do motor — preenchido uma vez; cada ensaio copia tensão, classe e tipo
// de bobina, que são o que a IEEE 43 usa pra avaliar.
@Component({
  selector: 'app-motor-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './motor-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MotorFormComponent implements OnInit {
  readonly classes = CLASSES_ISOLAMENTO;
  readonly classeLabel = CLASSE_LABEL;
  readonly tiposBobina = TIPOS_BOBINA;
  readonly tipoBobinaLabel = TIPO_BOBINA_LABEL;

  id: string | null = null;
  carregando = signal(false);

  tag = signal('');
  descricao = signal('');
  localInstalacao = signal('');
  fabricante = signal('');
  modelo = signal('');
  numeroSerie = signal('');
  potenciaKw = signal('');
  potenciaCv = signal('');
  tensaoV = signal('');
  correnteA = signal('');
  frequenciaHz = signal('60');
  fatorServico = signal('');
  rotacaoRpm = signal('');
  classeIsolamento = signal<ClasseIsolamento>('F');
  tipoBobina = signal<TipoBobina>('pre_formada');
  // Enquanto a pessoa não escolher, o tipo de bobina acompanha a tensão digitada.
  private bobinaEscolhida = false;
  observacoes = signal('');

  isSubmitting = signal(false);
  errorMessage = signal('');

  tensaoNumero = computed(() => lerNumero(this.tensaoV()));

  // Resumo do critério que vai valer pra esse motor.
  criterio = computed(() => {
    const v = this.tensaoNumero();
    if (!v || v <= 0) return null;
    const rec = tensaoEnsaioRecomendada(v);
    return {
      irMin: `${formatarNumero(irMinimoMohm(this.tipoBobina(), v), 1)} MΩ (${irMinimoTexto(this.tipoBobina())})`,
      ipMin: formatarIndice(ipMinimo(this.classeIsolamento())),
      tensaoEnsaio: rec.min === rec.max ? `${rec.min} V` : `${rec.min} a ${rec.max} V`,
    };
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id');
  }

  async ngOnInit(): Promise<void> {
    if (!this.id) return;
    this.carregando.set(true);
    try {
      const m = await this.ensaioService.buscarMotor(this.id);
      if (!m) {
        this.errorMessage.set('Motor não encontrado.');
        return;
      }
      const txt = (v: number | null) => (v === null ? '' : formatarNumero(v, 2));
      this.tag.set(m.tag);
      this.descricao.set(m.descricao ?? '');
      this.localInstalacao.set(m.localInstalacao ?? '');
      this.fabricante.set(m.fabricante ?? '');
      this.modelo.set(m.modelo ?? '');
      this.numeroSerie.set(m.numeroSerie ?? '');
      this.potenciaKw.set(txt(m.potenciaKw));
      this.potenciaCv.set(txt(m.potenciaCv));
      this.tensaoV.set(txt(m.tensaoV));
      this.correnteA.set(txt(m.correnteA));
      this.frequenciaHz.set(txt(m.frequenciaHz));
      this.fatorServico.set(txt(m.fatorServico));
      this.rotacaoRpm.set(m.rotacaoRpm === null ? '' : String(m.rotacaoRpm));
      this.classeIsolamento.set(m.classeIsolamento);
      this.tipoBobina.set(m.tipoBobina);
      this.bobinaEscolhida = true;
      this.observacoes.set(m.observacoes ?? '');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao carregar o motor.');
    } finally {
      this.carregando.set(false);
    }
  }

  mudarTensao(valor: string): void {
    this.tensaoV.set(valor);
    const v = lerNumero(valor);
    if (!this.bobinaEscolhida && v && v > 0) this.tipoBobina.set(tipoBobinaSugerido(v));
  }

  escolherBobina(tipo: TipoBobina): void {
    this.bobinaEscolhida = true;
    this.tipoBobina.set(tipo);
  }

  async onSubmit(): Promise<void> {
    const tensao = this.tensaoNumero();
    if (!this.tag().trim() || !tensao || tensao <= 0) {
      this.errorMessage.set('Preencha a TAG e a tensão nominal.');
      return;
    }
    const numeros = {
      potenciaKw: lerNumero(this.potenciaKw()),
      potenciaCv: lerNumero(this.potenciaCv()),
      correnteA: lerNumero(this.correnteA()),
      frequenciaHz: lerNumero(this.frequenciaHz()),
      fatorServico: lerNumero(this.fatorServico()),
      rotacaoRpm: lerNumero(this.rotacaoRpm()),
    };
    const brutos = [this.potenciaKw(), this.potenciaCv(), this.correnteA(), this.frequenciaHz(), this.fatorServico(), this.rotacaoRpm()];
    if (Object.values(numeros).some((n, i) => brutos[i].trim() && n === null)) {
      this.errorMessage.set('Algum campo numérico tem valor inválido (use só números, ex.: 25,7).');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const id = await this.ensaioService.salvarMotor({
        tag: this.tag(),
        descricao: this.descricao(),
        localInstalacao: this.localInstalacao(),
        fabricante: this.fabricante(),
        modelo: this.modelo(),
        numeroSerie: this.numeroSerie(),
        ...numeros,
        rotacaoRpm: numeros.rotacaoRpm === null ? null : Math.round(numeros.rotacaoRpm),
        tensaoV: tensao,
        classeIsolamento: this.classeIsolamento(),
        tipoBobina: this.tipoBobina(),
        observacoes: this.observacoes(),
      }, this.id ?? undefined);
      this.notificationService.showSuccess(this.id ? 'Motor atualizado.' : `Motor ${this.tag().trim().toUpperCase()} cadastrado.`);
      await this.router.navigate(['/eletrica/ensaios/motores', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar o motor.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
