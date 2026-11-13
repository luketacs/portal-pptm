import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AnexoForm, AnexosEditorComponent, anexoParaForm } from '../../eletrica/anexos/anexos.component';
import { MecanicaVibracaoService } from '../../../services/mecanica-vibracao.service';
import { NotificationService } from '../../../services/notification.service';
import {
  AnaliseVibracao, ColetorInspetor, EquipamentoVibracao, FatoresRolamento, LeituraVibracao, PontoMedicao, Situacao, TipoInspecao,
} from '../../../models/mecanica-vibracao.model';
import {
  ALARME_BADGE, ALARME_LABEL, CONCLUSAO_PADRAO, GRANDEZA_LABEL, MODOS_FALHA, SITUACAO_BADGE, SITUACAO_DESCRICAO, SITUACAO_LABEL,
  SITUACOES, alarmeDaLeitura, alteracaoPct, avisoTendencia, formatarPct, formatarValor, identificarFrequencia, numeroAnalise,
  statusSugerido, zonaDaLeitura,
} from '../../../utils/mecanica-vibracao';
import { formatarNumero, lerNumero } from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

interface LeituraForm {
  pontoId: string | null;
  ponto: string;
  grandeza: LeituraVibracao['grandeza'];
  unidade: string;
  alarmeAlerta: number | null;
  alarmePerigo: number | null;
  fatores: FatoresRolamento;
  valor: string;
  fatorCrista: string;
  curtose: string;
  frequenciaHz: string;
  observacao: string;
  aberto: boolean;
}

const txt = (v: number | null | undefined, casas = 3) => (v === null || v === undefined ? '' : formatarNumero(v, casas));
const SEM_FATORES: FatoresRolamento = { bpfo: null, bpfi: null, bsf: null, ftf: null };
const COLETOR_PADRAO = 'SKF Microlog Analyzer GX75';
const SENSOR_PADRAO = 'Acelerômetro SKF CMSS2200 (100 mV/g)';

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function linhaDoPonto(p: PontoMedicao): LeituraForm {
  return {
    pontoId: p.id, ponto: p.nome, grandeza: p.grandeza, unidade: p.unidade, alarmeAlerta: p.alarmeAlerta, alarmePerigo: p.alarmePerigo,
    fatores: p.fatores, valor: '', fatorCrista: '', curtose: '', frequenciaHz: '', observacao: '', aberto: false,
  };
}

