import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TecnicoAtividade {
  nome: string;
  duracaoHoras: number | null;
}

// A mesma OS pode ter mais de um técnico (apoio) — o número da OS não repete no
// quadro, os técnicos entram todos no mesmo card (ver api/kanban-atividades-publico.js).
export interface CardAtividade {
  numeroOs: string | null;
  descricao: string;
  equipamento: string | null;
  tecnicos: TecnicoAtividade[];
  area: 'ELETRICA' | 'MECANICA';
  loto: string | null;
}

interface ColunasKanban {
  pendente: CardAtividade[];
  emExecucao: CardAtividade[];
  concluida: CardAtividade[];
}

interface IndicadorPercentual {
  percentual: number;
}

export interface HhArea {
  area: string;
  horas: number;
}

export interface HhColaborador {
  nome: string;
  horas: number;
}

export interface EquipamentoCorretiva {
  equipamento: string;
  quantidade: number;
}

interface IndicadoresSemana {
  cumprimentoProgramacao: IndicadorPercentual | null;
  atendimentoPlanos: IndicadorPercentual | null;
  hhPorArea: HhArea[];
  hhPorColaborador: HhColaborador[];
  equipamentosCorretivas: EquipamentoCorretiva[];
}

const INDICADORES_VAZIOS: IndicadoresSemana = {
  cumprimentoProgramacao: null,
  atendimentoPlanos: null,
  hhPorArea: [],
  hhPorColaborador: [],
  equipamentosCorretivas: [],
};

const RECARREGAR_A_CADA_MS = 60 * 1000;

// Mesmo cálculo de semana ISO 8601 usado na Programação (numeroSemanaISO em
// manutencao-programacao.component.ts) — duplicado aqui porque esse componente é
// público/standalone, sem nenhuma dependência do resto do app.
function numeroSemanaISO(d: Date): number {
  const data = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const diaDaSemana = (data.getUTCDay() + 6) % 7;
  data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
  const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
  const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
  return 1 + Math.round(diffDias / 7);
}

export interface DensidadeColuna {
  cols: number;
  rows: number;
  // false = poucos itens: cards no tamanho natural, alinhados no topo, sem esticar pra
  // preencher a coluna inteira. true = grade distribuída pra ocupar exatamente 100% da
  // altura disponível (nem sobra, nem falta, nunca precisa rolar).
  preencher: boolean;
  gap: string;
  cardPadding: string;
  tituloClasse: string;
  osClasse: string;
  descClasse: string;
  tecnicoClasse: string;
  lotoClasse: string;
  mostrarDescricao: boolean;
  maxTecnicos: number;
}

// A TV nunca pode ter scroll — em vez de um número fixo de colunas de cards (que
// obrigava rolar quando o dia tinha muita ordem, ver captura de tela que o usuário
// mandou), a grade de cada coluna de status calcula sozinha quantas colunas/linhas de
// card precisa pra caber tudo dentro de um teto de linhas (MAX_ROWS) — quanto mais
// ordens, mais colunas de card (nunca mais linhas do que cabe na tela), e o texto vai
// encolhendo em níveis conforme o card fica menor. Ver [style.grid-template-*] no
// template, que usa cols/rows pra montar uma grade de tamanho fixo (sem scroll nunca).
const MAX_ROWS = 7;
// Até esse tanto de item, não vale a pena esticar os cards pra preencher a coluna
// (ficava um card gigante e vazio pra 1 ordem só, ver captura de tela que o usuário
// mandou) — usa o tamanho natural, alinhado no topo, com o espaço sobrando em branco.
const LIMITE_TAMANHO_NATURAL = 3;

