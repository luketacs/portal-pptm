// Versão PÚBLICA (sem login) do Acompanhamento de Indicadores de Manutenção — pra
// divulgar pro setor sem exigir sessão, inclusive deixada aberta num monitor por horas
// (rota sob /publico/..., sem authGuard — ver app.routes.ts). Mesmo princípio do
// KanbanOficinaPublicoComponent: standalone, ZERO dependência de serviço autenticado
// (AuthService/ManutencaoProgramacaoService/ApontamentosService/Supabase) — os dados
// brutos vêm de um único fetch a /api/indicadores-manutencao-publico (service_role key
// só no servidor, RLS das tabelas intacto) + /matriculas.json (arquivo estático
// público, sem necessidade de login).
//
// As CONTAS em si (calcularIndicadoresSemana, hhPorEquipamento/hhPorAtividade,
// calcularHhTecnico, ordemExecutadaAgrupada, calcularLinhaTempo) são as MESMAS funções
// puras de src/utils/ que a tela autenticada (manutencao-indicadores-semanais.
// component.ts) usa — nada de lógica de negócio duplicada/reescrita aqui, só a "cola"
// de sinais que monta os mesmos cards/gráficos a partir de dados buscados por fetch()
// em vez de services Angular. Por não ter AuthService em lugar nenhum deste arquivo,
// SessionTimeoutService nunca é iniciado pra quem abre este link (ele só arranca no
// effect() de app.component.ts que reage a authService.currentUser() — ver rota
// publico/* em app.routes.ts) — é isso que garante "sem timeout", mesmo com a tela
// aberta por horas.
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, WritableSignal, computed, effect, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoriaIndicador, ConsultaSigmaResultado, FeriasTecnico, ManutencaoOrdem } from '../../../models/manutencao-programacao.model';
import {
  CATEGORIAS_INDICADOR, CATEGORIA_LABEL, ContagemExecucao, IndicadorArea, IndicadoresSemana, META_ATENDIMENTO, META_CUMPRIMENTO,
  PISO_INDICE_META, StatusGeralSemana, TETO_INDICE_META, calcularIndicadoresSemana, indiceAtingimentoMeta,
} from '../../../utils/manutencao-indicadores';
import { LinhaTempoGeometria, PontoLinhaTempo, calcularLinhaTempo, linhaRetaAreaPath, linhaRetaPath } from '../../../utils/relatorio-linha-tempo';
import { MESES_ABREV } from '../../../utils/relatorio-mensal-pcm';
import { HhAtividade, HhEquipamento, KpiExecucao, calcularHhTecnico, calcularKpiExecucao, hhPorAtividade, hhPorEquipamento, ordemExecutadaAgrupada } from '../../../utils/manutencao-dashboard';
import { encontrarFeriasNoIntervalo } from '../../../utils/manutencao-regras';
import {
  diasDaSemana, formatarDiaMes, formatarMesLabel, mesDaSemana, normalizarTexto, numeroSemanaISO,
  paraIso, segundaDaSemanaISO, segundaFeiraDe, semanasDoMes, somarContagem,
} from '../../../utils/manutencao-indicadores-periodo';
import { VisivelNaTelaDirective } from './visivel-na-tela.directive';

// Mesmo shape de Colaborador/Apontamento.Colaborador (src/services/apontamentos.
// service.ts) — redeclarado aqui pra não importar o service (que traz AuthService/
// Supabase atrás) só por um tipo.
interface Colaborador {
  nome: string;
  matricula: string;
  area: string;
  email: string;
  nomeNorm: string;
  disponibilidade: number;
  disponibilidade_pos_corte?: number;
}

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

// Item do histórico importado (planilha "Painel de Indicadores de PCM") — só os campos
// que esta tela de fato lê (o endpoint público não devolve quem importou/quando, não é
// relevante pra quem só está vendo o painel).
interface HistoricoItemPublico {
  semanaInicio: string;
  categoria: CategoriaIndicador | 'GERAL';
  programadas: number;
  executadas: number;
  naoExecutadas: number;
  planejadasPlano: number;
  executadasPlano: number;
  naoExecutadasPlano: number;
  atendimento: number;
  cumprimento: number;
}

