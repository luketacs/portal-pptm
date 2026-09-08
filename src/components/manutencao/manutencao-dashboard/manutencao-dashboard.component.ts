import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { ConsultaSigmaResultado, ManutencaoArea, ManutencaoOrdem } from '../../../models/manutencao-programacao.model';
import { encontrarFeriasNoIntervalo } from '../../../utils/manutencao-regras';
import { HhEquipamento, KpiExecucao, calcularHhTecnico, calcularKpiExecucao, hhPorEquipamento } from '../../../utils/manutencao-dashboard';

type AreaFiltro = 'todos' | ManutencaoArea;

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

function segundaFeiraDe(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = date.getDay(); // 0=dom, 1=seg, ..., 6=sáb
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

// Datas reais (não rótulos) da semana SEG–DOM a partir da segunda-feira ('YYYY-MM-DD').
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

function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

@Component({
  selector: 'app-manutencao-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoDashboardComponent implements OnInit {
  readonly areaLabel = AREA_LABEL;
  errorMessage = signal('');

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private apontamentosService: ApontamentosService,
  ) {
    // Refaz a consulta ao SIGMA sempre que a lista de OS visíveis (semana/área) mudar.
    effect(() => {
      const numeros = this.numerosOsVisiveis();
      if (numeros.length === 0) return;
      this.buscarExecucaoSigma(numeros);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.manutencaoService.load();
      await this.apontamentosService.loadColaboradores();
      await this.manutencaoService.loadFerias();
    } catch {
      this.errorMessage.set('Erro ao carregar os dados do dashboard.');
    }
  }

  // ── Semana ISO — mesmos helpers/faixa (S37/2026 em diante) já usados na Programação ──
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

  // Mesma faixa da Programação: sem semana antes da S37/2026 — é quando a programação
  // nativa começou a ser usada de verdade.
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
  areaFiltro = signal<AreaFiltro>('todos');

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));

  // ── Ordens da semana/área selecionada ──
  ordensDaSemana = computed(() => {
    const semana = this.semanaFiltro();
    const area = this.areaFiltro();
    return this.manutencaoService.ordens().filter(o => o.semanaInicio === semana && (area === 'todos' || o.area === area));
  });

  private ordensTipo = computed(() => this.ordensDaSemana().filter(o => o.tipo === 'ordem'));

  // ── Execução via SIGMA (mesmo padrão de statusExecucao() na Programação) ──
  sigmaPorOs = signal<Record<string, ConsultaSigmaResultado>>({});
  sigmaAtualizando = signal(false);

  private numerosOsVisiveis = computed(() =>
    [...new Set(this.ordensDaSemana().map(o => o.numeroOs).filter((n): n is string => !!n?.trim()))],
  );

  atualizar(): void {
    const numeros = this.numerosOsVisiveis();
    if (numeros.length > 0) this.buscarExecucaoSigma(numeros);
  }

  private async buscarExecucaoSigma(numeros: string[]): Promise<void> {
    this.sigmaAtualizando.set(true);
    try {
      // Lotes de 200 — o proxy trunca silenciosamente acima disso, e somando as três
      // áreas numa semana movimentada dá pra passar do limite.
      const acumulado: Record<string, ConsultaSigmaResultado> = {};
      for (let i = 0; i < numeros.length; i += 200) {
        const resultado = await this.manutencaoService.consultarOrdensSigma(numeros.slice(i, i + 200));
        Object.assign(acumulado, resultado);
      }
      this.sigmaPorOs.update(atual => ({ ...atual, ...acumulado }));
    } catch {
      // Consulta best-effort — falha do SIGMA não deve travar o dashboard.
    } finally {
      this.sigmaAtualizando.set(false);
    }
  }

  private ordemExecutada(o: ManutencaoOrdem): boolean {
    if (!o.numeroOs?.trim()) return false;
    const resultado = this.sigmaPorOs()[normalizarNumeroOs(o.numeroOs)];
    if (!resultado) return false;
    const dias = o.diasPrevistos.length > 0 ? o.diasPrevistos : this.diasDaSemanaAtual().map(d => d.data);
    return resultado.apontamentos.some(a => dias.includes(a.data));
  }

  // ── KPIs de execução ──
  kpiGeral = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordensTipo().map(o => ({ executada: this.ordemExecutada(o) }))));

  kpiCorretivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordensTipo().filter(o => o.tipoServico?.trim().toUpperCase() === 'CORRETIVA').map(o => ({ executada: this.ordemExecutada(o) }))));

  kpiPreventivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordensTipo().filter(o => o.tipoServico?.trim().toUpperCase() === 'PREVENTIVA').map(o => ({ executada: this.ordemExecutada(o) }))));

  corPercentual(percentual: number): string {
    if (percentual >= 80) return 'text-green-600';
    if (percentual >= 50) return 'text-amber-600';
    return 'text-red-600';
  }

  qtdExames = computed(() => this.ordensDaSemana().filter(o => o.tipo === 'exame_medico').length);
  qtdFolgas = computed(() => this.ordensDaSemana().filter(o => o.tipo === 'folga').length);

  // ── HH por equipamento (top 10) ──
  private hhPorEquipamentoTodos = computed<HhEquipamento[]>(() => hhPorEquipamento(this.ordensTipo()));
  hhPorEquipamentoTop10 = computed(() => this.hhPorEquipamentoTodos().slice(0, 10));
  hhPorEquipamentoMax = computed(() => this.hhPorEquipamentoTop10()[0]?.horas ?? 0);

  // ── HH disponível/indisponível — soma por técnico (Elétrica/Mecânica; Apoio programa
  // por equipe/empresa, não tem disponibilidade cadastrada pra calcular). ──
  private tecnicosParaHh = computed(() => {
    const area = this.areaFiltro();
    if (area === 'APOIO') return [];
    const termo = area === 'ELETRICA' ? 'ELETR' : area === 'MECANICA' ? 'MECAN' : null;
    return this.apontamentosService.colaboradores().filter(c => {
      const t = normalizarTexto(c.area);
      return termo ? t.includes(termo) : (t.includes('ELETR') || t.includes('MECAN'));
    });
  });

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
}
