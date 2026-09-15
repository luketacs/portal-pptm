import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, WritableSignal, computed, effect, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { ApontamentosService, Colaborador } from '../../../services/apontamentos.service';
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
import { MESES_ABREV } from '../../../utils/relatorio-mensal-pcm';
import { HhAtividade, HhEquipamento, KpiExecucao, calcularHhTecnico, calcularKpiExecucao, hhPorAtividade, hhPorEquipamento, ordemExecutadaAgrupada } from '../../../utils/manutencao-dashboard';
import { encontrarFeriasNoIntervalo } from '../../../utils/manutencao-regras';
import {
  diasDaSemana, formatarDiaMes, formatarMesLabel, mesDaSemana, normalizarTexto, numeroSemanaISO,
  paraIso, segundaDaSemanaISO, segundaFeiraDe, semanasDoMes, somarContagem,
} from '../../../utils/manutencao-indicadores-periodo';
import { VisivelNaTelaDirective } from './visivel-na-tela.directive';

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

interface HorasTecnicoItem {
  colaborador: Colaborador;
  horasProgramadas: number;
  horasApontadas: number;
  horasDisponiveis: number;
  eficiencia: number;
}

// Helpers de data/período (segundaFeiraDe/diasDaSemana/mesDaSemana/semanasDoMes/etc.)
// vêm de utils/manutencao-indicadores-periodo.ts — compartilhados com o componente
// público (manutencao-indicadores-publico.component.ts), que precisa exatamente dos
// mesmos cálculos sem poder depender de nada Angular/Supabase.

// Reaproveita o mesmo intervalo do proxy do SIGMA (cache de 10min no servidor, ver
// api/_sigma-shared.js) — poll mais frequente que isso não traria dado mais novo, só
// gastaria requisição à toa; 3min dá uma sensação de "ao vivo" sem exagerar.
const INTERVALO_POLL_MS = 3 * 60 * 1000;

