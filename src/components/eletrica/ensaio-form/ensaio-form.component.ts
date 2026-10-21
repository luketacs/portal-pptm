import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { AuthService } from '../../../services/auth.service';
import {
  ClasseIsolamento, EnsaioIsolamento, LeituraIsolamento, Motor, TipoBobina,
} from '../../../models/eletrica-ensaio.model';
import {
  CLASSE_LABEL, RESULTADO_BADGE, RESULTADO_LABEL, TIPO_BOBINA_CURTO, avaliarEnsaio, circuitoLabel, fatorCorrecao40,
  formatarIndice, formatarMohm, formatarNumero, ipMinimo, irMinimoMohm, irMinimoTexto, lerNumero, numeroEnsaio,
  tensaoEnsaioAdequada, tensaoEnsaioRecomendada,
} from '../../../utils/eletrica-ensaio';

type Configuracao = 'fases' | 'conjunto';

interface LinhaForm {
  circuito: string;
  r30s: string;
  r1min: string;
  r10min: string;
  foraEscala: boolean;
}

interface ExecutanteForm {
  nome: string;
  matricula: string;
}

const CIRCUITOS: Record<Configuracao, string[]> = { fases: ['A', 'B', 'C'], conjunto: ['ABC'] };
const linhaVazia = (circuito: string): LinhaForm => ({ circuito, r30s: '', r1min: '', r10min: '', foraEscala: false });

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lançamento (e correção) do ensaio de resistência de isolamento — a tabela do megôhmetro
// da planilha antiga. A avaliação IEEE 43 aparece enquanto digita; o service recalcula
// tudo de novo antes de gravar.
@Component({
  selector: 'app-ensaio-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './ensaio-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnsaioFormComponent implements OnInit {
  readonly classeLabel = CLASSE_LABEL;
  readonly bobinaCurto = TIPO_BOBINA_CURTO;
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly circuitoLabel = circuitoLabel;
  readonly mohm = formatarMohm;
  readonly indice = formatarIndice;
  readonly fmt = formatarNumero;

  id: string | null = null;
  numeroAtual = signal('');
  carregando = signal(true);

  motores = this.ensaioService.motores;
  trafos = this.ensaioService.trafos;
  motorId = signal('');
  // Na correção vale a placa copiada no dia do ensaio, não a de hoje.
  private snapshot = signal<{ tensaoNominalV: number; classeIsolamento: ClasseIsolamento; tipoBobina: TipoBobina } | null>(null);

  dataEnsaio = signal(hojeIso());
  osNumero = signal('');
  instrumento = signal('Megôhmetro digital');
  instrumentoModelo = signal('');
  tensaoAplicada = signal('');
  temperaturaAmbiente = signal('');
  temperaturaEnrolamento = signal('');
  umidade = signal('');
  configuracao = signal<Configuracao>('fases');
  linhas = signal<LinhaForm[]>(CIRCUITOS.fases.map(linhaVazia));
  executantes = signal<ExecutanteForm[]>([]);
  observacoes = signal('');

  isSubmitting = signal(false);
  errorMessage = signal('');

  motor = computed<Motor | null>(() => this.motores().find(m => m.id === this.motorId()) ?? null);

  placa = computed(() => {
    const s = this.snapshot();
    if (s) return s;
    const m = this.motor();
    return m ? { tensaoNominalV: m.tensaoV, classeIsolamento: m.classeIsolamento, tipoBobina: m.tipoBobina } : null;
  });

  temperaturaCorrecao = computed(() => lerNumero(this.temperaturaEnrolamento()) ?? lerNumero(this.temperaturaAmbiente()));

  medicoes = computed<LeituraIsolamento[]>(() => this.linhas().map(l => ({
    circuito: l.circuito,
    r30s: lerNumero(l.r30s),
    r1min: lerNumero(l.r1min),
    r10min: lerNumero(l.r10min),
    foraEscala: l.foraEscala,
  })));

  avaliacao = computed(() => {
    const p = this.placa();
    const t = this.temperaturaCorrecao();
    if (!p || t === null) return null;
    return avaliarEnsaio(this.medicoes(), { ...p, temperaturaC: t });
  });

  criterio = computed(() => {
    const p = this.placa();
    if (!p) return null;
    const rec = tensaoEnsaioRecomendada(p.tensaoNominalV);
    return {
      irMin: irMinimoMohm(p.tipoBobina, p.tensaoNominalV),
      irMinTexto: irMinimoTexto(p.tipoBobina),
      ipMin: ipMinimo(p.classeIsolamento),
      tensaoRec: rec,
      tensaoRecTexto: rec.min === rec.max ? `${rec.min} V` : `${rec.min} a ${rec.max} V`,
    };
  });

  avisoTensao = computed(() => {
    const p = this.placa();
    const v = lerNumero(this.tensaoAplicada());
    if (!p || !v) return '';
    return tensaoEnsaioAdequada(v, p.tensaoNominalV) ? ''
      : `Fora da faixa recomendada pela norma para ${formatarNumero(p.tensaoNominalV, 0)} V (${this.criterio()?.tensaoRecTexto}).`;
  });

  kt = computed(() => {
    const t = this.temperaturaCorrecao();
    return t === null ? null : fatorCorrecao40(t);
  });

  // O que ainda falta pra concluir — aparece embaixo da tabela.
  pendencias = computed(() => {
    const p: string[] = [];
    if (!this.motor()) p.push('Escolha o motor.');
    if (!lerNumero(this.tensaoAplicada())) p.push('Informe a tensão aplicada.');
    if (lerNumero(this.temperaturaAmbiente()) === null) p.push('Informe a temperatura ambiente.');
    const av = this.avaliacao();
    av?.circuitos.forEach(a => {
      if (a.ir === 'pendente') p.push(`${circuitoLabel(a.circuito)}: falta a leitura de 1 min.`);
      else if (a.ipSituacao === 'pendente') p.push(`${circuitoLabel(a.circuito)}: falta a leitura de 10 min (obrigatória para o IP).`);
    });
    return p;
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private authService: AuthService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id');
    const motor = route.snapshot.queryParamMap.get('motor');
    if (motor) this.motorId.set(motor);
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!this.motores().length) await this.ensaioService.load();
      if (this.id) {
        const e = await this.ensaioService.buscarEnsaio(this.id);
        if (!e) {
          this.errorMessage.set('Ensaio não encontrado.');
          return;
        }
        if (!this.ensaioService.podeCorrigir(e)) {
          this.errorMessage.set('Só quem lançou o ensaio (ou Admin) pode corrigi-lo.');
          return;
        }
        this.preencher(e);
      } else {
        const u = this.authService.currentUser();
        this.executantes.set([{ nome: u?.name ?? '', matricula: '' }]);
        this.sugerirTensao();
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      this.carregando.set(false);
    }
  }

  private preencher(e: EnsaioIsolamento): void {
    const txt = (v: number | null) => (v === null ? '' : formatarNumero(v, 2));
    this.numeroAtual.set(numeroEnsaio(e.numero));
    this.motorId.set(e.equipamentoId);
    this.snapshot.set({ tensaoNominalV: e.tensaoNominalV, classeIsolamento: e.classeIsolamento, tipoBobina: e.tipoBobina });
    this.dataEnsaio.set(e.dataEnsaio);
    this.osNumero.set(e.osNumero ?? '');
    this.instrumento.set(e.instrumento ?? '');
    this.instrumentoModelo.set(e.instrumentoModelo ?? '');
    this.tensaoAplicada.set(txt(e.tensaoAplicadaV));
    this.temperaturaAmbiente.set(txt(e.temperaturaAmbienteC));
    this.temperaturaEnrolamento.set(txt(e.temperaturaEnrolamentoC));
    this.umidade.set(txt(e.umidadePct));
    this.configuracao.set(e.medicoes.length === 1 && e.medicoes[0].circuito === 'ABC' ? 'conjunto' : 'fases');
    this.linhas.set(e.medicoes.map(l => ({
      circuito: l.circuito, r30s: txt(l.r30s), r1min: txt(l.r1min), r10min: txt(l.r10min), foraEscala: l.foraEscala,
    })));
    this.executantes.set(e.executantes.length ? e.executantes.map(x => ({ ...x })) : [{ nome: '', matricula: '' }]);
    this.observacoes.set(e.observacoes ?? '');
  }

  escolherMotor(id: string): void {
    // Trafo tem formulário próprio (isolamento, ôhmica e TTR).
    if (this.trafos().some(t => t.id === id)) {
      this.router.navigate(['/eletrica/ensaios/trafo/novo'], { queryParams: { trafo: id } });
      return;
    }
    this.motorId.set(id);
    this.sugerirTensao();
  }

  // Tensão de ensaio: o maior valor recomendado pela norma pra tensão do motor (5 kV pra MT).
  private sugerirTensao(): void {
    const c = this.criterio();
    if (c && !this.tensaoAplicada().trim()) this.tensaoAplicada.set(String(c.tensaoRec.max));
  }

  mudarConfiguracao(c: Configuracao): void {
    if (c === this.configuracao()) return;
    this.configuracao.set(c);
    this.linhas.set(CIRCUITOS[c].map(linhaVazia));
  }

  atualizarLinha(i: number, campo: 'r30s' | 'r1min' | 'r10min', valor: string): void {
    this.linhas.update(l => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  alternarForaEscala(i: number, marcado: boolean): void {
    this.linhas.update(l => l.map((x, j) => (j === i ? { ...x, foraEscala: marcado } : x)));
  }

  leituraInvalida(valor: string): boolean {
    if (!valor.trim()) return false;
    const n = lerNumero(valor);
    return n === null || n <= 0;
  }

  adicionarExecutante(): void {
    this.executantes.update(l => [...l, { nome: '', matricula: '' }]);
  }

  removerExecutante(i: number): void {
    this.executantes.update(l => l.filter((_, j) => j !== i));
  }

  atualizarExecutante(i: number, campo: keyof ExecutanteForm, valor: string): void {
    this.executantes.update(l => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  async onSubmit(): Promise<void> {
    const p = this.placa();
    const av = this.avaliacao();
    const tensao = lerNumero(this.tensaoAplicada());
    const tAmb = lerNumero(this.temperaturaAmbiente());
    const camposInvalidos = this.linhas().some(l => this.leituraInvalida(l.r30s) || this.leituraInvalida(l.r1min) || this.leituraInvalida(l.r10min))
      || [this.temperaturaEnrolamento(), this.umidade()].some(v => v.trim() && lerNumero(v) === null);
    if (camposInvalidos) {
      this.errorMessage.set('Há valores inválidos. Use só números (ex.: 1.250 ou 975,5).');
      return;
    }
    if (!p || !tensao || tAmb === null || !av?.resultado || !this.dataEnsaio()) {
      this.errorMessage.set(this.pendencias()[0] ?? 'Preencha os campos obrigatórios.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const { id, numero } = await this.ensaioService.salvarEnsaio({
        equipamentoId: this.motorId(),
        dataEnsaio: this.dataEnsaio(),
        osNumero: this.osNumero(),
        instrumento: this.instrumento(),
        instrumentoModelo: this.instrumentoModelo(),
        tensaoAplicadaV: tensao,
        temperaturaAmbienteC: tAmb,
        temperaturaEnrolamentoC: lerNumero(this.temperaturaEnrolamento()),
        umidadePct: lerNumero(this.umidade()),
        tensaoNominalV: p.tensaoNominalV,
        classeIsolamento: p.classeIsolamento,
        tipoBobina: p.tipoBobina,
        medicoes: this.medicoes(),
        executantes: this.executantes(),
        observacoes: this.observacoes(),
      }, this.id ?? undefined);
      this.notificationService.showSuccess(`Ensaio ${numeroEnsaio(numero)} ${this.id ? 'corrigido' : 'registrado'}: ${RESULTADO_LABEL[av.resultado]}.`);
      await this.ensaioService.load();
      await this.router.navigate(['/eletrica/ensaios', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar o ensaio.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
