import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, WritableSignal, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { ManutencaoIndicadoresHistoricoService } from '../../../services/manutencao-indicadores-historico.service';
import { CategoriaIndicador, ConsultaSigmaResultado, ImportarIndicadorHistoricoItem, ManutencaoOrdem } from '../../../models/manutencao-programacao.model';
import {
  CATEGORIAS_INDICADOR, CATEGORIA_LABEL, ContagemExecucao, IndicadorArea, IndicadoresSemana, META_ATENDIMENTO, META_CUMPRIMENTO,
  StatusGeralSemana, calcularIndicadoresSemana,
} from '../../../utils/manutencao-indicadores';
import { LinhaTempoGeometria, PontoLinhaTempo, calcularLinhaTempo, linhaRetaAreaPath, linhaRetaPath } from '../../../utils/relatorio-linha-tempo';
import { AREAS_LINHA_TEMPO_SEPARADA, extrairHistoricoContagens, extrairHistoricoContagensPorArea } from '../../../utils/relatorio-semanal-pcm';
import { HhEquipamento, KpiExecucao, calcularHhTecnico, calcularKpiExecucao, hhPorEquipamento, ordemExecutadaAgrupada } from '../../../utils/manutencao-dashboard';
import { encontrarFeriasNoIntervalo } from '../../../utils/manutencao-regras';

// Nomes de área do relatório PCM antigo -> categoria desta tela (mesmo recorte de 5,
// já sem "Lubrificação" — dentro de Mecânica — nem "Operação" separada de "Limp
// Operacional", conforme decidido com o usuário).
const AREA_PCM_PARA_CATEGORIA: Record<string, CategoriaIndicador> = {
  'MECÂNICA': 'MECANICA',
  'ELÉTRICA': 'ELETRICA',
  'LIMP OPERACIONAL': 'LIMP_OPERACIONAL',
  'REFRIGERAÇÃO': 'REFRIGERACAO',
  'SPCI': 'SPCI',
};

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

// Ícones de linha simples (viewBox 24x24, stroke=currentColor) pros cards de KPI — um
// <path> por ícone, com vários subcaminhos "M..." quando precisa de mais de um traço.
const ICONES: Record<string, string> = {
  check: 'M12 3a9 9 0 100 18 9 9 0 000-18z M8 12.3l2.5 2.5L16 9.3',
  calendario: 'M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z M4 9.5h16 M8 4v3 M16 4v3 M9.3 14.8l1.7 1.7 3.7-3.9',
  lista: 'M8 6.5h11 M8 12h11 M8 17.5h11 M4 6.5h.01 M4 12h.01 M4 17.5h.01',
  alerta: 'M12 3.5l8.5 15H3.5z M12 9.5v4 M12 16.7v.1',
  prancheta: 'M9 3.5h6a1 1 0 011 1v1h1a1 1 0 011 1v13.5a1 1 0 01-1 1H7a1 1 0 01-1-1V6.5a1 1 0 011-1h1v-1a1 1 0 011-1z M9 11h6 M9 14.6h6',
  raio: 'M13 2L4.5 14h5.5l-1 8 8.5-12H12z',
  escudo: 'M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z M9 12l2 2 4-4',
  cruz: 'M12 4.5v15 M4.5 12h15',
  lua: 'M20 14.7A8 8 0 119.3 4 6.4 6.4 0 0020 14.7z',
  relogio: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7.5v5l3.5 2',
  relogioX: 'M12 21a9 9 0 100-18 9 9 0 000 18z M9.5 9.5l5 5 M14.5 9.5l-5 5',
  bandeira: 'M5 21V4 M5 5h13l-2.5 3.2L18 11.5H5',
};

interface CardIndicador {
  titulo: string;
  valor: string;
  meta?: string;
  cor: 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'red';
  icone: string;
}

// Mesmos helpers de semana do Dashboard da Programação (manutencao-dashboard.component.ts)
// — não extraídos pra util compartilhado porque cada tela hoje mantém a própria cópia
// (mesmo padrão já existente entre Dashboard/Programação).
function segundaFeiraDe(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return date;
}