// Ícones de linha simples — mesmo conjunto de manutencao-indicadores-semanais.component.ts.
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

// Data de corte: mesmo valor de ApontamentosService (src/services/apontamentos.service.ts).
const CUTOFF_DISPONIBILIDADE = '2026-06-01';
const DISP_PADRAO = 6.5;

function disponibilidadeNoDia(colaborador: Colaborador, dataIso: string): number {
  return dataIso >= CUTOFF_DISPONIBILIDADE
    ? (colaborador.disponibilidade_pos_corte ?? colaborador.disponibilidade)
    : colaborador.disponibilidade;
}

// Mesma normalização de ApontamentosService.normalizar() — diferente de normalizarTexto
// (utils/manutencao-indicadores-periodo.ts), que não colapsa espaço/trim; aqui precisa
// bater exatamente com o que o resto do Portal usa pra casar nome<->matrícula.
function normalizarNome(v: string): string {
  return String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Porta de ApontamentosService.matchColaborador()/matchColaboradorDaOrdem() — mesmos
// critérios/ordem de fallback (matrícula exata -> parte numérica -> nome exato ->
// contém -> é contido -> todas as palavras aparecem), só que recebendo a lista de
// colaboradores por parâmetro em vez de via signal de service.
function matchColaborador(executante: string, colaboradores: Colaborador[]): Colaborador | null {
  if (!executante?.trim()) return null;
  const exec = executante.trim();

  const porMatricula = colaboradores.find(c => c.matricula === exec);
  if (porMatricula) return porMatricula;

  const numericPart = exec.replace(/\D+/g, '');
  if (numericPart.length >= 5) {
    const porNumerico = colaboradores.find(c => c.matricula === numericPart);
    if (porNumerico) return porNumerico;
  }

  const normExec = normalizarNome(exec);
  let found = colaboradores.find(c => c.nomeNorm === normExec);
  if (found) return found;

  found = colaboradores.find(c => normExec.includes(c.nomeNorm));
  if (found) return found;

  found = colaboradores.find(c => c.nomeNorm.includes(normExec));
  if (found) return found;

  const partesExec = normExec.split(/\s+/).filter(p => p.length > 3);
  if (partesExec.length >= 2) {
    found = colaboradores.find(c => partesExec.every(p => c.nomeNorm.includes(p)));
    if (found) return found;
  }

  return null;
}

function matchColaboradorDaOrdem(matricula: string | null | undefined, nome: string, colaboradores: Colaborador[]): Colaborador | null {
  const mat = matricula?.trim();
  if (mat) {
    const porMatricula = colaboradores.find(c => c.matricula === mat);
    if (porMatricula) return porMatricula;
  }
  return matchColaborador(nome, colaboradores);
}

// Preenche os campos que o endpoint público não devolve (não usados por nenhum
// cálculo desta tela: recursos/LOTO/observações/autoria/checklist) com null/vazio —
// só pra satisfazer o tipo ManutencaoOrdem, que as funções puras de manutencao-
// dashboard.ts/manutencao-indicadores.ts exigem completo.
interface OrdemPublicaRaw {
  id: string; tipo: ManutencaoOrdem['tipo']; area: ManutencaoOrdem['area']; categoriaIndicador: CategoriaIndicador | null;
  semanaInicio: string; numeroOs: string | null; semOs: boolean; descricao: string; equipamento: string | null;
  duracaoHoras: number | null; tipoServico: string | null; tecnicoNome: string; tecnicoMatricula: string | null;
  diasPrevistos: string[]; status: string; planoPreventivoId: string | null;
}
function paraManutencaoOrdem(r: OrdemPublicaRaw): ManutencaoOrdem {
  return {
    ...r,
    equipamentosRelacionados: null,
    recursos: null,
    loto: null,
    areaAtuacao: null,
    observacoes: null,
    reuniaoHorario: null,
    reuniaoLocal: null,
    checklist: null,
    criadoPorId: null,
    criadoPorNome: '',
    createdAt: new Date(0),
  };
}

const INTERVALO_POLL_MS = 3 * 60 * 1000;

// Reload completo da página (não só reconsulta de dados) — pensado pra essa tela ficar
// aberta num monitor do setor por horas/dias: sem isso, a aba nunca pega um deploy novo
// (é uma SPA, o JS já carregado nunca muda sozinho) e o estado do navegador só cresce
// com o tempo. INTERVALO_POLL_MS continua cuidando dos dados a cada poucos minutos;
// isso aqui é só o "refresh de vez em quando" pedido pelo usuário, num intervalo bem
// mais espaçado.
const RELOAD_PAGINA_MS = 60 * 60 * 1000;

@Component({
  selector: 'app-manutencao-indicadores-publico',
  standalone: true,
  imports: [CommonModule, FormsModule, VisivelNaTelaDirective],
  templateUrl: './manutencao-indicadores-publico.component.html',
  styleUrl: './manutencao-indicadores-semanais.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoIndicadoresPublicoComponent implements OnInit, OnDestroy {
  readonly categoriaLabel = CATEGORIA_LABEL;
  readonly metaAtendimento = META_ATENDIMENTO;
  readonly metaCumprimento = META_CUMPRIMENTO;
  readonly icones = ICONES;
  errorMessage = signal('');
  carregando = signal(false);
  ultimaAtualizacaoEm = signal<Date | null>(null);
  private pollId: ReturnType<typeof setInterval> | null = null;
  private reloadId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => this.animarContador(this.indicadores().geral.atendimento, this.atendimentoAnimado));
    effect(() => this.animarContador(this.indicadores().cumprimentoPlano.atendimento, this.cumprimentoAnimado));
  }

  atendimentoAnimado = signal(0);
  cumprimentoAnimado = signal(0);

  // Mesmo fix de manutencao-indicadores-semanais.component.ts: leitura de destino()
  // precisa ser untracked (senão o effect que chama isto passa a depender do próprio
  // signal que ele escreve a cada frame — animação nunca converge).
  private animarContador(alvo: number, destino: WritableSignal<number>): void {
    const inicio = untracked(() => destino());
    if (Math.abs(inicio - alvo) < 0.05) { destino.set(alvo); return; }
    const duracaoMs = 900;
    const t0 = performance.now();
    const passo = (agora: number) => {
      const progresso = Math.min(1, (agora - t0) / duracaoMs);
      const suavizado = 1 - Math.pow(1 - progresso, 3);
      destino.set(Math.round((inicio + (alvo - inicio) * suavizado) * 10) / 10);
      if (progresso < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  // ── Dados brutos (fetch público, sem Bearer token) ──────────────────────────
  private ordensRaw = signal<ManutencaoOrdem[]>([]);
  private feriasRaw = signal<FeriasTecnico[]>([]);
  private historicoRaw = signal<HistoricoItemPublico[]>([]);
  private sigmaPorOsRaw = signal<Record<string, ConsultaSigmaResultado>>({});
  private colaboradoresRaw = signal<Colaborador[]>([]);

  async ngOnInit(): Promise<void> {
    try {
      const resp = await fetch('/matriculas.json');
      if (resp.ok) {
        const data = await resp.json() as Array<{ nome: string; matricula: string; area: string; email: string; disponibilidade?: number; disponibilidade_pos_corte?: number }>;
        this.colaboradoresRaw.set(data.map(d => ({
          nome: d.nome.trim(),
          matricula: String(d.matricula).trim(),
          area: d.area.trim(),
          email: d.email?.trim() ?? '',
          nomeNorm: normalizarNome(d.nome),
          disponibilidade: typeof d.disponibilidade === 'number' ? d.disponibilidade : DISP_PADRAO,
          disponibilidade_pos_corte: typeof d.disponibilidade_pos_corte === 'number' ? d.disponibilidade_pos_corte : undefined,
        })));
      }
    } catch {
      // Sem colaboradores, HH por técnico fica vazio — o resto da tela funciona normal.
    }
    await this.atualizar();
    this.pollId = setInterval(() => this.atualizar(), INTERVALO_POLL_MS);
    // Um setTimeout basta (não setInterval): o reload já reinicia a página inteira,
    // então um novo temporizador nasce sozinho na próxima carga.
    this.reloadId = setTimeout(() => location.reload(), RELOAD_PAGINA_MS);
  }

  ngOnDestroy(): void {
    if (this.pollId !== null) clearInterval(this.pollId);
    if (this.reloadId !== null) clearTimeout(this.reloadId);
  }

  async atualizar(): Promise<void> {
    this.carregando.set(true);
    try {
      const resp = await fetch('/api/indicadores-manutencao-publico');
      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) throw new Error(body?.error || 'Falha ao carregar os indicadores.');
      this.ordensRaw.set((body.ordens as OrdemPublicaRaw[]).map(paraManutencaoOrdem));
      this.feriasRaw.set(body.ferias as FeriasTecnico[]);
      this.historicoRaw.set(body.historico as HistoricoItemPublico[]);
      this.sigmaPorOsRaw.set(body.sigmaPorOs as Record<string, ConsultaSigmaResultado>);
      this.ultimaAtualizacaoEm.set(new Date());
      this.errorMessage.set('');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao carregar os indicadores.');
    } finally {
      this.carregando.set(false);
    }
  }

  private matchColaboradorFn = (matricula: string | null, nome: string) =>
    matchColaboradorDaOrdem(matricula, nome, this.colaboradoresRaw());

  // Ordens de um colaborador específico — casadas pela MATRÍCULA (via
  // matchColaboradorFn, que prioriza tecnicoMatricula e só cai pro nome como
  // fallback), nunca por `o.tecnicoNome === colaborador.nome` direto. Mesmo motivo já
  // documentado em chaveTecnico() da Programação: o texto de tecnicoNome pode ter sido
  // digitado com acento/typo diferente do cadastrado em matriculas.json mesmo com a
  // matrícula certa gravada — nome exato some ordens inteiras da conta.
  private ordensDoColaborador(ordens: ManutencaoOrdem[], colaborador: Colaborador): ManutencaoOrdem[] {
    return ordens.filter(o => this.matchColaboradorFn(o.tecnicoMatricula, o.tecnicoNome)?.matricula === colaborador.matricula);
  }

  // ── Toggle Semana / Mês — mesma ideia da tela autenticada ──
  modoPeriodo = signal<'semana' | 'mes'>('semana');

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

  semanaFiltro = signal((() => {
    const hojeIso = paraIso(segundaFeiraDe(new Date()));
    const minimoIso = paraIso(segundaDaSemanaISO(2026, 37));
    return hojeIso < minimoIso ? minimoIso : hojeIso;
  })());

  mesFiltro = signal((() => {
    const hojeMesIso = mesDaSemana(paraIso(segundaFeiraDe(new Date())));
    const mesMinimoIso = mesDaSemana(paraIso(segundaDaSemanaISO(2026, 37)));
    return hojeMesIso < mesMinimoIso ? mesMinimoIso : hojeMesIso;
  })());

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));

  tituloPagina = computed(() => this.modoPeriodo() === 'mes' ? 'Acompanhamento de Indicadores Mensais' : 'Acompanhamento de Indicadores Semanais');

  private semanasDoPeriodoSet = computed<Set<string>>(() =>
    this.modoPeriodo() === 'semana' ? new Set([this.semanaFiltro()]) : new Set(semanasDoMes(this.mesFiltro())));

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

  private ordensTipo = computed(() => this.ordensRaw().filter(o => o.tipo === 'ordem'));

  private ordensDaSemana = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.ordensTipo().filter(o => semanas.has(o.semanaInicio));
  });

  private ordensParaFechamento = computed(() =>
    this.ordensTipo().filter(o => o.area !== 'APOIO' || !!o.categoriaIndicador));

  sigmaPorOs = computed(() => this.sigmaPorOsRaw());

  indicadores = computed<IndicadoresSemana>(() => {
    const semanas = this.semanasDoPeriodoSet();
    return calcularIndicadoresSemana({
      ordens: this.ordensParaFechamento().filter(o => semanas.has(o.semanaInicio)),
      sigmaPorOs: this.sigmaPorOs(),
      matchColaborador: this.matchColaboradorFn,
    });
  });

  private ordemExecutadaAgrupadaLocal(ordens: ManutencaoOrdem[]): boolean[] {
    return ordemExecutadaAgrupada(ordens, this.sigmaPorOs(), this.matchColaboradorFn);
  }

  kpiCorretivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordemExecutadaAgrupadaLocal(this.ordensDaSemana().filter(o => o.tipoServico?.trim().toUpperCase() === 'CORRETIVA')).map(executada => ({ executada }))));

  kpiPreventivas = computed<KpiExecucao>(() =>
    calcularKpiExecucao(this.ordemExecutadaAgrupadaLocal(this.ordensDaSemana().filter(o => o.tipoServico?.trim().toUpperCase() === 'PREVENTIVA')).map(executada => ({ executada }))));

  qtdExames = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.ordensRaw().filter(o => semanas.has(o.semanaInicio) && o.tipo === 'exame_medico').length;
  });
  qtdFolgas = computed(() => {
    const semanas = this.semanasDoPeriodoSet();
    return this.ordensRaw().filter(o => semanas.has(o.semanaInicio) && o.tipo === 'folga').length;
  });

  private hhPorEquipamentoTodos = computed<HhEquipamento[]>(() => hhPorEquipamento(this.ordensDaSemana()));
  hhPorEquipamentoTop10 = computed(() => this.hhPorEquipamentoTodos().slice(0, 10));
  hhPorEquipamentoMax = computed(() => this.hhPorEquipamentoTop10()[0]?.horas ?? 0);

  private hhPorAtividadeTodos = computed<HhAtividade[]>(() => hhPorAtividade(this.ordensDaSemana()));
  hhPorAtividadeTop3 = computed(() => this.hhPorAtividadeTodos().slice(0, 3));
  hhPorAtividadeMax = computed(() => this.hhPorAtividadeTop3()[0]?.horas ?? 0);

  private tecnicosParaHh = computed(() =>
    this.colaboradoresRaw().filter(c => {
      const t = normalizarTexto(c.area);
      return t.includes('ELETR') || t.includes('MECAN');
    }));

  hhTotais = computed(() => {
    const ferias = this.feriasRaw();
    const ordensTodas = this.ordensRaw();
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
          disponibilidadePorDia: new Map(dias.map(d => [d.data, disponibilidadeNoDia(colaborador, d.data)])),
          diasFolga: new Set(ordensDoTecnico.filter(o => o.tipo === 'folga').flatMap(o => o.diasPrevistos)),
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

  private readonly NOMES_EXCLUIDOS_HORAS = new Set(['JOAQUIM NETO']);

  private tecnicosEletrica = computed(() =>
    this.colaboradoresRaw().filter(c => normalizarTexto(c.area).includes('ELETR') && !this.NOMES_EXCLUIDOS_HORAS.has(normalizarTexto(c.nome))));
  private tecnicosMecanica = computed(() =>
    this.colaboradoresRaw().filter(c => normalizarTexto(c.area).includes('MECAN') && !this.NOMES_EXCLUIDOS_HORAS.has(normalizarTexto(c.nome))));

  private calcularHorasPorTecnico(tecnicos: Colaborador[]): HorasTecnicoItem[] {
    const ferias = this.feriasRaw();
    const ordensTodas = this.ordensRaw();
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
          const [executada] = ordemExecutadaAgrupada([o], sigmaPorOs, this.matchColaboradorFn);
          if (executada) item.horasApontadas += horas;
        }
        const r = calcularHhTecnico({
          dias,
          disponibilidadePorDia: new Map(dias.map(d => [d.data, disponibilidadeNoDia(item.colaborador, d.data)])),
          diasFolga: new Set(ordensDoTecnico.filter(o => o.tipo === 'folga').flatMap(o => o.diasPrevistos)),
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

  percentualBarraHoras(valor: number, disponivel: number): number {
    return disponivel > 0 ? Math.min(100, Math.round((valor / disponivel) * 100)) : 0;
  }

  imprimir(): void {
    window.print();
  }

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
      { titulo: 'Atendimento à Programação', valor: `${ano.geral.atendimento}%`, meta: `${ano.geral.executadas} de ${ano.geral.programadas} executadas no ano · Meta: ${this.metaAtendimento}% · Índice: ${this.indiceAtendimentoAno()}%`, cor: 'green', icone: 'check' },
      { titulo: 'Cumprimento do Plano', valor: `${ano.cumprimentoPlano.atendimento}%`, meta: `${ano.cumprimentoPlano.executadas} de ${ano.cumprimentoPlano.programadas} planejadas do Plano · Meta: ${this.metaCumprimento}% · Índice: ${this.indiceCumprimentoAno()}%`, cor: 'blue', icone: 'calendario' },
      { titulo: 'Status Geral do Ano', valor: this.statusAnoSimplificado(), cor: 'teal', icone: 'bandeira' },
    ];
  });

  // Índice de atingimento de meta (régua de 3 trechos da planilha de PLR do
  // Corporativo: piso 92% -> 75%, meta 95% -> 100%, teto 100% -> 125%, travado dali pra
  // cima) — aplicado aos dois indicadores acumulados do ano. Ver indiceAtingimentoMeta()
  // em manutencao-indicadores.ts pro detalhe da régua.
  indiceAtendimentoAno = computed(() =>
    indiceAtingimentoMeta(this.consolidadoAno().geral.atendimento, PISO_INDICE_META, this.metaAtendimento, TETO_INDICE_META));
  indiceCumprimentoAno = computed(() =>
    indiceAtingimentoMeta(this.consolidadoAno().cumprimentoPlano.atendimento, PISO_INDICE_META, this.metaCumprimento, TETO_INDICE_META));

  statusAnoSimplificado = computed(() => {
    const ano = this.consolidadoAno();
    return (ano.geral.atendimento >= this.metaAtendimento && ano.cumprimentoPlano.atendimento >= this.metaCumprimento)
      ? 'Acima da Meta' : 'Abaixo da Meta';
  });

  statusAnoCor = computed(() => this.statusAnoSimplificado() === 'Acima da Meta' ? '#4CAF50' : '#F44336');

  private semanasHistoricoIso = computed(() => {
    let fimIso: string;
    if (this.modoPeriodo() === 'mes') {
      const semanasDoMesAtual = semanasDoMes(this.mesFiltro());
      fimIso = semanasDoMesAtual[semanasDoMesAtual.length - 1] ?? this.semanaFiltro();
    } else {
      fimIso = this.semanaFiltro();
    }
    const minimoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const fimClamped = fimIso < minimoIso ? minimoIso : fimIso;
    const resultado: string[] = [];
    let cursor = new Date(minimoIso + 'T00:00:00');
    const fim = new Date(fimClamped + 'T00:00:00');
    while (cursor <= fim) {
      resultado.push(paraIso(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return resultado;
  });

  private mesesHistoricoIso = computed(() => [...new Set(this.semanasHistoricoIso().map(mesDaSemana))]);

  private indicadoresPorSemana = computed(() => {
    const sigmaPorOs = this.sigmaPorOs();
    const ordensTipo = this.ordensParaFechamento();
    return this.semanasHistoricoIso().map(semana => ({
      semana,
      indicadores: calcularIndicadoresSemana({
        ordens: ordensTipo.filter(o => o.semanaInicio === semana),
        sigmaPorOs,
        matchColaborador: this.matchColaboradorFn,
      }),
    }));
  });

  private indicadoresPorMes = computed(() => {
    const porMes = new Map<string, IndicadoresSemana[]>();
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      const mes = mesDaSemana(semana);
      const lista = porMes.get(mes);
      if (lista) lista.push(indicadores);
      else porMes.set(mes, [indicadores]);
    }
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 };
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

  private pontosEvolucaoGeral = computed<{ semana: string; atendimento: number; cumprimento: number }[]>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const mapa = new Map<string, { atendimento: number; cumprimento: number }>();
    for (const item of this.historicoRaw()) {
      if (item.categoria === 'GERAL' && item.semanaInicio < inicioAoVivoIso) mapa.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      mapa.set(semana, { atendimento: indicadores.geral.atendimento, cumprimento: indicadores.cumprimentoPlano.atendimento });
    }
    const ind = this.indicadores();
    mapa.set(this.semanaFiltro(), { atendimento: ind.geral.atendimento, cumprimento: ind.cumprimentoPlano.atendimento });
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, v]) => ({ semana, ...v }));
  });

  private pontosEvolucaoPorArea = computed<Map<CategoriaIndicador, Map<string, { atendimento: number; cumprimento: number }>>>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const resultado = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, { atendimento: number; cumprimento: number }>()]));
    for (const item of this.historicoRaw()) {
      if (item.categoria !== 'GERAL' && item.semanaInicio < inicioAoVivoIso) resultado.get(item.categoria)?.set(item.semanaInicio, { atendimento: item.atendimento, cumprimento: item.cumprimento });
    }
    for (const { semana, indicadores } of this.indicadoresPorSemana()) {
      for (const area of indicadores.porArea) {
        if (!area.categoria) continue;
        resultado.get(area.categoria)?.set(semana, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
      }
    }
    const semanaFiltro = this.semanaFiltro();
    for (const area of this.indicadores().porArea) {
      if (!area.categoria) continue;
      resultado.get(area.categoria)?.set(semanaFiltro, { atendimento: area.atendimento, cumprimento: area.cumprimentoPlano.atendimento });
    }
    return resultado;
  });

  private pontosEvolucaoGeralMensal = computed<{ mes: string; atendimento: number; cumprimento: number }[]>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 };
    const geralPorMes = new Map<string, ContagemExecucao>();
    const planoPorMes = new Map<string, ContagemExecucao>();
    for (const item of this.historicoRaw()) {
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
    const ind = this.indicadores();
    mapa.set(this.mesFiltro(), { atendimento: ind.geral.atendimento, cumprimento: ind.cumprimentoPlano.atendimento });
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, v]) => ({ mes, ...v }));
  });

  private pontosEvolucaoPorAreaMensal = computed<Map<CategoriaIndicador, Map<string, { atendimento: number; cumprimento: number }>>>(() => {
    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 };
    const geralPorCategoria = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, ContagemExecucao>()]));
    const planoPorCategoria = new Map(CATEGORIAS_INDICADOR.map(c => [c, new Map<string, ContagemExecucao>()]));
    for (const item of this.historicoRaw()) {
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

  private enriquecerGeometria(geo: LinhaTempoGeometria | null, pontos: PontoLinhaTempo[]) {
    if (!geo) return null;
    const baseY = geo.altura - geo.margem.baixo;
    const ultimo = pontos[pontos.length - 1];
    return {
      ...geo,
      pathAtendimento: linhaRetaPath(geo.pontosAtendimento),
      pathCumprimento: linhaRetaPath(geo.pontosCumprimento),
      areaAtendimento: linhaRetaAreaPath(geo.pontosAtendimento, baseY),
      ultimoAtendimento: ultimo ? Math.round(ultimo.atendimento) : null,
      ultimoCumprimento: ultimo ? Math.round(ultimo.cumprimento) : null,
    };
  }

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

  consolidadoAno = computed<IndicadoresSemana>(() => {
    const anoAtual = new Date().getFullYear();
    const semanasAoVivoDoAno = new Set(this.semanasHistoricoIso().filter(s => Number(s.slice(0, 4)) === anoAtual));

    const aoVivo = calcularIndicadoresSemana({
      ordens: this.ordensParaFechamento().filter(o => semanasAoVivoDoAno.has(o.semanaInicio)),
      sigmaPorOs: this.sigmaPorOs(),
      matchColaborador: this.matchColaboradorFn,
    });

    const inicioAoVivoIso = paraIso(segundaDaSemanaISO(2026, 37));
    const historicoDoAno = this.historicoRaw().filter(item =>
      Number(item.semanaInicio.slice(0, 4)) === anoAtual && item.semanaInicio < inicioAoVivoIso);

    const zero: ContagemExecucao = { programadas: 0, executadas: 0, naoExecutadas: 0, atendimento: 100 };
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

  statusCor(status: IndicadoresSemana['statusGeral']): string {
    if (status === 'Dentro da Meta') return '#4CAF50';
    if (status === 'Próximo da Meta') return '#FF9800';
    return '#F44336';
  }
}
