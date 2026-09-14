import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { ConsultaSigmaResultado } from '../../../models/manutencao-programacao.model';
import {
  CATEGORIA_LABEL, IndicadoresSemana, META_ATENDIMENTO, META_CUMPRIMENTO, calcularIndicadoresSemana,
} from '../../../utils/manutencao-indicadores';

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

// Reaproveita o mesmo intervalo do proxy do SIGMA (cache de 10min no servidor, ver
// api/_sigma-shared.js) — poll mais frequente que isso não traria dado mais novo, só
// gastaria requisição à toa; 3min dá uma sensação de "ao vivo" sem exagerar.
const INTERVALO_POLL_MS = 3 * 60 * 1000;

@Component({
  selector: 'app-manutencao-indicadores-semanais',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-indicadores-semanais.component.html',
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
  ) {
    // Refaz a consulta ao SIGMA sempre que a semana selecionada mudar.
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

  private ordensDaSemana = computed(() =>
    this.manutencaoService.ordens().filter(o => o.semanaInicio === this.semanaFiltro() && o.tipo === 'ordem'));

  // ── Execução via SIGMA (mesmo padrão do Dashboard) ──
  sigmaPorOs = signal<Record<string, ConsultaSigmaResultado>>({});
  sigmaAtualizando = signal(false);
  ultimaAtualizacaoEm = signal<Date | null>(null);

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
    matchColaborador: (matricula, nome) => this.apontamentosService.matchColaboradorDaOrdem(matricula, nome),
  }));

  corPercentual(percentual: number, meta: number): string {
    if (percentual >= meta) return 'text-green-600';
    if (percentual >= meta * 0.9) return 'text-amber-600';
    return 'text-red-600';
  }

  statusCor(status: IndicadoresSemana['statusGeral']): string {
    if (status === 'Dentro da Meta') return 'bg-green-100 text-green-700';
    if (status === 'Próximo da Meta') return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  }
}
