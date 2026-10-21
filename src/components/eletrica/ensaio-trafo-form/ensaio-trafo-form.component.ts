import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnexoForm, AnexosEditorComponent, anexoParaForm } from '../anexos/anexos.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { AuthService } from '../../../services/auth.service';
import {
  CriterioTrafo, EnsaioTrafo, LeituraIsolamentoTrafo, OhmicaEnrolamento, Transformador, TtrSecundario,
} from '../../../models/eletrica-trafo.model';
import {
  RESULTADO_BADGE, RESULTADO_LABEL, formatarIndice, formatarMohm, formatarNumero, lerNumero, numeroEnsaio,
} from '../../../utils/eletrica-ensaio';
import {
  LIGACAO_SIMBOLO, MEIO_LABEL, avaliarTrafo, circuitoTrafoLabel, fatorCorrecao20, formatarPct, formatarRelacao,
  isolamentoVazio, ohmicaVazia, relacaoCalculada, tensaoCircuito, tensaoEnsaioTrafo, ttrVazio,
} from '../../../utils/eletrica-trafo';

interface IsolamentoForm {
  circuito: string;
  tensaoV: string;
  r30s: string;
  r1min: string;
  r10min: string;
  foraEscala: boolean;
}

interface OhmicaForm {
  enrolamento: string;
  pares: { par: string; valor: string }[];
}

interface TtrForm {
  secundario: string;
  pares: { par: string; medida: string }[];
}

interface ExecutanteForm {
  nome: string;
  matricula: string;
}

type Parte = 'isolamento' | 'ohmica' | 'ttr';