@Component({
  selector: 'app-manutencao-indicadores-semanais',
  standalone: true,
  imports: [CommonModule, FormsModule, VisivelNaTelaDirective],
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

  // Lido com untracked(): sem isso, o effect() que chama esta função (ver constructor)
  // passa a depender do próprio destino() que ELE mesmo escreve (via destino.set() no
  // rAF abaixo) — cada frame da animação reescreve o signal, o que reagenda o effect,
  // que reinicia a animação do zero a partir do ponto atual, pra sempre. Resultado
  // visível: em vez de uma transição suave, o número fica "andando de um em um"
  // (às vezes até parecendo diminuir), nunca convergindo de fato pro valor real.
  private animarContador(alvo: number, destino: WritableSignal<number>): void {
    const inicio = untracked(() => destino());
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

  // Ordens de um colaborador específico — casadas pela MATRÍCULA (via matchColaborador,
  // que prioriza tecnicoMatricula e só cai pro nome como fallback), nunca por
  // `o.tecnicoNome === colaborador.nome` direto. Mesmo motivo documentado em
  // chaveTecnico() da Programação (manutencao-programacao.component.ts): o texto de
  // tecnicoNome pode ter sido digitado com acento/typo diferente do cadastrado em
  // matriculas.json mesmo com a matrícula certa gravada — nome exato some ordens
  // inteiras da conta (reportado: Antônio Nivaldo aparecia com Programada/Apontada
  // zeradas numa semana em que ele tinha OS executadas de verdade).
  private ordensDoColaborador(ordens: ManutencaoOrdem[], colaborador: Colaborador): ManutencaoOrdem[] {
    return ordens.filter(o => this.matchColaborador(o.tecnicoMatricula, o.tecnicoNome)?.matricula === colaborador.matricula);
  }

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

  readonly semanas = (() => {
    const result: { value: string; label: string }[] = [];
    const hojeSegunda = segundaFeiraDe(new Date());
    const inicioMinimoIso = paraIso(segundaDaSemanaISO(2026, 37));
    for (let i = -8; i < 5; i++) {
      const inicio = new Date(hojeSegunda);
      inicio.setDate(inicio.getDate() - i * 7);
      const inicioIso = paraIso(inicio);
      if (inicioIso < inicioMinimoIso) continue;
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 6);
      result.push({ value: inicioIso, label: `Semana ${numeroSemanaISO(inicioIso)} (${formatarDiaMes(inicio)} a ${formatarDiaMes(fim)})` });
    }
    return result;
  })();

  semanaFiltro = signal((() => {
    const hojeIso = paraIso(segundaFeiraDe(new Date()));
    const minimoIso = paraIso(segundaDaSemanaISO(2026, 37));
    return hojeIso < minimoIso ? minimoIso : hojeIso;
  })());

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));

  // ── Toggle Semana / Mês — mesma tela, dois níveis de agregação. "Mês" reaproveita a
  // mesma calcularIndicadoresSemana (soma ordens de várias semanas do mês em vez de
  // uma semana só, ver semanasDoPeriodoSet abaixo) — não é uma tela nova. ──
  modoPeriodo = signal<'semana' | 'mes'>('semana');

  // Mesma ordem de `semanas` (mais futuro primeiro) — 2 meses à frente, 6 pra trás.
  readonly meses = (() => {
    const result: { value: string; label: string }[] = [];
    const hoje = new Date();
    const mesMinimoIso = mesDaSemana(paraIso(segundaDaSemanaISO(2026, 37)));
    for (let offset = 2; offset >= -6; offset--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
      const mesIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (mesIso < mesMinimoIso) continue;
      result.push({ value: mesIso, label: formatarMesLabel(mesIso) });
    }
    return result;
  })();

  mesFiltro = signal((() => {
    const hojeMesIso = mesDaSemana(paraIso(segundaFeiraDe(new Date())));
    const mesMinimoIso = mesDaSemana(paraIso(segundaDaSemanaISO(2026, 37)));
    return hojeMesIso < mesMinimoIso ? mesMinimoIso : hojeMesIso;
  })());

  // Título da tela/relatório — acompanha o toggle Semana/Mês (usado no <h1> e no
  // cabeçalho do relatório impresso). Não mexe no texto da aba "Indicadores Semanais"
  // do upload de histórico (essa é o nome fixo da aba dentro da planilha, não descreve
  // esta tela).
  tituloPagina = computed(() => this.modoPeriodo() === 'mes' ? 'Acompanhamento de Indicadores Mensais' : 'Acompanhamento de Indicadores Semanais');

  // Toda semana ('YYYY-MM-DD') que compõe o período selecionado — 1 semana no modo
  // Semana, todas as segundas do mês no modo Mês. Filtro central: todo lugar que
  // precisa "ordens desse período" testa `semanasDoPeriodoSet().has(o.semanaInicio)`
  // em vez de comparar direto com semanaFiltro()/mesFiltro().
  private semanasDoPeriodoSet = computed<Set<string>>(() =>
    this.modoPeriodo() === 'semana' ? new Set([this.semanaFiltro()]) : new Set(semanasDoMes(this.mesFiltro())));

  // Cabeçalho do relatório mostrava a data ISO crua (ex. "2026-09-14") — formata como
  // "SEMANA 38 · 14/09 a 20/09/2026" (modo Semana) ou "SETEMBRO/2026" (modo Mês).
  periodoLabel = computed(() => {
    if (this.modoPeriodo() === 'mes') return formatarMesLabel(this.mesFiltro()).toUpperCase();
    const semana = this.semanaFiltro();
    const dias = this.diasDaSemanaAtual();
    const inicio = dias[0]?.data ?? semana;
    const fim = dias[dias.length - 1]?.data ?? semana;
    const [anoFim] = fim.split('-');
    const fmt = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
    return `SEMANA ${numeroSemanaISO(semana)} · ${fmt(inicio)} a ${fmt(fim)}/${anoFim}`;
  });

  // Todas as ordens de verdade já carregadas (ManutencaoProgramacaoService.load() traz
  // o histórico inteiro, sem filtro de data) — ponto de partida tanto pra semana
  // selecionada quanto pra Evolução/Consolidado do Ano.
  private ordensTipo = computed(() => this.manutencaoService.ordens().filter(o => o.tipo === 'ordem'));

  private ordensDaSemana = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.ordensTipo().filter(o => semanas.has(o.semanaInicio));
  });

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

  indicadores = computed<IndicadoresSemana>(() => {
    const semanas = this.semanasDoPeriodoSet();
    return calcularIndicadoresSemana({
      ordens: this.ordensParaFechamento().filter(o => semanas.has(o.semanaInicio)),
      sigmaPorOs: this.sigmaPorOs(),
      matchColaborador: this.matchColaborador,
    });
  });

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

  qtdExames = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.manutencaoService.ordens().filter(o => semanas.has(o.semanaInicio) && o.tipo === 'exame_medico').length;
  });
  qtdFolgas = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.manutencaoService.ordens().filter(o => semanas.has(o.semanaInicio) && o.tipo === 'folga').length;
  });

  private hhPorEquipamentoTodos = computed<HhEquipamento[]>(() => hhPorEquipamento(this.ordensDaSemana()));
  hhPorEquipamentoTop10 = computed(() => this.hhPorEquipamentoTodos().slice(0, 10));
  hhPorEquipamentoMax = computed(() => this.hhPorEquipamentoTop10()[0]?.horas ?? 0);

  // Mesma ideia, agrupando por atividade (descrição da ordem) em vez de equipamento —
  // "principais atividades desenvolvidas", as que mais consumiram HH no período.
  private hhPorAtividadeTodos = computed<HhAtividade[]>(() => hhPorAtividade(this.ordensDaSemana()));
  hhPorAtividadeTop3 = computed(() => this.hhPorAtividadeTodos().slice(0, 3));
  hhPorAtividadeMax = computed(() => this.hhPorAtividadeTop3()[0]?.horas ?? 0);

  // HH só faz sentido pra Elétrica/Mecânica (Apoio programa por equipe/empresa, sem
  // disponibilidade individual cadastrada) — soma as duas juntas, já que esta tela não
  // filtra por área como o Dashboard filtrava.
  private tecnicosParaHh = computed(() =>
    this.apontamentosService.colaboradores().filter(c => {
      const t = normalizarTexto(c.area);
      return t.includes('ELETR') || t.includes('MECAN');
    }));

  // Soma HH semana a semana dentro do período (1 semana no modo Semana, todas as
  // semanas do mês no modo Mês) — NÃO dá pra flatten pra uma chamada só cobrindo o mês
  // inteiro: encontrarFeriasNoIntervalo() usa .find(), só acha o PRIMEIRO período de
  // férias que toca o intervalo. Férias (diferente de folga) podem ser fracionadas em
  // até 3 períodos (CLT) — um técnico com dois períodos de férias no mesmo mês perderia
  // o segundo se o intervalo fosse o mês inteiro numa tacada só. Calculando semana a
  // semana, cada chamada só enxerga os 7 dias daquela semana, então não tem como
  // colidir dois períodos de férias na mesma chamada.
  hhTotais = computed(() => {
    const ferias = this.manutencaoService.ferias();
    const ordensTodas = this.manutencaoService.ordens();
    const tecnicos = this.tecnicosParaHh();
    let bruto = 0;
    let liquido = 0;
    for (const semanaIso of this.semanasDoPeriodoSet()) {
      const dias = diasDaSemana(semanaIso);
      const ordensDaSemanaTodas = ordensTodas.filter(o => o.semanaInicio === semanaIso);
      for (const colaborador of tecnicos) {
        const ordensDoTecnico = this.ordensDoColaborador(ordensDaSemanaTodas, colaborador);
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
    }
    return {
      disponivel: Math.round(liquido * 100) / 100,
      indisponivel: Math.round((bruto - liquido) * 100) / 100,
    };
  });

  // ── Horas Apontadas x Programadas x Disponíveis por técnico ────────────────
  // 100% ao vivo, a partir do que já roda no resto desta tela (ManutencaoOrdem +
  // consulta ao SIGMA) — NÃO usa a tabela `apontamentos` (essa é alimentada por upload
  // manual de planilha e pode ficar semanas desatualizada, como aconteceu). Programada
  // = soma de duracaoHoras de toda ordem do técnico no período; Apontada = a mesma
  // soma, só das ordens que o SIGMA confirma executadas (ordemExecutadaAgrupada, o
  // mesmo critério usado em "Desempenho por Área" e em statusExecucao() da
  // Programação — se uma OS já aparece como executada lá, ela também conta aqui);
  // Disponível = mesma fórmula de hhTotais (calcularHhTecnico), só que por pessoa em
  // vez de somada. Só Elétrica/Mecânica, mesma restrição do HH acima.
  // Pedido do usuário: tirar esse colaborador específico desses gráficos (não do
  // cadastro/matriculas.json em si, só da exibição aqui).
  private readonly NOMES_EXCLUIDOS_HORAS = new Set(['JOAQUIM NETO']);

  private tecnicosEletrica = computed(() =>
    this.apontamentosService.colaboradores()
      .filter(c => normalizarTexto(c.area).includes('ELETR') && !this.NOMES_EXCLUIDOS_HORAS.has(normalizarTexto(c.nome))));
  private tecnicosMecanica = computed(() =>
    this.apontamentosService.colaboradores()
      .filter(c => normalizarTexto(c.area).includes('MECAN') && !this.NOMES_EXCLUIDOS_HORAS.has(normalizarTexto(c.nome))));

  private calcularHorasPorTecnico(tecnicos: Colaborador[]): HorasTecnicoItem[] {
    const ferias = this.manutencaoService.ferias();
    const ordensTodas = this.manutencaoService.ordens();
    const sigmaPorOs = this.sigmaPorOs();
    const resultado: HorasTecnicoItem[] = tecnicos.map(c => ({ colaborador: c, horasProgramadas: 0, horasApontadas: 0, horasDisponiveis: 0, eficiencia: 0 }));
    for (const semanaIso of this.semanasDoPeriodoSet()) {
      const dias = diasDaSemana(semanaIso);
      const ordensDaSemanaTodas = ordensTodas.filter(o => o.semanaInicio === semanaIso);
      for (const item of resultado) {
        const ordensDoTecnico = this.ordensDoColaborador(ordensDaSemanaTodas, item.colaborador);
        for (const o of ordensDoTecnico.filter(x => x.tipo === 'ordem')) {
          const horas = o.duracaoHoras ?? 0;
          item.horasProgramadas += horas;
          const [executada] = ordemExecutadaAgrupada([o], sigmaPorOs, this.matchColaborador);
          if (executada) item.horasApontadas += horas;
        }
        const r = calcularHhTecnico({
          dias,
          disponibilidadePorDia: new Map(dias.map(d => [d.data, this.apontamentosService.disponibilidadeNoDia(item.colaborador, d.data)])),
          diasFolga: new Set(ordensDoTecnico.filter(o => o.tipo === 'folga').flatMap(o => o.diasPrevistos)),
          diasExameMedico: new Set(ordensDoTecnico.filter(o => o.tipo === 'exame_medico').flatMap(o => o.diasPrevistos)),
          feriasIntervalo: encontrarFeriasNoIntervalo(ferias, item.colaborador.nome, dias.map(d => d.data)),
        });
        item.horasDisponiveis += r.liquido;
      }
    }
    for (const item of resultado) {
      item.horasProgramadas = Math.round(item.horasProgramadas * 100) / 100;
      item.horasApontadas = Math.round(item.horasApontadas * 100) / 100;
      item.horasDisponiveis = Math.round(item.horasDisponiveis * 100) / 100;
      item.eficiencia = item.horasProgramadas > 0 ? Math.round((item.horasApontadas / item.horasProgramadas) * 1000) / 10 : 0;
    }
    return resultado.sort((a, b) => b.horasApontadas - a.horasApontadas);
  }

  rankingHorasApontadasEletrica = computed<HorasTecnicoItem[]>(() => this.calcularHorasPorTecnico(this.tecnicosEletrica()));
  rankingHorasApontadasMecanica = computed<HorasTecnicoItem[]>(() => this.calcularHorasPorTecnico(this.tecnicosMecanica()));

  // Largura da barra em % da própria Hora Disponível do técnico (referência = 100%) —
  // capada em 100 pra não estourar o container quando apontado/programado > disponível.
  percentualBarraHoras(valor: number, disponivel: number): number {
    return disponivel > 0 ? Math.min(100, Math.round((valor / disponivel) * 100)) : 0;
  }


  imprimir(): void {
    window.print();
  }

  // Link público (sem login, sem timeout de inatividade — ver publico/indicadores-
  // manutencao em app.routes.ts e manutencao-indicadores-publico.component.ts) pra
  // divulgar essa tela ao setor sem precisar montar a URL na mão.
  async copiarLinkPublico(): Promise<void> {
    const url = `${location.origin}/publico/indicadores-manutencao`;
    try {
      await navigator.clipboard.writeText(url);
      this.notificationService.showSuccess('Link público copiado! Já pode divulgar pro setor.');
    } catch {
      this.notificationService.showError(`Não deu pra copiar automaticamente. Link: ${url}`);
    }
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
      { titulo: 'Atendimento à Programação', valor: `${ano.geral.atendimento}%`, meta: `${ano.geral.executadas} de ${ano.geral.programadas} executadas no ano · Meta: ${this.metaAtendimento}%`, cor: 'green', icone: 'check' },
      { titulo: 'Cumprimento do Plano', valor: `${ano.cumprimentoPlano.atendimento}%`, meta: `${ano.cumprimentoPlano.executadas} de ${ano.cumprimentoPlano.programadas} planejadas do Plano · Meta: ${this.metaCumprimento}%`, cor: 'blue', icone: 'calendario' },
      { titulo: 'Status Geral do Ano', valor: this.statusAnoSimplificado(), cor: 'teal', icone: 'bandeira' },
    ];
  });

  // "Status Geral do Ano" simplificado a pedido do usuário — só 2 valores (não os 3 de
  // StatusGeralSemana que o resto da tela usa, com a faixa intermediária "Próximo da
  // Meta"): Acima da Meta exige os dois indicadores (Atendimento e Cumprimento) em
  // 95% ou mais; qualquer coisa abaixo disso é Abaixo da Meta, só pra este card.
  statusAnoSimplificado = computed(() => {
    const ano = this.consolidadoAno();
    return (ano.geral.atendimento >= this.metaAtendimento && ano.cumprimentoPlano.atendimento >= this.metaCumprimento)
      ? 'Acima da Meta' : 'Abaixo da Meta';
  });

  statusAnoCor = computed(() => this.statusAnoSimplificado() === 'Acima da Meta' ? '#4CAF50' : '#F44336');

  // ── Evolução ao Longo do Ano + Consolidado do Ano ──────────────────────

  // Toda semana desde a S37/2026 (início do uso nativo da Programação) até a semana
  // SELECIONADA no filtro (não "hoje" de verdade) — em ordem cronológica, sem limite
  // de janela (diferente do dropdown "semanas" acima, que só mostra um recorte curto
  // pra escolher pontualmente).
  //
  // Causa raiz do bug "gráfico preso em 0%": antes usava `new Date()` direto, ignorando
  // o filtro — então o último ponto SEMPRE era a semana corrente de verdade (ex. S38),
  // mesmo com o usuário olhando outra semana (ex. S37) na tabela/cards. Como a semana
  // real "de hoje" quase sempre ainda não tem ordem nenhuma programada (é o futuro do
  // ponto de vista de quem está olhando uma semana anterior), esse ponto ficava sempre
  // em 0% e nunca mudava — o gráfico deve acompanhar o que está selecionado, não o
  // relógio.
  private semanasHistoricoIso = computed(() => {
    // No modo Mês, o limite precisa ir até a última segunda do mês selecionado — não
    // usar semanaFiltro() direto aqui (fica congelado/não muda de valor nesse modo).
    // Sem esse branch, consolidadoAno() (que depende desta lista) ficaria ancorado numa
    // semana desatualizada ao trocar pra Mês, reintroduzindo uma variante do bug "preso
    // em 0%" já corrigido nesta tela.
    let fimIso: string;
    if (this.modoPeriodo() === 'mes') {
      const semanasDoMesAtual = semanasDoMes(this.mesFiltro());
      fimIso = semanasDoMesAtual[semanasDoMesAtual.length - 1] ?? this.semanaFiltro();
    } else {
      fimIso = this.semanaFiltro();
    }
    const minimoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const fimClamped = fimIso < minimoIso ? minimoIso : fimIso; // nunca antes do início do sistema
    const resultado: string[] = [];
    let cursor = new Date(minimoIso + 'T00:00:00');
    const fim = new Date(fimClamped + 'T00:00:00');
    while (cursor <= fim) {
      resultado.push(paraIso(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return resultado;
  });

  // Meses cobertos pelas semanas acima — deriva do MESMO range já corrigido em vez de
  // manter um segundo cálculo de limite independente (evita os dois desalinharem).
  private mesesHistoricoIso = computed(() => [...new Set(this.semanasHistoricoIso().map(mesDaSemana))]);

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

  // Mesma ideia de indicadoresPorSemana, mas agrupando as semanas já calculadas por mês
  // — soma as contagens brutas de cada semana do mês via somarContagem (nunca faz média
  // de % semanais), mesmo padrão que consolidadoAno já usa pra combinar semanas.
  private indicadoresPorMes = computed(() => {
    const porMes = new Map<string, IndicadoresSemana[]>();
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      const mes = mesDaSemana(semana);
      const lista = porMes.get(mes);
      if (lista) lista.push(indicadores);
      else porMes.set(mes, [indicadores]);
    }
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    return this.mesesHistoricoIso().map(mes => {
      const semanas = porMes.get(mes) ?? [];
      const geral = semanas.reduce((acc, ind) => somarContagem(acc, ind.geral), zero);
      const cumprimentoPlano = semanas.reduce((acc, ind) => somarContagem(acc, ind.cumprimentoPlano), zero);
      const porArea: IndicadorArea[] = CATEGORIAS_INDICADOR
        .map((categoria): IndicadorArea => ({
          categoria,
          ...semanas.reduce((acc, ind) => somarContagem(acc, ind.porArea.find(a => a.categoria === categoria) ?? zero), zero),
          cumprimentoPlano: semanas.reduce((acc, ind) => somarContagem(acc, ind.porArea.find(a => a.categoria === categoria)?.cumprimentoPlano ?? zero), zero),
        }))
        .filter(a => a.programadas > 0);
      return { mes, geral, cumprimentoPlano, porArea };
    });
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
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
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
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
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

  // Versão mensal de pontosEvolucaoGeral/pontosEvolucaoPorArea — mesma ideia, só que o
  // histórico "de antes" (guardado por semana) é agrupado por mesDaSemana() e somado via
  // somarContagem antes de virar %, em vez de usar o % de uma semana isolada.
  private pontosEvolucaoGeralMensal = computed<{ mes: string; atendimento: number; cumprimento: number }[]>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    const geralPorMes = new Map<string, ContagemExecucao>();
    const planoPorMes = new Map<string, ContagemExecucao>();
    for (const item of this.historicoService.itens()) {
      if (item.categoria !== 'GERAL' || item.semanaInicio >= inicioAoVivoIso) continue;
      const mes = mesDaSemana(item.semanaInicio);
      geralPorMes.set(mes, somarContagem(geralPorMes.get(mes) ?? zero,
        { programadas: item.programadas, executadas: item.executadas, naoExecutadas: item.naoExecutadas, atendimento: 0 }));
      planoPorMes.set(mes, somarContagem(planoPorMes.get(mes) ?? zero,
        { programadas: item.planejadasPlano, executadas: item.executadasPlano, naoExecutadas: item.naoExecutadasPlano, atendimento: 0 }));
    }
    const mapa = new Map<string, { atendimento: number; cumprimento: number }>();
    for (const [mes, g] of geralPorMes) {
      mapa.set(mes, { atendimento: g.atendimento, cumprimento: (planoPorMes.get(mes) ?? zero).atendimento });
    }
    for (const { mes, geral, cumprimentoPlano } of this.indicadoresPorMes()) {
      mapa.set(mes, { atendimento: geral.atendimento, cumprimento: cumprimentoPlano.atendimento });
    }
    // Garante que o mês selecionado bate com o mesmo número que os cards/tabela mostram
    // (fonte única: indicadores(), já agregado pro mês inteiro nesse modo).
    const ind = this.indicadores();
    mapa.set(this.mesFiltro(), { atendimento: ind.geral.atendimento, cumprimento: ind.cumprimentoPlano.atendimento });
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, v]) => ({ mes, ...v }));
  });

  private pontosEvolucaoPorAreaMensal = computed<Map<CategoriaIndicador, Map<string, { atendimento: number; cumprimento: number }>>>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    const geralPorCategoria = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, ContagemExecucao>()]));
    const planoPorCategoria = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, ContagemExecucao>()]));
    for (const item of this.historicoService.itens()) {
      if (item.categoria === 'GERAL' || item.semanaInicio >= inicioAoVivoIso) continue;
      const mes = mesDaSemana(item.semanaInicio);
      const mapaGeral = geralPorCategoria.get(item.categoria);
      const mapaPlano = planoPorCategoria.get(item.categoria);
      mapaGeral?.set(mes, somarContagem(mapaGeral.get(mes) ?? zero,
        { programadas: item.programadas, executadas: item.executadas, naoExecutadas: item.naoExecutadas, atendimento: 0 }));
      mapaPlano?.set(mes, somarContagem(mapaPlano.get(mes) ?? zero,
        { programadas: item.planejadasPlano, executadas: item.executadasPlano, naoExecutadas: item.naoExecutadasPlano, atendimento: 0 }));
    }
    const resultado = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, { atendimento: number; cumprimento: number }>()]));
    for (const categoria of CATEGORIAS_INDICADOR) {
      for (const [mes, g] of geralPorCategoria.get(categoria)!) {
        resultado.get(categoria)!.set(mes, { atendimento: g.atendimento, cumprimento: (planoPorCategoria.get(categoria)!.get(mes) ?? zero).atendimento });
      }
    }
    for (const { mes, porArea } of this.indicadoresPorMes()) {
      for (const area of porArea) {
        if (!area.categoria) continue;
        resultado.get(area.categoria)?.set(mes, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
      }
    }
    const mesFiltro = this.mesFiltro();
    for (const area of this.indicadores().porArea) {
      if (!area.categoria) continue;
      resultado.get(area.categoria)?.set(mesFiltro, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
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

  // "SET/26" — rótulo curto de mês pro eixo X do gráfico no modo Mensal (mesmos nomes
  // de MESES_ABREV, ano com 2 dígitos pra não brigar por espaço com o rótulo semanal).
  private labelMes(mesIso: string): string {
    const [ano, mes] = mesIso.split('-');
    return `${MESES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`;
  }

  linhaTempoGeral = computed(() => {
    const pontos = this.modoPeriodo() === 'mes'
      ? this.pontosEvolucaoGeralMensal().map(p => ({ label: this.labelMes(p.mes), atendimento: p.atendimento, cumprimento: p.cumprimento }))
      : this.pontosEvolucaoGeral().map(p => ({ label: `S${numeroSemanaISO(p.semana)}`, atendimento: p.atendimento, cumprimento: p.cumprimento }));
    return this.enriquecerGeometria(calcularLinhaTempo(pontos), pontos);
  });

  linhaTempoPorArea = computed(() => {
    const mensal = this.modoPeriodo() === 'mes';
    const mapaPorCategoria = mensal ? this.pontosEvolucaoPorAreaMensal() : this.pontosEvolucaoPorArea();
    return CATEGORIAS_INDICADOR.map(categoria => {
      const pontos = [...(mapaPorCategoria.get(categoria) ?? new Map()).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([chave, v]): PontoLinhaTempo => ({
          label: mensal ? this.labelMes(chave) : `S${numeroSemanaISO(chave)}`,
          atendimento: v.atendimento, cumprimento: v.cumprimento,
        }));
      return { categoria, label: CATEGORIA_LABEL[categoria], geometria: this.enriquecerGeometria(calcularLinhaTempo(pontos), pontos) };
    });
  });

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
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const historicoDoAno = this.historicoService.itens().filter(item =>
      Number(item.semanaInicio.slice(0, 4)) === anoAtual && item.semanaInicio < inicioAoVivoIso);

    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 0 };
    const somarHistorico = (categoria: CategoriaIndicador | 'GERAL', plano: boolean) => historicoDoAno
      .filter(i => i.categoria === categoria)
      .reduce((acc, i) => somarContagem(acc, plano
        ? { programadas: i.planejadasPlano, executadas: i.executadasPlano, naoExecutadas: i.naoExecutadasPlano, atendimento: 0 }
        : { programadas: i.programadas, executadas: i.executadas, naoExecutadas: i.naoExecutadas, atendimento: 0 }), zero);

    const geral = somarContagem(aoVivo.geral, somarHistorico('GERAL', false));
    const cumprimentoPlano = somarContagem(aoVivo.cumprimentoPlano, somarHistorico('GERAL', true));

    const porArea: IndicadorArea[] = CATEGORIAS_INDICADOR
      .map((categoria): IndicadorArea => {
        const areaAoVivo = aoVivo.porArea.find(a => a.categoria === categoria);
        return {
          categoria,
          ...somarContagem(areaAoVivo ?? zero, somarHistorico(categoria, false)),
          cumprimentoPlano: somarContagem(areaAoVivo?.cumprimentoPlano ?? zero, somarHistorico(categoria, true)),
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

      const paraSemanaInicio = (label: string) => paraIso(segundaDaSemanaISO(ano, Number(label.replace('S', ''))));
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