function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatarDiaMes(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function diasDaSemana(segundaIso: string): { data: string; label: string }[] {
  const [ano, mes, dia] = segundaIso.split('-').map(Number);
  return DIAS_SEMANA_LABEL.map((label, i) => {
    const d = new Date(ano, mes - 1, dia + i);
    return { data: paraIso(d), label };
  });
}

function normalizarTexto(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Reaproveita o mesmo intervalo do proxy do SIGMA (cache de 10min no servidor, ver
// api/_sigma-shared.js) — poll mais frequente que isso não traria dado mais novo, só
// gastaria requisição à toa; 3min dá uma sensação de "ao vivo" sem exagerar.
const INTERVALO_POLL_MS = 3 * 60 * 1000;

@Component({
  selector: 'app-manutencao-indicadores-semanais',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-indicadores-semanais.component.html',
  styleUrl: './manutencao-indicadores-semanais.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoIndicadoresSemanaisComponent implements OnInit, OnDestroy {
  readonly categoriaLabel = CATEGORIA_LABEL;
  readonly metaAtendimento = META_ATENDIMENTO;
  readonly metaCumprimento = META_CUMPRIMENTO;
  readonly icones = ICONES;
  errorMessage = signal('');
  private pollId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private apontamentosService: ApontamentosService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private historicoService: ManutencaoIndicadoresHistoricoService,
  ) {
    // Refaz a consulta ao SIGMA sempre que a lista de OS (todo o histórico, não só a
    // semana selecionada — precisa pra Evolução ao Longo do Ano e pro Consolidado do
    // Ano) mudar.
    effect(() => {
      const numeros = this.numerosOsVisiveis();
      if (numeros.length === 0) return;
      this.buscarExecucaoSigma(numeros);
    });

    // Contador animado (0 -> valor) só nos dois números mais destacados da tela — dá a
    // sensação de "preencher" ao abrir/trocar de semana, sem animar todo número da
    // tabela (ficaria cansativo). Reage de novo sempre que o valor real mudar (troca de
    // semana, SIGMA respondendo).
    effect(() => this.animarContador(this.indicadores().geral.atendimento, this.atendimentoAnimado));
    effect(() => this.animarContador(this.indicadores().cumprimentoPlano.atendimento, this.cumprimentoAnimado));
  }

  atendimentoAnimado = signal(0);
  cumprimentoAnimado = signal(0);

  private animarContador(alvo: number, destino: WritableSignal<number>): void {
    const inicio = destino();
    if (Math.abs(inicio - alvo) < 0.05) { destino.set(alvo); return; }
    const duracaoMs = 900;
    const t0 = performance.now();
    const passo = (agora: number) => {
      const progresso = Math.min(1, (agora - t0) / duracaoMs);
      const suavizado = 1 - Math.pow(1 - progresso, 3); // ease-out cúbico
      destino.set(Math.round((inicio + (alvo - inicio) * suavizado) * 10) / 10);
      if (progresso < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  private matchColaborador = (matricula: string | null, nome: string) =>
    this.apontamentosService.matchColaboradorDaOrdem(matricula, nome);

  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  async ngOnInit(): Promise<void> {
    try {
      await this.manutencaoService.load();
      await this.apontamentosService.loadColaboradores();
      await this.manutencaoService.loadFerias();
      await this.historicoService.load();
    } catch {
      this.errorMessage.set('Erro ao carregar os indicadores da semana.');
    }
    // "Ao vivo": reconsulta o SIGMA sozinho a cada poucos minutos, sem precisar
    // recarregar a página — os computed() já recalculam sozinhos quando sigmaPorOs muda.
    this.pollId = setInterval(() => this.atualizar(), INTERVALO_POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.pollId !== null) clearInterval(this.pollId);
  }

  // ── Semana ISO — mesma faixa/formato do Dashboard da Programação ──
  private numeroSemanaISO(dataIso: string): number {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const diaDaSemana = (data.getUTCDay() + 6) % 7;
    data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
    const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
    const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
    return 1 + Math.round(diffDias / 7);
  }

  private segundaDaSemanaISO(ano: number, semana: number): Date {
    const referencia = new Date(ano, 0, 4);
    const diaDaSemana = (referencia.getDay() + 6) % 7;
    const segunda = new Date(ano, 0, 4 - diaDaSemana);
    segunda.setDate(segunda.getDate() + (semana - 1) * 7);
    return segunda;
  }

  readonly semanas = (() => {
    const result: { value: string; label: string }[] = [];
    const hojeSegunda = segundaFeiraDe(new Date());
    const inicioMinimoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    for (let i = -8; i < 5; i++) {
      const inicio = new Date(hojeSegunda);
      inicio.setDate(inicio.getDate() - i * 7);
      const inicioIso = paraIso(inicio);
      if (inicioIso < inicioMinimoIso) continue;
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 6);
      result.push({ value: inicioIso, label: `Semana ${this.numeroSemanaISO(inicioIso)} (${formatarDiaMes(inicio)} a ${formatarDiaMes(fim)})` });
    }
    return result;
  })();

  semanaFiltro = signal((() => {
    const hojeIso = paraIso(segundaFeiraDe(new Date()));
    const minimoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    return hojeIso < minimoIso ? minimoIso : hojeIso;
  })());

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));

  // Cabeçalho do relatório mostrava a data ISO crua (ex. "2026-09-14") — formata como
  // "SEMANA 38 · 14/09 a 20/09/2026", igual ao padrão já usado no dropdown de semana.
  semanaLabel = computed(() => {
    const semana = this.semanaFiltro();
    const dias = this.diasDaSemanaAtual();
    const inicio = dias[0]?.data ?? semana;
    const fim = dias[dias.length - 1]?.data ?? semana;
    const [anoFim] = fim.split('-');
    const fmt = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
    return `SEMANA ${this.numeroSemanaISO(semana)} · ${fmt(inicio)} a ${fmt(fim)}/${anoFim}`;
  });

  // Todas as ordens de verdade já carregadas (ManutencaoProgramacaoService.load() traz
  // o histórico inteiro, sem filtro de data) — ponto de partida tanto pra semana
  // selecionada quanto pra Evolução/Consolidado do Ano.
  private ordensTipo = computed(() => this.manutencaoService.ordens().filter(o => o.tipo === 'ordem'));

  private ordensDaSemana = computed(() =>
    this.ordensTipo().filter(o => o.semanaInicio === this.semanaFiltro()));

  // Só pro indicador (Atendimento à Programação / Cumprimento do Plano) — Apoio conta
  // só pras 3 equipes reais do indicador (Refrigeração/Limp Operacional/SPCI, ver
  // inferirCategoriaIndicadorPorTecnico). O resto do Apoio (empresas de
  // equipamento/andaime tipo TOP ANDAIMES, guindaste etc.) não faz parte do fechamento
  // desse indicador — não é "não classificado" esperando revisão, é fora da conta
  // mesmo, por decisão do usuário. categoriaIndicador nulo em Mecânica/Elétrica nunca
  // acontece (o service preenche sozinho), então esse filtro só afeta Apoio na prática.
  private ordensParaFechamento = computed(() =>
    this.ordensTipo().filter(o => o.area !== 'APOIO' || !!o.categoriaIndicador));

  // ── Execução via SIGMA (mesmo padrão do Dashboard) ──
  sigmaPorOs = signal<Record<string, ConsultaSigmaResultado>>({});
  sigmaAtualizando = signal(false);
  ultimaAtualizacaoEm = signal<Date | null>(null);

  // Todo o histórico, não só a semana selecionada — a Evolução ao Longo do Ano e o
  // Consolidado do Ano precisam da execução de toda semana já registrada. O proxy do
  // SIGMA já cacheia por 10min no servidor e o histórico hoje é limitado (desde a
  // S37/2026, quando a Programação nativa começou a ser usada) — se um dia isso
  // crescer muito, vale paginar por semana em vez de buscar tudo de uma vez.
  private numerosOsVisiveis = computed(() =>
    [...new Set(this.ordensTipo().map(o => o.numeroOs).filter((n): n is string => !!n?.trim()))],
  );

  atualizar(): void {
    const numeros = this.numerosOsVisiveis();
    if (numeros.length > 0) this.buscarExecucaoSigma(numeros);
  }

  private async buscarExecucaoSigma(numeros: string[]): Promise<void> {
    this.sigmaAtualizando.set(true);
    try {
      const acumulado: Record<string, ConsultaSigmaResultado> = {};
      for (let i = 0; i < numeros.length; i += 200) {
        const resultado = await this.manutencaoService.consultarOrdensSigma(numeros.slice(i, i + 200));
        Object.assign(acumulado, resultado);
      }
      this.sigmaPorOs.update(atual => ({ ...atual, ...acumulado }));
      this.ultimaAtualizacaoEm.set(new Date());
    } catch {
      // Consulta best-effort — falha do SIGMA não deve travar a tela.
    } finally {
      this.sigmaAtualizando.set(false);
    }
  }

  indicadores = computed<IndicadoresSemana>(() => calcularIndicadoresSemana({
    ordens: this.ordensParaFechamento().filter(o => o.semanaInicio === this.semanaFiltro()),
    sigmaPorOs: this.sigmaPorOs(),
    matchColaborador: this.matchColaborador,
  }));

  // ── Migrado do Dashboard da Programação (src/components/manutencao/
  // manutencao-dashboard/) — essa tela substitui o Dashboard, então essas métricas
  // (Corretivas/Preventivas, Exames/Folgas, HH) vêm pra cá antes dele ser removido.
  private ordemExecutadaAgrupadaLocal(ordens: ManutencaoOrdem[]): boolean[] {
    return ordemExecutadaAgrupada(ordens, this.sigmaPorOs(), this.matchColaborador);
  }

  kpiCorretivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordemExecutadaAgrupadaLocal(this.ordensDaSemana().filter(o => o.tipoServico?.trim().toUpperCase() === 'CORRETIVA')).map(executada => ({ executada }))));

  kpiPreventivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordemExecutadaAgrupadaLocal(this.ordensDaSemana().filter(o => o.tipoServico?.trim().toUpperCase() === 'PREVENTIVA')).map(executada => ({ executada }))));

  qtdExames = computed(() => this.manutencaoService.ordens().filter(o => o.semanaInicio === this.semanaFiltro() && o.tipo === 'exame_medico').length);
  qtdFolgas = computed(() => this.manutencaoService.ordens().filter(o => o.semanaInicio === this.semanaFiltro() && o.tipo === 'folga').length);

  private hhPorEquipamentoTodos = computed<HhEquipamento[]>(() => hhPorEquipamento(this.ordensDaSemana()));
  hhPorEquipamentoTop10 = computed(() => this.hhPorEquipamentoTodos().slice(0, 10));
  hhPorEquipamentoMax = computed(() => this.hhPorEquipamentoTop10()[0]?.horas ?? 0);

  // HH só faz sentido pra Elétrica/Mecânica (Apoio programa por equipe/empresa, sem
  // disponibilidade individual cadastrada) — soma as duas juntas, já que esta tela não
  // filtra por área como o Dashboard filtrava.
  private tecnicosParaHh = computed(() =>
    this.apontamentosService.colaboradores().filter(c => {
      const t = normalizarTexto(c.area);
      return t.includes('ELETR') || t.includes('MECAN');
    }));

  hhTotais = computed(() => {
    const dias = this.diasDaSemanaAtual();
    const ferias = this.manutencaoService.ferias();
    const ordensDaSemanaTodas = this.manutencaoService.ordens().filter(o => o.semanaInicio === this.semanaFiltro());
    let bruto = 0;
    let liquido = 0;
    for (const colaborador of this.tecnicosParaHh()) {
      const ordensDoTecnico = ordensDaSemanaTodas.filter(o => o.tecnicoNome === colaborador.nome);
      const r = calcularHhTecnico({
        dias,
        disponibilidadePorDia: new Map(dias.map(d => [d.data, this.apontamentosService.disponibilidadeNoDia(colaborador, d.data)])),
        diasFolga: new Set(ordensDoTecnico.filter(o => o.tipo === 'folga').flatMap(o => o.diasPrevistos)),
        diasExameMedico: new Set(ordensDoTecnico.filter(o => o.tipo === 'exame_medico').flatMap(o => o.diasPrevistos)),
        feriasIntervalo: encontrarFeriasNoIntervalo(ferias, colaborador.nome, dias.map(d => d.data)),
      });
      bruto += r.bruto;
      liquido += r.liquido;
    }
    return {
      disponivel: Math.round(liquido * 100) / 100,
      indisponivel: Math.round((bruto - liquido) * 100) / 100,
    };
  });

  imprimir(): void {
    window.print();
  }

  // ── Cards dos KPIs, dirigidos por config (em vez de bloco repetido por card no
  // template) — cada seção vira um @for só, mais fácil de manter e de adicionar ícone. ──
  cardsResumoExecutivo = computed<CardIndicador[]>(() => {
    const ind = this.indicadores();
    return [
      { titulo: 'Atendimento à Programação', valor: `${this.atendimentoAnimado()}%`, meta: `Meta: ${this.metaAtendimento}%`, cor: 'green', icone: 'check' },
      { titulo: 'Cumprimento do Plano', valor: `${this.cumprimentoAnimado()}%`, meta: `Meta: ${this.metaCumprimento}%`, cor: 'blue', icone: 'calendario' },
      { titulo: "OS's Executadas", valor: `${ind.geral.executadas}/${ind.geral.programadas}`, cor: 'purple', icone: 'lista' },
      { titulo: "OS's Não Executadas", valor: `${ind.geral.naoExecutadas}`, cor: 'orange', icone: 'alerta' },
      { titulo: "OS's Planejadas Plano", valor: `${ind.cumprimentoPlano.programadas}`, meta: `${ind.cumprimentoPlano.executadas} executadas do plano`, cor: 'teal', icone: 'prancheta' },
    ];
  });

  cardsCorretivasPreventivas = computed<CardIndicador[]>(() => [
    { titulo: 'Corretivas', valor: `${this.kpiCorretivas().percentual}%`, meta: `${this.kpiCorretivas().executadas} de ${this.kpiCorretivas().programadas} executadas`, cor: 'purple', icone: 'raio' },
    { titulo: 'Preventivas', valor: `${this.kpiPreventivas().percentual}%`, meta: `${this.kpiPreventivas().executadas} de ${this.kpiPreventivas().programadas} executadas`, cor: 'teal', icone: 'escudo' },
    { titulo: 'Exames Médicos', valor: `${this.qtdExames()}`, cor: 'orange', icone: 'cruz' },
    { titulo: 'Folgas', valor: `${this.qtdFolgas()}`, cor: 'orange', icone: 'lua' },
    { titulo: 'HH Disponível', valor: `${this.hhTotais().disponivel}h`, cor: 'green', icone: 'relogio' },
    { titulo: 'HH Indisponível', valor: `${this.hhTotais().indisponivel}h`, cor: 'red', icone: 'relogioX' },
  ]);

  cardsConsolidadoAno = computed<CardIndicador[]>(() => {
    const ano = this.consolidadoAno();
    return [
      { titulo: 'Atendimento à Programação', valor: `${ano.geral.atendimento}%`, meta: `${ano.geral.executadas} de ${ano.geral.programadas} executadas no ano`, cor: 'green', icone: 'check' },
      { titulo: 'Cumprimento do Plano', valor: `${ano.cumprimentoPlano.atendimento}%`, meta: `${ano.cumprimentoPlano.executadas} de ${ano.cumprimentoPlano.programadas} planejadas do Plano`, cor: 'blue', icone: 'calendario' },
      { titulo: 'Status Geral do Ano', valor: ano.statusGeral, cor: 'teal', icone: 'bandeira' },
    ];
  });

  // ── Evolução ao Longo do Ano + Consolidado do Ano ──────────────────────

  // Toda semana desde a S37/2026 (início do uso nativo da Programação) até a semana
  // corrente, em ordem cronológica — sem limite de janela (diferente do dropdown
  // "semanas" acima, que só mostra um recorte curto pra escolher pontualmente).
  private semanasHistoricoIso = computed(() => {
    const hojeIso = paraIso(segundaFeiraDe(new Date()));
    const minimoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    const fimIso = hojeIso < minimoIso ? minimoIso : hojeIso; // nunca antes do início do sistema
    const resultado: string[] = [];
    let cursor = new Date(minimoIso + 'T00:00:00');
    const fim = new Date(fimIso + 'T00:00:00');
    while (cursor <= fim) {
      resultado.push(paraIso(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return resultado;
  });

  private indicadoresPorSemana = computed(() => {
    const sigmaPorOs = this.sigmaPorOs();
    const ordensTipo = this.ordensParaFechamento();
    return this.semanasHistoricoIso().map(semana => ({
      semana,
      indicadores: calcularIndicadoresSemana({
        ordens: ordensTipo.filter(o => o.semanaInicio === semana),
        sigmaPorOs,
        matchColaborador: this.matchColaborador,
      }),
    }));
  });

  // Combina o histórico importado (semanas de ANTES da S37/2026 — só tem % agregado,
  // vindo da planilha, ver ManutencaoIndicadoresHistoricoService) com o cálculo ao vivo
  // (semanas com ordens reais no Portal). Ignora qualquer item do histórico com
  // semanaInicio >= início do uso nativo (S37/2026) — a planilha às vezes já vem com
  // coluna pra semanas futuras preenchida (planejamento adiantado, "programadas" > 0
  // mas "executadas" 0 porque a semana ainda nem chegou), e como o cálculo ao vivo só
  // cobre até "hoje" (ver semanasHistoricoIso), um item desses nunca seria sobrescrito
  // e sobrava plantado como se fosse o "ponto atual" com 0% — sempre errado e nunca
  // atualizava, já que aquela semana futura não existe de verdade no Portal ainda.
  private pontosEvolucaoGeral = computed<{ semana: string; atendimento: number; cumprimento: number }[]>(() => {
    const inicioAoVivoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    const mapa = new Map<string, { atendimento: number; cumprimento: number }>();
    for (const item of this.historicoService.itens()) {
      if (item.categoria === 'GERAL' && item.semanaInicio < inicioAoVivoIso) mapa.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      mapa.set(semana, { atendimento: indicadores.geral.atendimento, cumprimento: indicadores.cumprimentoPlano.atendimento });
    }
    // Garante que a semana selecionada no filtro bate com o mesmo número que os cards/
    // tabela mostram (fonte única: indicadores()) — não confia em indicadoresPorSemana
    // ter exatamente essa mesma semana calculada igual, sempre escreve por cima.
    const ind = this.indicadores();
    mapa.set(this.semanaFiltro(), { atendimento: ind.geral.atendimento, cumprimento: ind.cumprimentoPlano.atendimento });
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, v]) => ({ semana, ...v }));
  });

  private pontosEvolucaoPorArea = computed<Map<CategoriaIndicador, Map<string, { atendimento: number; cumprimento: number }>>>(() => {
    const inicioAoVivoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    const resultado = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, { atendimento: number; cumprimento: number }>()]));
    for (const item of this.historicoService.itens()) {
      if (item.categoria !== 'GERAL' && item.semanaInicio < inicioAoVivoIso) resultado.get(item.categoria)?.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      for (const area of indicadores.porArea) {
        if (!area.categoria) continue;
        resultado.get(area.categoria)?.set(semana, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
      }
    }
    // Mesma garantia de pontosEvolucaoGeral: a semana selecionada bate com o mesmo
    // número que a tabela "Desempenho por Área" mostra (fonte única: indicadores()).
    const semanaFiltro = this.semanaFiltro();
    for (const area of this.indicadores().porArea) {
      if (!area.categoria) continue;
      resultado.get(area.categoria)?.set(semanaFiltro, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
    }
    return resultado;
  });

  // Geometria SVG (mesmo util do Relatório Semanal/Mensal PCM,
  // src/utils/relatorio-linha-tempo.ts — só troca a fonte dos pontos: em vez de ler
  // célula de planilha, vem do histórico importado + cálculo ao vivo acima). Enriquece
  // com path em <path> (segmento reto entre pontos, igual sempre foi — só não é mais
  // <polyline> porque a animação de "desenhar a linha" via pathLength/stroke-dashoffset
  // precisa de <path>) + área de preenchimento sob a linha de Atendimento — só essa,
  // pra não empilhar duas áreas semitransparentes uma sobre a outra quando as duas
  // séries andam coladas (visual mais limpo).
  private enriquecerGeometria(geo: LinhaTempoGeometria | null, pontos: PontoLinhaTempo[]) {
    if (!geo) return null;
    const baseY = geo.altura - geo.margem.baixo;
    const ultimo = pontos[pontos.length - 1];
    return {
      ...geo,
      pathAtendimento: linhaRetaPath(geo.pontosAtendimento),
      pathCumprimento: linhaRetaPath(geo.pontosCumprimento),
      areaAtendimento: linhaRetaAreaPath(geo.pontosAtendimento, baseY),
      // Valor do ponto atual (última semana), pra rotular o destaque no fim da linha —
      // a geometria só tem coordenada SVG (x/y), não o valor original em %.
      ultimoAtendimento: ultimo ? Math.round(ultimo.atendimento) : null,
      ultimoCumprimento: ultimo ? Math.round(ultimo.cumprimento) : null,
    };
  }

  linhaTempoGeral = computed(() => {
    const pontos = this.pontosEvolucaoGeral().map(p => ({ label: `S${this.numeroSemanaISO(p.semana)}`, atendimento: p.atendimento, cumprimento: p.cumprimento }));
    return this.enriquecerGeometria(calcularLinhaTempo(pontos), pontos);
  });

  linhaTempoPorArea = computed(() => CATEGORIAS_INDICADOR.map(categoria => {
    const pontos = [...(this.pontosEvolucaoPorArea().get(categoria) ?? new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, v]): PontoLinhaTempo => ({ label: `S${this.numeroSemanaISO(semana)}`, atendimento: v.atendimento, cumprimento: v.cumprimento }));
    return { categoria, label: CATEGORIA_LABEL[categoria], geometria: this.enriquecerGeometria(calcularLinhaTempo(pontos), pontos) };
  }));

  private somarContagem(a: ContagemExecucao, b: ContagemExecucao): ContagemExecucao {
    const programadas = a.programadas + b.programadas;
    const executadas = a.executadas + b.executadas;
    return {
      programadas, executadas, naoExecutadas: programadas - executadas,
      atendimento: programadas > 0 ? Math.round((executadas / programadas) * 10000) / 100 : 0,
    };
  }

  // Soma todas as semanas do ano corrente (não o histórico inteiro, que pode cruzar
  // virada de ano), pra bater com o total anual da planilha antiga. Duas fontes, sem
  // sobreposição na prática (semanasHistoricoIso só começa na S37/2026, quando a
  // Programação nativa passou a existir):
  // - Semanas ao vivo (S37/2026 em diante): recalcula a partir das ordens reais, igual
  //   sempre foi (reaproveita calcularIndicadoresSemana direto).
  // - Semanas de antes disso: não têm ordem real no Portal, só o que foi importado da
  //   planilha (ver "Importar histórico") — soma direto as contagens brutas gravadas na
  //   importação. Antes, essas semanas ficavam de fora inteiramente (só tinha % agregado
  //   guardado, sem contagem por trás pra somar), o que deixava o Consolidado do Ano bem
  //   abaixo do valor real da planilha.
  consolidadoAno = computed<IndicadoresSemana>(() => {
    const anoAtual = new Date().getFullYear();
    const semanasAoVivoDoAno = new Set(this.semanasHistoricoIso().filter(s => Number(s.slice(0, 4)) === anoAtual));

    const aoVivo = calcularIndicadoresSemana({
      ordens: this.ordensParaFechamento().filter(o => semanasAoVivoDoAno.has(o.semanaInicio)),
      sigmaPorOs: this.sigmaPorOs(),
      matchColaborador: this.matchColaborador,
    });

    // Só semanas de ANTES do início do uso ao vivo (S37/2026) — não basta checar "fora
    // de semanasAoVivoDoAno", porque isso deixaria passar um item do histórico pra uma
    // semana FUTURA (além de "hoje"): a planilha às vezes já vem com a coluna de
    // semanas futuras preenchida (planejamento adiantado, 0 executadas porque a semana
    // ainda nem chegou), e isso puxava o Consolidado do Ano pra baixo à toa (mesmo bug
    // do "ponto atual" preso em 0% na Evolução ao Longo do Ano, ver pontosEvolucaoGeral).
    const inicioAoVivoIso = paraIso(this.segundaDaSemanaISO(2026, 37));
    const historicoDoAno = this.historicoService.itens().filter(item =>
      Number(item.semanaInicio.slice(0, 4)) === anoAtual && item.semanaInicio < inicioAoVivoIso);

    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    const somarHistorico = (categoria: CategoriaIndicador | 'GERAL', plano: boolean) => historicoDoAno
      .filter(i => i.categoria === categoria)
      .reduce((acc, i) => this.somarContagem(acc, plano
        ? { programadas: i.planejadasPlano, executadas: i.executadasPlano, naoExecutadas: i.naoExecutadasPlano, atendimento: 0 }
        : { programadas: i.programadas, executadas: i.executadas, naoExecutadas: i.naoExecutadas, atendimento: 0 }), zero);

    const geral = this.somarContagem(aoVivo.geral, somarHistorico('GERAL', false));
    const cumprimentoPlano = this.somarContagem(aoVivo.cumprimentoPlano, somarHistorico('GERAL', true));

    const porArea: IndicadorArea[] = CATEGORIAS_INDICADOR
      .map((categoria): IndicadorArea => {
        const areaAoVivo = aoVivo.porArea.find(a => a.categoria === categoria);
        return {
          categoria,
          ...this.somarContagem(areaAoVivo ?? zero, somarHistorico(categoria, false)),
          cumprimentoPlano: this.somarContagem(areaAoVivo?.cumprimentoPlano ?? zero, somarHistorico(categoria, true)),
        };
      })
      .filter(a => a.programadas > 0);

    let statusGeral: StatusGeralSemana;
    if (geral.atendimento >= META_ATENDIMENTO && cumprimentoPlano.atendimento >= META_CUMPRIMENTO) statusGeral = 'Dentro da Meta';
    else if (geral.atendimento >= META_ATENDIMENTO * 0.9 || cumprimentoPlano.atendimento >= META_CUMPRIMENTO * 0.9) statusGeral = 'Próximo da Meta';
    else statusGeral = 'Abaixo da Meta';

    return { geral, cumprimentoPlano, porArea, statusGeral };
  });

  // Mesmas cores do badge "STATUS GERAL" do Relatório Semanal/Mensal PCM
  // (relatorio-semanal-pcm.component.ts, STATUS_COR) — usado via [style.background-color].
  statusCor(status: IndicadoresSemana['statusGeral']): string {
    if (status === 'Dentro da Meta') return '#4CAF50';
    if (status === 'Próximo da Meta') return '#FF9800';
    return '#F44336';
  }

  // ── Importar histórico (planilha "Painel de Indicadores de PCM") ──────────
  // Cobre as semanas de ANTES da Programação nativa existir — o mesmo leitor de
  // planilha do Relatório Semanal PCM (extrairHistoricoSemanas/PorArea), mas em vez de
  // só desenhar na tela na hora, grava em manutencao_indicadores_historico pra ficar
  // disponível pra sempre (ver ManutencaoIndicadoresHistoricoService).
  importarAberto = signal(false);
  arquivoImportacao = signal<File | null>(null);
  anoImportacao = signal(new Date().getFullYear());
  importando = signal(false);

  onArquivoImportacaoSelecionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.arquivoImportacao.set(input.files?.[0] ?? null);
  }

  async confirmarImportarHistorico(): Promise<void> {
    const file = this.arquivoImportacao();
    if (!file) return;
    const ano = this.anoImportacao();
    if (!(await this.confirmDialogService.confirm(
      `Importar o histórico de indicadores de ${ano} dessa planilha? Semanas já importadas antes (mesmo ano/categoria) são atualizadas, não duplicadas.`,
    ))) return;

    this.importando.set(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'indicadores semanais') ?? wb.SheetNames[0];
      const ws = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!ws) throw new Error('Aba "Indicadores Semanais" não encontrada no arquivo.');
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];

      const paraSemanaInicio = (label: string) => paraIso(this.segundaDaSemanaISO(ano, Number(label.replace('S', ''))));
      const itens: ImportarIndicadorHistoricoItem[] = [];

      for (const ponto of extrairHistoricoContagens(rows, 53)) {
        itens.push({
          semanaInicio: paraSemanaInicio(ponto.label), categoria: 'GERAL',
          programadas: ponto.programadas, executadas: ponto.executadas, naoExecutadas: ponto.naoExecutadas,
          planejadasPlano: ponto.planejadasPlano, executadasPlano: ponto.executadasPlano, naoExecutadasPlano: ponto.naoExecutadasPlano,
          atendimento: ponto.atendimento, cumprimento: ponto.cumprimento,
        });
      }
      for (const areaPcm of AREAS_LINHA_TEMPO_SEPARADA) {
        const categoria = AREA_PCM_PARA_CATEGORIA[areaPcm];
        if (!categoria) continue;
        for (const ponto of extrairHistoricoContagensPorArea(rows, 53, areaPcm)) {
          itens.push({
            semanaInicio: paraSemanaInicio(ponto.label), categoria,
            programadas: ponto.programadas, executadas: ponto.executadas, naoExecutadas: ponto.naoExecutadas,
            planejadasPlano: ponto.planejadasPlano, executadasPlano: ponto.executadasPlano, naoExecutadasPlano: ponto.naoExecutadasPlano,
            atendimento: ponto.atendimento, cumprimento: ponto.cumprimento,
          });
        }
      }

      if (itens.length === 0) throw new Error('Nenhuma semana com dado encontrada nessa planilha.');

      await this.historicoService.importarLote(itens);
      this.notificationService.showSuccess(`Histórico importado: ${itens.length} pontos (${ano}).`);
      this.arquivoImportacao.set(null);
      this.importarAberto.set(false);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao importar o histórico.');
    } finally {
      this.importando.set(false);
    }
  }
}