const txt = (v: number | null | undefined, casas = 3) => (v === null || v === undefined ? '' : formatarNumero(v, casas));

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lançamento (e correção) do ensaio de transformador — o "check list de ensaios elétricos"
// da planilha: isolamento, resistência ôhmica e TTR, cada parte pode ser feita ou não.
// Avaliação NETA MTS na hora; o service recalcula antes de gravar.
@Component({
  selector: 'app-ensaio-trafo-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AnexosEditorComponent],
  templateUrl: './ensaio-trafo-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnsaioTrafoFormComponent implements OnInit {
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly circuitoLabel = circuitoTrafoLabel;
  readonly meioLabel = MEIO_LABEL;
  readonly simbolo = LIGACAO_SIMBOLO;
  readonly mohm = formatarMohm;
  readonly indice = formatarIndice;
  readonly pct = formatarPct;
  readonly relacao = formatarRelacao;
  readonly fmt = formatarNumero;
  readonly camposLeitura: { k: 'r30s' | 'r1min' | 'r10min'; rotulo: string }[] = [
    { k: 'r30s', rotulo: '30 segundos' }, { k: 'r1min', rotulo: '1 minuto' }, { k: 'r10min', rotulo: '10 minutos' },
  ];

  id: string | null = null;
  numeroAtual = signal('');
  carregando = signal(true);
  erroFatal = signal('');

  trafos = this.ensaioService.trafos;
  trafoId = signal('');
  // Na correção vale a placa copiada no dia do ensaio.
  private snapshot = signal<CriterioTrafo | null>(null);

  dataEnsaio = signal(hojeIso());
  osNumero = signal('');
  instrumento = signal('');
  instrumentoModelo = signal('');
  temperaturaAmbiente = signal('');
  temperaturaEnrolamento = signal('');
  umidade = signal('');
  tapTensao = signal('');

  partes = signal<Record<Parte, boolean>>({ isolamento: true, ohmica: true, ttr: true });
  isolamento = signal<IsolamentoForm[]>([]);
  ohmica = signal<OhmicaForm[]>([]);
  ttr = signal<TtrForm[]>([]);
  executantes = signal<ExecutanteForm[]>([]);
  observacoes = signal('');
  anexos = signal<AnexoForm[]>([]);

  isSubmitting = signal(false);
  errorMessage = signal('');

  trafo = computed<Transformador | null>(() => this.trafos().find(t => t.id === this.trafoId()) ?? null);

  criterio = computed<CriterioTrafo | null>(() => {
    const tap = lerNumero(this.tapTensao());
    const s = this.snapshot();
    if (s) return { ...s, tapTensaoV: tap && tap > 0 ? tap : s.tapTensaoV };
    const t = this.trafo();
    if (!t) return null;
    return {
      tensaoPrimariaV: t.tensaoPrimariaV,
      tapTensaoV: tap && tap > 0 ? tap : t.tensaoPrimariaV,
      ligacaoPrimaria: t.ligacaoPrimaria,
      secundarios: t.secundarios,
      meioIsolante: t.meioIsolante,
      materialEnrolamento: t.materialEnrolamento,
      classeIsolamento: t.classeIsolamento,
    };
  });

  temperatura = computed(() => lerNumero(this.temperaturaEnrolamento()) ?? lerNumero(this.temperaturaAmbiente()));

  private leituras = computed(() => {
    const p = this.partes();
    const isolamento: LeituraIsolamentoTrafo[] = p.isolamento ? this.isolamento().map(l => ({
      circuito: l.circuito, tensaoV: lerNumero(l.tensaoV), r30s: lerNumero(l.r30s), r1min: lerNumero(l.r1min),
      r10min: lerNumero(l.r10min), foraEscala: l.foraEscala,
    })) : [];
    const ohmica: OhmicaEnrolamento[] = p.ohmica ? this.ohmica().map(o => ({
      enrolamento: o.enrolamento, pares: o.pares.map(x => ({ par: x.par, valor: lerNumero(x.valor) })),
    })) : [];
    const ttr: TtrSecundario[] = p.ttr ? this.ttr().map(t => ({
      secundario: t.secundario, pares: t.pares.map(x => ({ par: x.par, medida: lerNumero(x.medida) })),
    })) : [];
    return { isolamento, ohmica, ttr };
  });

  avaliacao = computed(() => {
    const c = this.criterio();
    const tAmb = lerNumero(this.temperaturaAmbiente());
    if (!c || tAmb === null) return null;
    return avaliarTrafo({ criterio: c, ...this.leituras(), temperaturaAmbienteC: tAmb, temperaturaEnrolamentoC: lerNumero(this.temperaturaEnrolamento()) });
  });

  relacoes = computed(() => {
    const c = this.criterio();
    if (!c) return {} as Record<string, number>;
    return Object.fromEntries(c.secundarios.map(s => [s.nome, relacaoCalculada(c.tapTensaoV, c.ligacaoPrimaria, s)]));
  });

  fator20 = computed(() => {
    const t = this.temperatura();
    return t === null ? null : fatorCorrecao20(t);
  });

  pendencias = computed(() => {
    const p: string[] = [];
    if (!this.criterio()) p.push('Escolha o transformador.');
    if (lerNumero(this.temperaturaAmbiente()) === null) p.push('Informe a temperatura ambiente.');
    if (!Object.values(this.partes()).some(Boolean)) p.push('Marque pelo menos um ensaio realizado.');
    const av = this.avaliacao();
    av?.isolamento.forEach(a => {
      if (a.ir === 'pendente') p.push(`Isolamento ${circuitoTrafoLabel(a.circuito)}: falta a leitura de 1 min.`);
      else if (a.indiceSituacao === 'pendente') p.push(`Isolamento ${circuitoTrafoLabel(a.circuito)}: falta a leitura de 30 s ou 10 min (IA / IP).`);
    });
    av?.ohmica.filter(a => a.situacao === 'pendente').forEach(a => p.push(`Resistência ôhmica ${a.enrolamento}: faltam leituras.`));
    av?.ttr.filter(a => a.situacao === 'pendente').forEach(a => p.push(`TTR H/${a.secundario}: faltam leituras.`));
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
    const trafo = route.snapshot.queryParamMap.get('trafo');
    if (trafo) this.trafoId.set(trafo);
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!this.trafos().length) await this.ensaioService.load();
      if (this.id) {
        const e = await this.ensaioService.buscarEnsaioTrafo(this.id);
        if (!e) {
          this.erroFatal.set('Ensaio não encontrado.');
          return;
        }
        if (!this.ensaioService.podeCorrigir(e)) {
          this.erroFatal.set('Só quem lançou o ensaio (ou Admin) pode corrigi-lo.');
          return;
        }
        this.preencher(e);
      } else {
        const u = this.authService.currentUser();
        this.executantes.set([{ nome: u?.name ?? '', matricula: '' }]);
        if (this.trafo()) this.montarLinhas();
      }
    } catch (err: unknown) {
      this.erroFatal.set(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      this.carregando.set(false);
    }
  }

  private preencher(e: EnsaioTrafo): void {
    this.numeroAtual.set(numeroEnsaio(e.numero));
    this.trafoId.set(e.equipamentoId);
    this.snapshot.set(e.criterio);
    this.tapTensao.set(txt(e.criterio.tapTensaoV, 1));
    this.dataEnsaio.set(e.dataEnsaio);
    this.osNumero.set(e.osNumero ?? '');
    this.instrumento.set(e.instrumento ?? '');
    this.instrumentoModelo.set(e.instrumentoModelo ?? '');
    this.temperaturaAmbiente.set(txt(e.temperaturaAmbienteC, 1));
    this.temperaturaEnrolamento.set(txt(e.temperaturaEnrolamentoC, 1));
    this.umidade.set(txt(e.umidadePct, 1));
    // Parte não feita no ensaio original volta desmarcada, com as linhas vazias prontas.
    this.partes.set({ isolamento: e.isolamento.length > 0, ohmica: e.ohmica.length > 0, ttr: e.ttr.length > 0 });
    this.montarLinhas();
    if (e.isolamento.length) {
      this.isolamento.set(e.isolamento.map(l => ({
        circuito: l.circuito, tensaoV: txt(l.tensaoV, 0), r30s: txt(l.r30s), r1min: txt(l.r1min), r10min: txt(l.r10min), foraEscala: l.foraEscala,
      })));
    }
    if (e.ohmica.length) this.ohmica.set(e.ohmica.map(o => ({ enrolamento: o.enrolamento, pares: o.pares.map(x => ({ par: x.par, valor: txt(x.valor, 4) })) })));
    if (e.ttr.length) this.ttr.set(e.ttr.map(t => ({ secundario: t.secundario, pares: t.pares.map(x => ({ par: x.par, medida: txt(x.medida, 4) })) })));
    this.executantes.set(e.executantes.length ? e.executantes.map(x => ({ ...x })) : [{ nome: '', matricula: '' }]);
    this.observacoes.set(e.observacoes ?? '');
    this.anexos.set(e.anexos.map(anexoParaForm));
  }

  // Linhas vazias a partir da placa (circuitos de isolamento, pares da ôhmica e do TTR).
  private montarLinhas(): void {
    const c = this.criterio();
    if (!c) return;
    this.isolamento.set(isolamentoVazio(c).map(l => ({ circuito: l.circuito, tensaoV: txt(l.tensaoV, 0), r30s: '', r1min: '', r10min: '', foraEscala: false })));
    this.ohmica.set(ohmicaVazia(c).map(o => ({ enrolamento: o.enrolamento, pares: o.pares.map(x => ({ par: x.par, valor: '' })) })));
    this.ttr.set(ttrVazio(c).map(t => ({ secundario: t.secundario, pares: t.pares.map(x => ({ par: x.par, medida: '' })) })));
  }

  escolherTrafo(id: string): void {
    this.trafoId.set(id);
    this.tapTensao.set('');
    this.montarLinhas();
  }

  alternarParte(p: Parte, marcado: boolean): void {
    this.partes.update(x => ({ ...x, [p]: marcado }));
  }

  tensaoMinima(circuito: string): number {
    const c = this.criterio();
    return c ? tensaoEnsaioTrafo(tensaoCircuito(circuito, c)) : 0;
  }

  atualizarIsolamento(i: number, campo: 'tensaoV' | 'r30s' | 'r1min' | 'r10min', valor: string): void {
    this.isolamento.update(l => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  alternarForaEscala(i: number, marcado: boolean): void {
    this.isolamento.update(l => l.map((x, j) => (j === i ? { ...x, foraEscala: marcado } : x)));
  }

  atualizarOhmica(i: number, k: number, valor: string): void {
    this.ohmica.update(l => l.map((o, j) => (j === i ? { ...o, pares: o.pares.map((x, m) => (m === k ? { ...x, valor } : x)) } : o)));
  }

  atualizarTtr(i: number, k: number, valor: string): void {
    this.ttr.update(l => l.map((t, j) => (j === i ? { ...t, pares: t.pares.map((x, m) => (m === k ? { ...x, medida: valor } : x)) } : t)));
  }

  invalido(valor: string): boolean {
    if (!valor.trim()) return false;
    const n = lerNumero(valor);
    return n === null || n <= 0;
  }

  // Desvio de uma leitura do TTR em relação à calculada (mostrado ao lado do campo).
  desvioTtr(secundario: string, medida: string): number | null {
    const m = lerNumero(medida);
    const calc = this.relacoes()[secundario];
    return m && m > 0 && calc ? ((m - calc) / calc) * 100 : null;
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
    const c = this.criterio();
    const av = this.avaliacao();
    const tAmb = lerNumero(this.temperaturaAmbiente());
    const p = this.partes();
    const brutos = [
      ...(p.isolamento ? this.isolamento().flatMap(l => [l.tensaoV, l.r30s, l.r1min, l.r10min]) : []),
      ...(p.ohmica ? this.ohmica().flatMap(o => o.pares.map(x => x.valor)) : []),
      ...(p.ttr ? this.ttr().flatMap(t => t.pares.map(x => x.medida)) : []),
    ];
    if (brutos.some(b => this.invalido(b)) || [this.temperaturaEnrolamento(), this.umidade(), this.tapTensao()].some(v => v.trim() && lerNumero(v) === null)) {
      this.errorMessage.set('Há valores inválidos. Use só números (ex.: 150.000 ou 20,05).');
      return;
    }
    if (!c || tAmb === null || !av?.resultado || !this.dataEnsaio()) {
      this.errorMessage.set(this.pendencias()[0] ?? 'Preencha os campos obrigatórios.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const anexos = await this.ensaioService.subirAnexos(this.anexos());
      const { id, numero } = await this.ensaioService.salvarEnsaioTrafo({
        equipamentoId: this.trafoId(),
        dataEnsaio: this.dataEnsaio(),
        osNumero: this.osNumero(),
        instrumento: this.instrumento(),
        instrumentoModelo: this.instrumentoModelo(),
        temperaturaAmbienteC: tAmb,
        temperaturaEnrolamentoC: lerNumero(this.temperaturaEnrolamento()),
        umidadePct: lerNumero(this.umidade()),
        criterio: c,
        ...this.leituras(),
        executantes: this.executantes(),
        observacoes: this.observacoes(),
        anexos,
      }, this.id ?? undefined);
      this.notificationService.showSuccess(`Ensaio ${numeroEnsaio(numero)} ${this.id ? 'corrigido' : 'registrado'}: ${RESULTADO_LABEL[av.resultado]}.`);
      await this.ensaioService.load();
      await this.router.navigate(['/eletrica/ensaios/trafo', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar o ensaio.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
