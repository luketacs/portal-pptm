import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AnexoForm, AnexosEditorComponent, anexoParaForm } from '../anexos/anexos.component';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { CriterioPonto, EnsaioTermografia, PontoTermografia } from '../../../models/eletrica-termografia.model';
import { RESULTADO_BADGE, RESULTADO_LABEL, formatarNumero, lerNumero, numeroEnsaio } from '../../../utils/eletrica-ensaio';
import {
  CRITERIOS_PONTO, CRITERIO_PONTO_LABEL, PRIORIDADE_ACAO, PRIORIDADE_BADGE, avaliarPontos, formatarTemp, pontosPadrao,
  resultadoTermografia,
} from '../../../utils/eletrica-termografia';

interface PontoForm {
  ponto: string;
  grupo: string;
  criterio: CriterioPonto;
  temperaturaC: string;
  limiteC: string;
}

interface ExecutanteForm {
  nome: string;
  matricula: string;
}

const txt = (v: number | null | undefined, casas = 1) => (v === null || v === undefined ? '' : formatarNumero(v, casas));
const paraForm = (p: PontoTermografia): PontoForm =>
  ({ ponto: p.ponto, grupo: p.grupo ?? '', criterio: p.criterio, temperaturaC: txt(p.temperaturaC), limiteC: txt(p.limiteC) });

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lançamento (e correção) de termografia — motor ou trafo. Pontos sugeridos pelo tipo do
// equipamento; avaliação NETA MTS 100.18 na hora (prioridade da ação por ponto).
@Component({
  selector: 'app-termografia-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AnexosEditorComponent],
  templateUrl: './termografia-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermografiaFormComponent implements OnInit {
  readonly criterios = CRITERIOS_PONTO;
  readonly criterioLabel = CRITERIO_PONTO_LABEL;
  readonly prioridadeAcao = PRIORIDADE_ACAO;
  readonly prioridadeBadge = PRIORIDADE_BADGE;
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly temp = formatarTemp;

  id: string | null = null;
  numeroAtual = signal('');
  carregando = signal(true);
  erroFatal = signal('');

  motores = this.ensaioService.motores;
  trafos = this.ensaioService.trafos;
  equipamentoId = signal('');

  dataEnsaio = signal(hojeIso());
  osNumero = signal('');
  instrumentoModelo = signal('');
  temperaturaAmbiente = signal('');
  umidade = signal('');
  cargaPct = signal('');
  emissividade = signal('0,95');
  distanciaM = signal('');
  pontos = signal<PontoForm[]>([]);
  executantes = signal<ExecutanteForm[]>([]);
  observacoes = signal('');
  anexos = signal<AnexoForm[]>([]);

  isSubmitting = signal(false);
  errorMessage = signal('');

  equipamento = computed(() => {
    const id = this.equipamentoId();
    const m = this.motores().find(x => x.id === id);
    if (m) return { tipo: 'motor' as const, tag: m.tag, situacao: m.situacao };
    const t = this.trafos().find(x => x.id === id);
    return t ? { tipo: 'transformador' as const, tag: t.tag, situacao: t.situacao } : null;
  });

  pontosLidos = computed<PontoTermografia[]>(() => this.pontos().map(p => ({
    ponto: p.ponto, grupo: p.grupo.trim() || null, criterio: p.criterio, temperaturaC: lerNumero(p.temperaturaC), limiteC: lerNumero(p.limiteC),
  })));

  avaliacao = computed(() => {
    const amb = lerNumero(this.temperaturaAmbiente());
    return amb === null ? null : avaliarPontos(this.pontosLidos(), amb);
  });

  resultado = computed(() => {
    const av = this.avaliacao();
    return av ? resultadoTermografia(av) : null;
  });

  avisoCarga = computed(() => {
    const c = lerNumero(this.cargaPct());
    return c !== null && c < 40 ? 'Com carga abaixo de 40% o aquecimento aparece menos — o ideal é inspecionar com carga normal de operação.' : '';
  });

  pendencias = computed(() => {
    const p: string[] = [];
    if (!this.equipamento()) p.push('Escolha o equipamento.');
    if (lerNumero(this.temperaturaAmbiente()) === null) p.push('Informe a temperatura ambiente.');
    if (!this.pontos().length) p.push('Inclua pelo menos um ponto.');
    this.pontos().forEach(x => {
      if (!x.ponto.trim()) p.push('Algum ponto está sem nome.');
      else if (lerNumero(x.temperaturaC) === null) p.push(`${x.ponto}: falta a temperatura.`);
      else if (x.criterio === 'limite' && lerNumero(x.limiteC) === null) p.push(`${x.ponto}: falta o limite do fabricante.`);
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
    const eq = route.snapshot.queryParamMap.get('equipamento');
    if (eq) this.equipamentoId.set(eq);
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!this.motores().length && !this.trafos().length) await this.ensaioService.load();
      if (this.id) {
        const e = await this.ensaioService.buscarTermografia(this.id);
        if (!e) { this.erroFatal.set('Termografia não encontrada.'); return; }
        if (!this.ensaioService.podeCorrigir(e)) { this.erroFatal.set('Só quem lançou (ou Admin) pode corrigir.'); return; }
        this.preencher(e);
      } else {
        const u = this.authService.currentUser();
        this.executantes.set([{ nome: u?.name ?? '', matricula: '' }]);
        const eq = this.equipamento();
        if (eq) this.pontos.set(pontosPadrao(eq.tipo).map(paraForm));
      }
    } catch (err: unknown) {
      this.erroFatal.set(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      this.carregando.set(false);
    }
  }

  private preencher(e: EnsaioTermografia): void {
    this.numeroAtual.set(numeroEnsaio(e.numero));
    this.equipamentoId.set(e.equipamentoId);
    this.dataEnsaio.set(e.dataEnsaio);
    this.osNumero.set(e.osNumero ?? '');
    this.instrumentoModelo.set(e.instrumentoModelo ?? '');
    this.temperaturaAmbiente.set(txt(e.temperaturaAmbienteC));
    this.umidade.set(txt(e.umidadePct));
    this.cargaPct.set(txt(e.condicoes.cargaPct, 0));
    this.emissividade.set(txt(e.condicoes.emissividade, 2));
    this.distanciaM.set(txt(e.condicoes.distanciaM));
    this.pontos.set(e.pontos.map(paraForm));
    this.executantes.set(e.executantes.length ? e.executantes.map(x => ({ ...x })) : [{ nome: '', matricula: '' }]);
    this.observacoes.set(e.observacoes ?? '');
    this.anexos.set(e.anexos.map(anexoParaForm));
  }

  escolherEquipamento(id: string): void {
    this.equipamentoId.set(id);
    const eq = this.equipamento();
    if (eq) this.pontos.set(pontosPadrao(eq.tipo).map(paraForm));
  }

  atualizarPonto(i: number, campo: keyof PontoForm, valor: string): void {
    this.pontos.update(l => l.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  }

  adicionarPonto(): void {
    this.pontos.update(l => [...l, { ponto: '', grupo: '', criterio: 'conexao', temperaturaC: '', limiteC: '' }]);
  }

  removerPonto(i: number): void {
    this.pontos.update(l => l.filter((_, j) => j !== i));
  }

  invalido(valor: string): boolean {
    return !!valor.trim() && lerNumero(valor) === null;
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
    const amb = lerNumero(this.temperaturaAmbiente());
    const brutos = [this.umidade(), this.cargaPct(), this.emissividade(), this.distanciaM(), ...this.pontos().flatMap(p => [p.temperaturaC, p.limiteC])];
    if (brutos.some(b => this.invalido(b))) {
      this.errorMessage.set('Há valores inválidos. Use só números (ex.: 45,3).');
      return;
    }
    if (!this.equipamento() || amb === null || !this.resultado() || !this.dataEnsaio()) {
      this.errorMessage.set(this.pendencias()[0] ?? 'Preencha os campos obrigatórios.');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const anexos = await this.ensaioService.subirAnexos(this.anexos());
      const { id, numero } = await this.ensaioService.salvarTermografia({
        equipamentoId: this.equipamentoId(),
        dataEnsaio: this.dataEnsaio(),
        osNumero: this.osNumero(),
        instrumento: 'Câmera termográfica',
        instrumentoModelo: this.instrumentoModelo(),
        temperaturaAmbienteC: amb,
        umidadePct: lerNumero(this.umidade()),
        condicoes: { cargaPct: lerNumero(this.cargaPct()), emissividade: lerNumero(this.emissividade()), distanciaM: lerNumero(this.distanciaM()) },
        pontos: this.pontosLidos(),
        executantes: this.executantes(),
        observacoes: this.observacoes(),
        anexos,
      }, this.id ?? undefined);
      this.notificationService.showSuccess(`Termografia ${numeroEnsaio(numero)} ${this.id ? 'corrigida' : 'registrada'}: ${RESULTADO_LABEL[this.resultado()!]}.`);
      // O service já encaixou a linha gravada nas listas; sem recarregar tudo.
      await this.router.navigate(['/eletrica/ensaios/termografia', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar a termografia.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