export function calcularDensidade(qtd: number): DensidadeColuna {
  if (qtd <= LIMITE_TAMANHO_NATURAL) {
    return {
      cols: qtd <= 1 ? 1 : 2, rows: 1, preencher: false,
      gap: 'gap-2', cardPadding: 'p-3',
      tituloClasse: 'text-base', osClasse: 'text-xs', descClasse: 'text-sm line-clamp-2', tecnicoClasse: 'text-sm',
      lotoClasse: 'text-[10px] px-2 py-0.5', mostrarDescricao: true, maxTecnicos: 3,
    };
  }
  const cols = Math.max(1, Math.ceil(qtd / MAX_ROWS));
  const rows = Math.ceil(qtd / cols);
  if (cols <= 2) {
    return {
      cols, rows, preencher: true, gap: 'gap-2', cardPadding: 'p-3',
      tituloClasse: 'text-base', osClasse: 'text-xs', descClasse: 'text-sm line-clamp-2', tecnicoClasse: 'text-sm',
      lotoClasse: 'text-[10px] px-2 py-0.5', mostrarDescricao: true, maxTecnicos: 3,
    };
  }
  if (cols <= 4) {
    return {
      cols, rows, preencher: true, gap: 'gap-1.5', cardPadding: 'p-2',
      tituloClasse: 'text-sm', osClasse: 'text-[10px]', descClasse: 'text-xs line-clamp-2', tecnicoClasse: 'text-xs',
      lotoClasse: 'text-[9px] px-1.5 py-0.5', mostrarDescricao: true, maxTecnicos: 2,
    };
  }
  if (cols <= 6) {
    return {
      cols, rows, preencher: true, gap: 'gap-1', cardPadding: 'p-1.5',
      tituloClasse: 'text-xs', osClasse: 'text-[9px]', descClasse: 'text-[10px] line-clamp-1', tecnicoClasse: 'text-[10px]',
      lotoClasse: 'text-[8px] px-1 py-px', mostrarDescricao: false, maxTecnicos: 2,
    };
  }
  return {
    cols, rows, preencher: true, gap: 'gap-0.5', cardPadding: 'p-1',
    tituloClasse: 'text-[11px]', osClasse: 'text-[8px]', descClasse: 'text-[9px] line-clamp-1', tecnicoClasse: 'text-[9px]',
    lotoClasse: 'text-[8px] px-1', mostrarDescricao: false, maxTecnicos: 1,
  };
}

// Quadro público (sem login) das atividades do dia — Elétrica + Mecânica, pensado pra
// ficar aberto numa TV da oficina. Só consome /api/kanban-atividades-publico, sem
// nenhuma dependência de AuthService/ManutencaoProgramacaoService (não precisa de sessão).
@Component({
  selector: 'app-kanban-oficina-publico',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kanban-oficina-publico.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KanbanOficinaPublicoComponent implements OnInit, OnDestroy {
  colunas = signal<ColunasKanban>({ pendente: [], emExecucao: [], concluida: [] });
  indicadores = signal<IndicadoresSemana>(INDICADORES_VAZIOS);
  atualizadoEm = signal<number | null>(null);
  erro = signal('');
  carregando = signal(true);
  readonly hojeLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  readonly numeroSemana = numeroSemanaISO(new Date());

  densidadePendente = computed(() => calcularDensidade(this.colunas().pendente.length));
  densidadeEmExecucao = computed(() => calcularDensidade(this.colunas().emExecucao.length));
  densidadeConcluida = computed(() => calcularDensidade(this.colunas().concluida.length));

  // Maior HH por colaborador/área da semana — usado só pra dimensionar a barrinha das
  // listas da faixa de indicadores (largura relativa ao maior valor, sem depender de um
  // teto fixo que poderia cortar a barra ou deixá-la minúscula demais).
  maiorHhColaborador = computed(() => Math.max(1, ...this.indicadores().hhPorColaborador.map(h => h.horas)));
  maiorHhArea = computed(() => Math.max(1, ...this.indicadores().hhPorArea.map(h => h.horas)));
  maiorQtdCorretiva = computed(() => Math.max(1, ...this.indicadores().equipamentosCorretivas.map(e => e.quantidade)));

  // A faixa de indicadores agora é horizontal, no topo — top 4 em vez de 8/5 pra caber
  // numa faixa curta sem precisar de scroll.
  topColaboradores = computed(() => this.indicadores().hhPorColaborador.slice(0, 4));
  topCorretivas = computed(() => this.indicadores().equipamentosCorretivas.slice(0, 4));

  private intervalId?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.carregar();
    this.intervalId = setInterval(() => this.carregar(), RECARREGAR_A_CADA_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  atualizadoEmLabel(): string {
    const ts = this.atualizadoEm();
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  tecnicosVisiveis(item: CardAtividade, max: number): TecnicoAtividade[] {
    return item.tecnicos.slice(0, max);
  }

  tecnicosExtras(item: CardAtividade, max: number): number {
    return Math.max(0, item.tecnicos.length - max);
  }

  private async carregar(): Promise<void> {
    try {
      const resp = await fetch('/api/kanban-atividades-publico');
      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) throw new Error(body?.error || 'Falha ao carregar o quadro.');
      this.colunas.set(body.colunas);
      this.indicadores.set(body.indicadores ?? INDICADORES_VAZIOS);
      this.atualizadoEm.set(body.atualizadoEm);
      this.erro.set('');
    } catch (err: unknown) {
      this.erro.set(err instanceof Error ? err.message : 'Não foi possível atualizar o quadro.');
    } finally {
      this.carregando.set(false);
    }
  }
}
