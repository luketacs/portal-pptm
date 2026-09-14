import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
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
  CATEGORIAS_INDICADOR, CATEGORIA_LABEL, IndicadoresSemana, META_ATENDIMENTO, META_CUMPRIMENTO, calcularIndicadoresSemana,
} from '../../../utils/manutencao-indicadores';
import { PontoLinhaTempo, calcularLinhaTempo } from '../../../utils/relatorio-linha-tempo';
import { AREAS_LINHA_TEMPO_SEPARADA, extrairHistoricoSemanas, extrairHistoricoSemanasPorArea } from '../../../utils/relatorio-semanal-pcm';
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

  // Todas as ordens de verdade já carregadas (ManutencaoProgramacaoService.load() traz
  // o histórico inteiro, sem filtro de data) — ponto de partida tanto pra semana
  // selecionada quanto pra Evolução/Consolidado do Ano.
  private ordensTipo = computed(() => this.manutencaoService.ordens().filter(o => o.tipo === 'ordem'));

  private ordensDaSemana = computed(() =>
    this.ordensTipo().filter(o => o.semanaInicio === this.semanaFiltro()));

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
    ordens: this.ordensDaSemana(),
    sigmaPorOs: this.sigmaPorOs(),
    diasSemanaFallback: this.diasDaSemanaAtual().map(d => d.data),
    matchColaborador: this.matchColaborador,
  }));

  // ── Migrado do Dashboard da Programação (src/components/manutencao/
  // manutencao-dashboard/) — essa tela substitui o Dashboard, então essas métricas
  // (Corretivas/Preventivas, Exames/Folgas, HH) vêm pra cá antes dele ser removido.
  private ordemExecutadaAgrupadaLocal(ordens: ManutencaoOrdem[]): boolean[] {
    return ordemExecutadaAgrupada(ordens, this.sigmaPorOs(), this.diasDaSemanaAtual().map(d => d.data), this.matchColaborador);
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
    const ordensTipo = this.ordensTipo();
    return this.semanasHistoricoIso().map(semana => ({
      semana,
      indicadores: calcularIndicadoresSemana({
        ordens: ordensTipo.filter(o => o.semanaInicio === semana),
        sigmaPorOs,
        diasSemanaFallback: diasDaSemana(semana).map(d => d.data),
        matchColaborador: this.matchColaborador,
      }),
    }));
  });

  // Combina o histórico importado (semanas de ANTES da S37/2026 — só tem % agregado,
  // vindo da planilha, ver ManutencaoIndicadoresHistoricoService) com o cálculo ao vivo
  // (semanas com ordens reais no Portal) — o cálculo ao vivo sempre vence se as duas
  // fontes cobrirem a mesma semana (não deveria acontecer na prática, só bem perto da
  // virada S36→S37/2026).
  private pontosEvolucaoGeral = computed<{ semana: string; atendimento: number; cumprimento: number }[]>(() => {
    const mapa = new Map<string, { atendimento: number; cumprimento: number }>();
    for (const item of this.historicoService.itens()) {
      if (item.categoria === 'GERAL') mapa.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      mapa.set(semana, { atendimento: indicadores.geral.atendimento, cumprimento: indicadores.cumprimentoPlano.atendimento });
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, v]) => ({ semana, ...v }));
  });

  private pontosEvolucaoPorArea = computed<Map<CategoriaIndicador, Map<string, { atendimento: number; cumprimento: number }>>>(() => {
    const resultado = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, { atendimento: number; cumprimento: number }>()]));
    for (const item of this.historicoService.itens()) {
      if (item.categoria !== 'GERAL') resultado.get(item.categoria)?.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      for (const area of indicadores.porArea) {
        if (!area.categoria) continue;
        resultado.get(area.categoria)?.set(semana, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
      }
    }
    return resultado;
  });

  // Geometria SVG pronta pro <polyline>/<circle> (mesmo util do Relatório Semanal/
  // Mensal PCM, src/utils/relatorio-linha-tempo.ts — só troca a fonte dos pontos: em
  // vez de ler célula de planilha, vem do histórico importado + cálculo ao vivo acima).
  linhaTempoGeral = computed(() => calcularLinhaTempo(
    this.pontosEvolucaoGeral().map(p => ({ label: `S${this.numeroSemanaISO(p.semana)}`, atendimento: p.atendimento, cumprimento: p.cumprimento })),
  ));

  linhaTempoPorArea = computed(() => CATEGORIAS_INDICADOR.map(categoria => {
    const pontos = [...(this.pontosEvolucaoPorArea().get(categoria) ?? new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semana, v]): PontoLinhaTempo => ({ label: `S${this.numeroSemanaISO(semana)}`, atendimento: v.atendimento, cumprimento: v.cumprimento }));
    return { categoria, label: CATEGORIA_LABEL[categoria], geometria: calcularLinhaTempo(pontos) };
  }));

  // Soma todas as semanas do ano corrente (não o histórico inteiro, que pode cruzar
  // virada de ano) numa única agregação — reaproveita calcularIndicadoresSemana direto,
  // sem nenhuma fórmula nova: "ano até o momento" é só "várias semanas juntas".
  consolidadoAno = computed<IndicadoresSemana>(() => {
    const anoAtual = new Date().getFullYear();
    const semanasDoAno = new Set(this.semanasHistoricoIso().filter(s => Number(s.slice(0, 4)) === anoAtual));
    return calcularIndicadoresSemana({
      ordens: this.ordensTipo().filter(o => semanasDoAno.has(o.semanaInicio)),
      sigmaPorOs: this.sigmaPorOs(),
      // Cada ordem já carrega os próprios diasPrevistos quase sempre — sem um "dia da
      // semana" único fazendo sentido pra um agregado de várias semanas, uma ordem sem
      // diasPrevistos aqui conta como não executada (mesmo raciocínio conservador do
      // fallback vazio: não afirma execução sem data pra comparar).
      diasSemanaFallback: [],
      matchColaborador: this.matchColaborador,
    });
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

      for (const ponto of extrairHistoricoSemanas(rows, 53)) {
        itens.push({ semanaInicio: paraSemanaInicio(ponto.label), categoria: 'GERAL', atendimento: ponto.atendimento, cumprimento: ponto.cumprimento });
      }
      for (const areaPcm of AREAS_LINHA_TEMPO_SEPARADA) {
        const categoria = AREA_PCM_PARA_CATEGORIA[areaPcm];
        if (!categoria) continue;
        for (const ponto of extrairHistoricoSemanasPorArea(rows, 53, areaPcm)) {
          itens.push({ semanaInicio: paraSemanaInicio(ponto.label), categoria, atendimento: ponto.atendimento, cumprimento: ponto.cumprimento });
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