// Lançamento (e correção) de uma coleta de vibração, na ordem do relatório em Word da
// equipe: identificação, coletor, valores globais, diagnóstico, recomendação, conclusão.
// Status A/B/C/D sugerido pela ISO 20816-3 (e pelos alarmes do SKF); o inspetor confirma.
@Component({
  selector: 'app-vibracao-analise-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AnexosEditorComponent],
  templateUrl: './vibracao-analise-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VibracaoAnaliseFormComponent implements OnInit {
  readonly modos = MODOS_FALHA;
  readonly situacoes = SITUACOES;
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly situacaoDescricao = SITUACAO_DESCRICAO;
  readonly alarmeLabel = ALARME_LABEL;
  readonly alarmeBadge = ALARME_BADGE;
  readonly grandezaLabel = GRANDEZA_LABEL;
  readonly fmt = formatarValor;
  readonly pct = formatarPct;
  readonly dataBr = dataBr;

  id: string | null = null;
  numeroAtual = signal('');
  carregando = signal(true);
  erroFatal = signal('');

  equipamentos = this.service.equipamentos;
  equipamentoId = signal('');
  equipamento = signal<EquipamentoVibracao | null>(null);
  carregandoPontos = signal(false);
  // Último valor de cada ponto antes desta coleta: pontoId → { valor, data }.
  anteriores = signal(new Map<string, { valor: number; data: string }>());

  dataColeta = signal(hojeIso());
  tipoInspecao = signal<TipoInspecao>('programada');
  osNumero = signal('');
  gestorArea = signal('');
  rotacaoRpm = signal('');
  condicaoOperacao = signal('');
  instrumento = signal(COLETOR_PADRAO);
  sensor = signal(SENSOR_PADRAO);
  instrumentoSerie = signal('');
  calibracaoValidade = signal('');
  // Coletor do inspetor: preenchido uma vez (mecanica_coletores). Com cadastro, a tela só
  // mostra o resumo; "Alterar" abre os campos (ex.: calibração renovada).
  coletorCadastrado = signal(false);
  editandoColetor = signal(false);
  leituras = signal<LeituraForm[]>([]);
  modosFalha = signal<string[]>([]);
  diagnostico = signal('');
  recomendacao = signal('');
  conclusao = signal('');
  prazo = signal('');
  observacoes = signal('');
  anexos = signal<AnexoForm[]>([]);
  // Status escolhido. '' = ainda segue a sugestão do portal.
  statusEscolhido = signal<Situacao | ''>('');

  isSubmitting = signal(false);
  errorMessage = signal('');

  private lidas = computed<LeituraVibracao[]>(() => this.leituras().map(l => ({
    pontoId: l.pontoId, ponto: l.ponto, grandeza: l.grandeza, unidade: l.unidade, valor: lerNumero(l.valor),
    alarmeAlerta: l.alarmeAlerta, alarmePerigo: l.alarmePerigo, fatorCrista: lerNumero(l.fatorCrista), curtose: lerNumero(l.curtose),
    frequenciaHz: lerNumero(l.frequenciaHz), observacao: l.observacao,
  })));

  // Avaliação por linha (na mesma ordem de leituras()).
  avaliacao = computed(() => {
    const e = this.equipamento();
    const rpm = lerNumero(this.rotacaoRpm());
    const ant = this.anteriores();
    return this.lidas().map((l, i) => {
      const anterior = l.pontoId ? ant.get(l.pontoId) ?? null : null;
      return {
        alarme: alarmeDaLeitura(l),
        zona: zonaDaLeitura(l, e?.grupoIso ?? null, e?.fundacao ?? null),
        alteracao: alteracaoPct(l.valor, anterior?.valor ?? null),
        tendencia: avisoTendencia(l.valor, anterior?.valor ?? null, l.grandeza),
        anterior,
        frequencia: identificarFrequencia(l.frequenciaHz, rpm, this.leituras()[i].fatores),
      };
    });
  });

  sugestao = computed(() => {
    const e = this.equipamento();
    return statusSugerido(this.lidas().filter(l => l.valor !== null), e?.grupoIso ?? null, e?.fundacao ?? null);
  });
  status = computed<Situacao | null>(() => this.statusEscolhido() || this.sugestao().situacao);
  preenchidas = computed(() => this.lidas().filter(l => l.valor !== null).length);

  avisos = computed(() => this.avaliacao().flatMap((a, i) => (a.tendencia ? [`${this.leituras()[i].ponto}: ${a.tendencia}`] : [])));

  constructor(
    private service: MecanicaVibracaoService,
    private notificationService: NotificationService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id');
    const eq = route.snapshot.queryParamMap.get('equipamento');
    if (eq) this.equipamentoId.set(eq);
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!this.service.podeLancar()) { this.erroFatal.set('Só o inspetor de vibração (ou Admin) lança análises. Peça ao Admin para ligar a opção no seu usuário.'); return; }
      if (!this.equipamentos().length) await this.service.load();
      if (this.id) {
        const a = await this.service.buscarAnalise(this.id);
        if (!a) { this.erroFatal.set('Análise não encontrada.'); return; }
        if (!this.service.podeCorrigir(a)) { this.erroFatal.set('Só quem lançou (ou Admin) pode corrigir.'); return; }
        await this.preencher(a);
      } else {
        await this.carregarMeuColetor();
        if (this.equipamentoId()) await this.escolherEquipamento(this.equipamentoId());
      }
    } catch (err: unknown) {
      this.erroFatal.set(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      this.carregando.set(false);
    }
  }

  // Coletor salvo do inspetor; sem cadastro, os campos abrem pra ele preencher a primeira vez.
  private async carregarMeuColetor(): Promise<void> {
    const c = await this.service.meuColetor();
    if (!c) {
      this.coletorCadastrado.set(false);
      this.editandoColetor.set(true);
      return;
    }
    this.aplicarColetor(c);
    this.coletorCadastrado.set(true);
    this.editandoColetor.set(false);
  }

  private aplicarColetor(c: ColetorInspetor): void {
    this.instrumento.set(c.coletor);
    this.sensor.set(c.sensor ?? '');
    this.instrumentoSerie.set(c.numeroSerie ?? '');
    this.calibracaoValidade.set(c.calibracaoValidade ?? '');
  }

  calibracaoVencida = computed(() => !!this.calibracaoValidade() && this.calibracaoValidade() < this.dataColeta());

  // Anterior = última coleta antes desta (por data; a própria análise fica de fora na correção).
  private calcularAnteriores(analises: AnaliseVibracao[], data: string): Map<string, { valor: number; data: string }> {
    const mapa = new Map<string, { valor: number; data: string }>();
    for (const a of analises) {
      if (a.id === this.id || a.dataColeta > data) continue;
      for (const l of a.leituras) if (l.pontoId && l.valor !== null) mapa.set(l.pontoId, { valor: l.valor, data: a.dataColeta });
    }
    return mapa;
  }

  private analisesDoEquip: AnaliseVibracao[] = [];

  async escolherEquipamento(id: string): Promise<void> {
    this.equipamentoId.set(id);
    this.carregandoPontos.set(true);
    try {
      const [e, pontos, analises] = await Promise.all([
        this.service.buscarEquipamento(id), this.service.pontosDo(id), this.service.analisesDo(id),
      ]);
      this.equipamento.set(e);
      this.analisesDoEquip = analises;
      this.rotacaoRpm.set(txt(e?.rotacaoRpm, 1));
      this.leituras.set(pontos.map(linhaDoPonto));
      this.anteriores.set(this.calcularAnteriores(analises, this.dataColeta()));
      // Gestor costuma ser o mesmo da última análise do equipamento.
      const ultimoGestor = [...analises].reverse().find(a => a.gestorArea)?.gestorArea;
      if (ultimoGestor && !this.gestorArea()) this.gestorArea.set(ultimoGestor);
    } finally {
      this.carregandoPontos.set(false);
    }
  }

  // Correção: as leituras gravadas (com os alarmes daquele dia) + pontos ativos novos.
  private async preencher(a: AnaliseVibracao): Promise<void> {
    this.numeroAtual.set(numeroAnalise(a.numero));
    this.equipamentoId.set(a.equipamentoId);
    const [e, pontos, analises] = await Promise.all([
      this.service.buscarEquipamento(a.equipamentoId), this.service.pontosDo(a.equipamentoId, true), this.service.analisesDo(a.equipamentoId),
    ]);
    this.equipamento.set(e);
    this.analisesDoEquip = analises;
    const porId = new Map(pontos.map(p => [p.id, p]));
    const linhas: LeituraForm[] = a.leituras.map(l => ({
      pontoId: l.pontoId, ponto: l.ponto, grandeza: l.grandeza, unidade: l.unidade, alarmeAlerta: l.alarmeAlerta, alarmePerigo: l.alarmePerigo,
      fatores: (l.pontoId && porId.get(l.pontoId)?.fatores) || SEM_FATORES,
      valor: txt(l.valor), fatorCrista: txt(l.fatorCrista), curtose: txt(l.curtose), frequenciaHz: txt(l.frequenciaHz, 2),
      observacao: l.observacao ?? '', aberto: l.fatorCrista !== null || l.curtose !== null || l.frequenciaHz !== null || !!l.observacao,
    }));
    const lidos = new Set(a.leituras.map(l => l.pontoId));
    pontos.filter(p => p.ativo && !lidos.has(p.id)).forEach(p => linhas.push(linhaDoPonto(p)));
    this.leituras.set(linhas);
    this.dataColeta.set(a.dataColeta);
    this.tipoInspecao.set(a.tipoInspecao);
    this.osNumero.set(a.osNumero ?? '');
    this.gestorArea.set(a.gestorArea ?? '');
    this.rotacaoRpm.set(txt(a.rotacaoRpm, 1));
    this.condicaoOperacao.set(a.condicaoOperacao ?? '');
    this.instrumento.set(a.instrumento ?? '');
    this.sensor.set(a.sensor ?? '');
    this.instrumentoSerie.set(a.instrumentoSerie ?? '');
    this.calibracaoValidade.set(a.calibracaoValidade ?? '');
    this.modosFalha.set([...a.modosFalha]);
    this.diagnostico.set(a.diagnostico ?? '');
    this.recomendacao.set(a.recomendacao ?? '');
    this.conclusao.set(a.conclusao ?? '');
    this.prazo.set(a.prazo ?? '');
    this.observacoes.set(a.observacoes ?? '');
    this.anexos.set(a.anexos.map(anexoParaForm));
    this.anteriores.set(this.calcularAnteriores(analises, a.dataColeta));
    // Na correção o status gravado fica fixo (só muda se o inspetor trocar).
    this.statusEscolhido.set(a.situacao);
  }

  mudarData(data: string): void {
    this.dataColeta.set(data);
    this.anteriores.set(this.calcularAnteriores(this.analisesDoEquip, data));
  }

  atualizarLeitura(i: number, campo: keyof LeituraForm, valor: string | boolean): void {
    this.leituras.update(l => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  alternarModo(modo: string): void {
    this.modosFalha.update(l => (l.includes(modo) ? l.filter(m => m !== modo) : [...l, modo]));
  }

  // Frequência identificada: marca o modo de falha correspondente.
  usarFrequencia(rotulo: string): void {
    const codigo = rotulo.replace(/^\d× /, '');
    const modo = this.modos.find(m => m.includes(`(${codigo})`))
      ?? (codigo === '1X' ? 'Desbalanceamento' : codigo === '2X' ? 'Desalinhamento' : null);
    if (modo && !this.modosFalha().includes(modo)) this.modosFalha.update(l => [...l, modo]);
  }

  usarConclusaoPadrao(): void {
    this.conclusao.set(CONCLUSAO_PADRAO);
  }

  invalido(valor: string): boolean {
    return !!valor.trim() && lerNumero(valor) === null;
  }

  async onSubmit(): Promise<void> {
    const brutos = [this.rotacaoRpm(), ...this.leituras().flatMap(l => [l.valor, l.fatorCrista, l.curtose, l.frequenciaHz])];
    if (brutos.some(b => this.invalido(b))) {
      this.errorMessage.set('Há valores inválidos. Use só números (ex.: 1,412).');
      return;
    }
    const equip = this.equipamento();
    if (!equip || !this.dataColeta()) {
      this.errorMessage.set('Escolha o equipamento e a data da medição.');
      return;
    }
    if (!this.preenchidas()) {
      this.errorMessage.set('Informe o valor de pelo menos um ponto.');
      return;
    }
    const status = this.status();
    if (!status) {
      this.errorMessage.set('Escolha o status (A, B, C ou D).');
      return;
    }
    if (!this.instrumento().trim()) {
      this.errorMessage.set('Informe o coletor (fica salvo para as próximas análises).');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      // Lançamento novo com o coletor aberto: grava no cadastro do inspetor (próximas análises
      // já vêm com ele). Na correção, só a cópia desta análise muda.
      if (!this.id && this.editandoColetor()) {
        await this.service.salvarMeuColetor({
          coletor: this.instrumento(), sensor: this.sensor(), numeroSerie: this.instrumentoSerie(), calibracaoValidade: this.calibracaoValidade() || null,
        });
        this.coletorCadastrado.set(true);
        this.editandoColetor.set(false);
      }
      const anexos = await this.service.subirAnexos(this.anexos());
      const { id, numero } = await this.service.salvarAnalise({
        equipamentoId: this.equipamentoId(),
        dataColeta: this.dataColeta(),
        tipoInspecao: this.tipoInspecao(),
        osNumero: this.osNumero(),
        gestorArea: this.gestorArea(),
        rotacaoRpm: lerNumero(this.rotacaoRpm()),
        condicaoOperacao: this.condicaoOperacao(),
        instrumento: this.instrumento(),
        sensor: this.sensor(),
        instrumentoSerie: this.instrumentoSerie(),
        calibracaoValidade: this.calibracaoValidade() || null,
        leituras: this.lidas(),
        modosFalha: this.modosFalha(),
        diagnostico: this.diagnostico(),
        recomendacao: this.recomendacao(),
        conclusao: this.conclusao(),
        prazo: this.prazo() || null,
        situacao: status,
        anexos,
        observacoes: this.observacoes(),
      }, equip, this.id ?? undefined);
      this.notificationService.showSuccess(`Análise ${numeroAnalise(numero)} ${this.id ? 'corrigida' : 'registrada'}: status ${SITUACAO_LABEL[status]}.`);
      await this.router.navigate(['/mecanica/vibracao/analises', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar a análise.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
