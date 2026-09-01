import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { ExcelExportService, ProgramacaoSemanalGrupo } from '../../../services/excel-export.service';
import { ConsultaSigmaResultado, ManutencaoArea, ManutencaoOrdem, ManutencaoTipo, SigmaBacklogItem } from '../../../models/manutencao-programacao.model';
import { EquipeApoio, Turno, TURNO_LABEL, turnoNoDia } from '../../../utils/escala-apoio';

type AreaFiltro = 'todos' | ManutencaoArea;

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

// Apoio programa por empresa/equipe (OPERAÇÃO, TOP ANDAIMES, SERVPLEX...), não por
// técnico individual — catálogo fixo carregado de public/equipes-apoio.json, mesmo
// padrão do catálogo de equipamentos.
interface OperadorEscala {
  nome: string;
  equipe: EquipeApoio;
}

const TIPO_LABEL: Record<ManutencaoTipo, string> = {
  ordem: 'Ordem de Serviço',
  folga: 'Folga',
  treinamento: 'Treinamento',
};
const TIPO_BADGE: Record<ManutencaoTipo, string> = {
  ordem: '',
  folga: 'bg-purple-100 text-purple-700',
  treinamento: 'bg-indigo-100 text-indigo-700',
};
// Linha inteira ganha um fundo leve pra folga/treinamento se destacarem das OS de
// verdade sem precisar ler cada célula.
const TIPO_LINHA_CLASSE: Record<ManutencaoTipo, string> = {
  ordem: '',
  folga: 'bg-purple-50/40',
  treinamento: 'bg-indigo-50/40',
};

// Status vem do SIGMA (texto livre, ver ManutencaoStatus) — só uns poucos códigos
// conhecidos ganham cor; qualquer outro cai no estilo neutro por padrão.
const STATUS_BADGE_CONHECIDOS: Record<string, string> = {
  PEND: 'bg-amber-100 text-amber-700',
  EXPA: 'bg-red-100 text-red-700',
  CONC: 'bg-green-100 text-green-700',
  CANC: 'bg-gray-200 text-gray-500',
};
const STATUS_BADGE_PADRAO = 'bg-slate-100 text-slate-600';

// "Natureza Manutenção" no SIGMA — as 3 opções que aparecem em toda versão da
// planilha. Igual status/LOTO: texto livre no banco, mas seletor fechado no formulário.
const TIPO_SERVICO_OPCOES = ['CORRETIVA', 'PREVENTIVA', 'MELHORIA'];
const TIPO_SERVICO_BADGE: Record<string, string> = {
  CORRETIVA: 'bg-red-50 text-red-600',
  PREVENTIVA: 'bg-blue-50 text-blue-600',
  MELHORIA: 'bg-purple-50 text-purple-600',
};
const TIPO_SERVICO_BADGE_PADRAO = 'bg-slate-50 text-slate-500';

// LOTO (bloqueio do equipamento) tem só essas 3 opções — é o que evita duas equipes
// baterem de frente (uma precisando do equipamento rodando, outra precisando parado).
const LOTO_OPCOES = ['LOTO', 'SEM LOTO', 'FUNCIONANDO'];
const LOTO_BADGE: Record<string, string> = {
  LOTO: 'bg-red-100 text-red-700',
  'SEM LOTO': 'bg-slate-100 text-slate-600',
  FUNCIONANDO: 'bg-green-100 text-green-700',
};
const LOTO_BADGE_PADRAO = 'bg-slate-50 text-slate-400';

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

function formatarDataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

function somaHoras(ordens: ManutencaoOrdem[]): number {
  return Math.round(ordens.reduce((soma, o) => soma + (o.duracaoHoras ?? 0), 0) * 100) / 100;
}

// Datas reais (não rótulos) da semana SEG–SEX a partir da segunda-feira ('YYYY-MM-DD').
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

// Mesma normalização usada em api/sigma-ordens-proxy.js — precisa bater pra achar a
// chave certa no resultado (o SIGMA usa número de OS com 6 dígitos e zero à esquerda).
function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

@Component({
  selector: 'app-manutencao-programacao',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-programacao.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoProgramacaoComponent implements OnInit {
  readonly areaLabel = AREA_LABEL;
  readonly lotoOpcoes = LOTO_OPCOES;
  readonly tipoServicoOpcoes = TIPO_SERVICO_OPCOES;
  readonly tipoLabel = TIPO_LABEL;
  private readonly tiposFormPadrao: ManutencaoTipo[] = ['ordem', 'folga', 'treinamento'];
  // Apoio programa por empresa/equipe, não por pessoa — folga/treinamento não fazem
  // sentido nesse contexto, só "ordem" fica disponível.
  tiposForm = computed<ManutencaoTipo[]>(() => this.areaFixa === 'APOIO' ? ['ordem'] : this.tiposFormPadrao);

  statusBadgeClass(status: string): string {
    return STATUS_BADGE_CONHECIDOS[status.toUpperCase()] ?? STATUS_BADGE_PADRAO;
  }

  lotoBadgeClass(loto: string): string {
    return LOTO_BADGE[loto.toUpperCase()] ?? LOTO_BADGE_PADRAO;
  }

  tipoServicoBadgeClass(tipoServico: string): string {
    return TIPO_SERVICO_BADGE[tipoServico.toUpperCase()] ?? TIPO_SERVICO_BADGE_PADRAO;
  }

  tipoBadgeClass(tipo: ManutencaoTipo): string {
    return TIPO_BADGE[tipo];
  }

  linhaClasse(tipo: ManutencaoTipo): string {
    return TIPO_LINHA_CLASSE[tipo];
  }

  conflitoLotoTitle(itens: { status: string; descricao: string; tecnico: string }[]): string {
    return `Conflito: ${itens.map(i => `${i.status} (${i.tecnico} — ${i.descricao})`).join(' vs. ')}`;
  }

  // Dias previstos formatados pro Excel (ex.: "SEG, QUA, SEX") — mesma lógica das
  // pastilhas SEG–SEX da tela, só que como texto pra caber numa célula.
  private diasFormatados(o: ManutencaoOrdem): string {
    return this.diasDaSemanaAtual()
      .filter(d => o.diasPrevistos.includes(d.data))
      .map(d => d.label)
      .join(', ');
  }

  exportarSemana(): void {
    const grupos: ProgramacaoSemanalGrupo[] = this.grupos().map(g => ({
      tecnico: g.tecnico,
      totalHoras: g.totalHoras,
      linhas: g.ordens.map(o => ({
        numeroOs: o.tipo !== 'ordem' ? this.tipoLabel[o.tipo] : (o.numeroOs || 'CRIAR OS'),
        descricao: o.descricao,
        equipamento: o.equipamento || '—',
        area: this.areaLabel[o.area],
        areaAtuacao: o.areaAtuacao || '—',
        loto: o.loto || '—',
        tipoServico: o.tipoServico || '—',
        duracaoHoras: o.duracaoHoras,
        dias: this.diasFormatados(o) || '—',
        status: o.tipo === 'ordem' ? o.status : '—',
      })),
    }));

    if (grupos.length === 0) {
      this.notificationService.showError('Nenhum lançamento na semana selecionada pra exportar.');
      return;
    }

    this.excelExportService.exportarProgramacaoSemanal({
      semanaLabel: this.semanaFiltroLabel(),
      areaLabel: this.areaFixa ? this.areaLabel[this.areaFixa] : 'Elétrica + Mecânica',
      grupos,
    });
  }

  errorMessage = signal('');
  isProcessando = signal(false);

  // Grupos (técnico ou dia, conforme a tela) começam todos abertos — só entra no mapa
  // quem foi fechado manualmente, então trocar de semana/filtro não perde estado à toa.
  private gruposFechados = signal<Record<string, boolean>>({});

  isGrupoExpandido(chave: string): boolean {
    return !this.gruposFechados()[chave];
  }

  toggleGrupo(chave: string): void {
    this.gruposFechados.update(atual => ({ ...atual, [chave]: !atual[chave] }));
  }

  recolherTodos(chaves: string[]): void {
    const novo: Record<string, boolean> = {};
    for (const c of chaves) novo[c] = true;
    this.gruposFechados.set(novo);
  }

  expandirTodos(): void {
    this.gruposFechados.set({});
  }

  // Filtros
  readonly semanas = (() => {
    const result: { value: string; label: string }[] = [];
    const hojeSegunda = segundaFeiraDe(new Date());
    for (let i = -1; i < 10; i++) {
      const inicio = new Date(hojeSegunda);
      inicio.setDate(inicio.getDate() - i * 7);
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 6);
      result.push({ value: paraIso(inicio), label: `${formatarDiaMes(inicio)} a ${formatarDiaMes(fim)}` });
    }
    return result;
  })();

  semanaFiltro = signal(paraIso(segundaFeiraDe(new Date())));
  areaFiltro = signal<AreaFiltro>('todos');
  statusFiltro = signal<'todos' | string>('todos');
  tecnicoFiltro = signal<'todos' | string>('todos');
  searchTerm = signal('');

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));
  semanaFiltroLabel = computed(() => this.semanas.find(s => s.value === this.semanaFiltro())?.label ?? this.semanaFiltro());

  isLoading = this.manutencaoService.isLoading;
  currentUser = this.authService.currentUser;
  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  ordensDaSemana = computed(() =>
    this.manutencaoService.ordens().filter(o => o.semanaInicio === this.semanaFiltro()),
  );

  listaFiltrada = computed(() => {
    const area = this.areaFiltro();
    const status = this.statusFiltro();
    const tecnico = this.tecnicoFiltro();
    const termo = this.searchTerm().trim().toLowerCase();

    return this.ordensDaSemana().filter(o => {
      if (area !== 'todos' && o.area !== area) return false;
      if (status !== 'todos' && o.status !== status) return false;
      if (tecnico !== 'todos' && o.tecnicoNome !== tecnico) return false;
      if (termo) {
        const texto = `${o.numeroOs ?? ''} ${o.descricao} ${o.equipamento ?? ''} ${o.tecnicoNome}`.toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  });

  // Agrupada por técnico — usado nas telas de área única (mais perto do que a planilha
  // já mostra hoje, bloco por executante). Cada grupo já sai com a capacidade da semana
  // (Efetivo) calculada, pra comparar contra as horas já alocadas.
  grupos = computed(() => {
    const porTecnico = new Map<string, ManutencaoOrdem[]>();
    for (const o of this.listaFiltrada()) {
      const lista = porTecnico.get(o.tecnicoNome) ?? [];
      lista.push(o);
      porTecnico.set(o.tecnicoNome, lista);
    }
    return Array.from(porTecnico.entries())
      .map(([tecnico, ordens]) => {
        const totalHoras = somaHoras(ordens);
        const capacidade = this.capacidadeSemana(tecnico, ordens);
        const saldo = capacidade !== null ? parseFloat((capacidade - totalHoras).toFixed(2)) : null;
        return { tecnico, ordens, totalHoras, capacidade, saldo };
      })
      .sort((a, b) => a.tecnico.localeCompare(b.tecnico));
  });

  // Efetivo/capacidade: soma a disponibilidade cadastrada (matriculas.json, mesma fonte
  // do Relatório Mensal PCM) nos dias úteis da semana, descontando os dias em que o
  // técnico já tem folga/treinamento lançado. `null` quando o técnico não está no
  // matriculas.json (não dá pra saber a disponibilidade dele).
  private capacidadeSemana(tecnicoNome: string, ordensDoTecnico: ManutencaoOrdem[]): number | null {
    const colaborador = this.apontamentosService.colaboradores().find(c => c.nome === tecnicoNome);
    if (!colaborador) return null;

    const diasIndisponiveis = new Set(
      ordensDoTecnico.filter(o => o.tipo !== 'ordem').flatMap(o => o.diasPrevistos),
    );

    let total = 0;
    for (const dia of this.diasDaSemanaAtual()) {
      if (diasIndisponiveis.has(dia.data)) continue;
      total += this.apontamentosService.disponibilidadeNoDia(colaborador, dia.data);
    }
    return parseFloat(total.toFixed(2));
  }

  // Agrupada por dia — usado na tela geral (as duas áreas juntas), pra ver de cara
  // tudo que está programado pra cada dia da semana, cruzando Elétrica e Mecânica.
  // Uma OS com vários dias marcados aparece em cada um deles.
  gruposPorDia = computed(() => {
    const porDia = new Map<string, ManutencaoOrdem[]>();
    for (const o of this.listaFiltrada()) {
      for (const dia of o.diasPrevistos) {
        const lista = porDia.get(dia) ?? [];
        lista.push(o);
        porDia.set(dia, lista);
      }
    }
    const hojeIso = paraIso(new Date());
    return this.diasDaSemanaAtual().map(d => {
      const ordens = (porDia.get(d.data) ?? []).sort((a, b) => a.tecnicoNome.localeCompare(b.tecnicoNome));
      return {
        data: d.data,
        label: d.label,
        dataLabel: formatarDataCurta(d.data),
        ordens,
        totalHoras: somaHoras(ordens),
        hoje: d.data === hojeIso,
      };
    });
  });

  // OS sem nenhum dia marcado — não some da tela geral, fica numa seção à parte.
  ordensSemDia = computed(() => this.listaFiltrada().filter(o => o.diasPrevistos.length === 0));

  // Chaves de todos os grupos visíveis agora (técnico ou dia, conforme a tela) —
  // usado pelos botões "Expandir todos"/"Recolher todos".
  chavesGruposVisiveis = computed(() => {
    if (this.areaFixa) return this.grupos().map(g => `tec:${g.tecnico}`);
    const chaves = this.gruposPorDia().map(d => `dia:${d.data}`);
    if (this.ordensSemDia().length > 0) chaves.push('sem-dia');
    return chaves;
  });

  tecnicosComOrdemNaSemana = computed(() => {
    const nomes = new Set(this.ordensDaSemana().filter(o => this.areaFiltro() === 'todos' || o.area === this.areaFiltro()).map(o => o.tecnicoNome));
    return Array.from(nomes).sort();
  });

  // Status vem do SIGMA, sem lista fechada — o filtro mostra só os valores que
  // realmente aparecem na semana/área selecionada.
  statusesComOrdemNaSemana = computed(() => {
    const valores = new Set(this.ordensDaSemana().filter(o => this.areaFiltro() === 'todos' || o.area === this.areaFiltro()).map(o => o.status));
    return Array.from(valores).sort();
  });

  countTotal = computed(() => this.listaFiltrada().length);

  equipamentos = this.manutencaoService.equipamentos;

  // Catálogo fixo de equipes/empresas do Apoio (public/equipes-apoio.json) e a escala
  // de turno fixa da Operação (public/escala-apoio.json) — mesmo padrão estático já
  // usado pra equipamentos.json/matriculas.json.
  equipesApoio = signal<string[]>([]);
  escalaApoio = signal<OperadorEscala[]>([]);
  readonly turnoLabel = TURNO_LABEL;

  private async carregarDadosApoio(): Promise<void> {
    if (this.equipesApoio().length > 0 && this.escalaApoio().length > 0) return;
    try {
      const [respEquipes, respEscala] = await Promise.all([fetch('/equipes-apoio.json'), fetch('/escala-apoio.json')]);
      this.equipesApoio.set(await respEquipes.json());
      this.escalaApoio.set(await respEscala.json());
    } catch (err) {
      console.error('[ManutencaoProgramacaoComponent] Falha ao carregar dados do Apoio:', err);
    }
  }

  // Escala de turno (D/N/F) por equipe, pros dias da semana selecionada — calculada,
  // não editada manualmente (o rodízio de 8 dias é fixo, ver src/utils/escala-apoio.ts).
  escalaDaSemana = computed(() => {
    const dias = this.diasDaSemanaAtual();
    const porEquipe = new Map<EquipeApoio, OperadorEscala[]>();
    for (const op of this.escalaApoio()) {
      const lista = porEquipe.get(op.equipe) ?? [];
      lista.push(op);
      porEquipe.set(op.equipe, lista);
    }
    return (['A', 'B', 'C', 'D'] as EquipeApoio[])
      .filter(eq => porEquipe.has(eq))
      .map(equipe => ({
        equipe,
        integrantesLabel: porEquipe.get(equipe)!.map(i => i.nome).join(', '),
        turnos: dias.map(d => ({ data: d.data, label: d.label, turno: turnoNoDia(equipe, d.data) as Turno })),
      }));
  });

  // Backlog do SIGMA (OS abertas da área, ainda não lançadas aqui) — só faz sentido
  // nas telas de área única, porque o campo de área do SIGMA é por OS, não por semana.
  // Carrega sob demanda (painel fechado por padrão) pra não pagar o custo da primeira
  // consulta ao SIGMA (cache de ~10min no proxy) toda vez que a tela abre.
  backlogAberto = signal(false);
  backlogCarregando = signal(false);
  backlogErro = signal('');
  private backlogSigma = signal<SigmaBacklogItem[]>([]);

  private numerosOsJaProgramados = computed(() => {
    const area = this.areaFixa;
    if (!area) return new Set<string>();
    return new Set(
      this.manutencaoService.ordens()
        .filter(o => o.area === area && o.numeroOs?.trim())
        .map(o => normalizarNumeroOs(o.numeroOs!)),
    );
  });

  backlogFiltrado = computed(() => {
    const jaProgramados = this.numerosOsJaProgramados();
    return this.backlogSigma().filter(item => !jaProgramados.has(normalizarNumeroOs(item.numeroOs)));
  });

  async toggleBacklog(): Promise<void> {
    const abrir = !this.backlogAberto();
    this.backlogAberto.set(abrir);
    if (abrir && this.backlogSigma().length === 0) {
      await this.carregarBacklog();
    }
  }

  async carregarBacklog(): Promise<void> {
    if (!this.areaFixa || this.areaFixa === 'APOIO') return;
    this.backlogCarregando.set(true);
    this.backlogErro.set('');
    try {
      this.backlogSigma.set(await this.manutencaoService.consultarBacklogSigma(this.areaFixa));
    } catch (err: unknown) {
      this.backlogErro.set(err instanceof Error ? err.message : 'Erro ao consultar o backlog do SIGMA.');
    } finally {
      this.backlogCarregando.set(false);
    }
  }

  // Quadro de bloqueios (LOTO) por equipamento/dia — logo no topo da tela, pra
  // qualquer time ver antes de programar se o equipamento já está comprometido
  // num estado incompatível (ex.: uma equipe precisa dele rodando, outra parado).
  // Olha a semana inteira (as duas áreas juntas, ignora técnico/status/busca) —
  // o ponto é visibilidade cruzada entre equipes, não só o que o filtro atual mostra.
  // OS sem dia marcado é tratada como valendo a semana toda (mais seguro do que
  // simplesmente não aparecer no quadro).
  quadroLoto = computed(() => {
    const dias = this.diasDaSemanaAtual().map(d => d.data);
    const porEquipamento = new Map<string, Map<string, { status: string; descricao: string; tecnico: string; area: ManutencaoArea }[]>>();

    for (const o of this.ordensDaSemana()) {
      const equipamento = o.equipamento?.trim();
      const loto = o.loto?.trim();
      if (!equipamento || !loto) continue;

      const diasDaOrdem = o.diasPrevistos.length > 0 ? o.diasPrevistos.filter(d => dias.includes(d)) : dias;
      if (!porEquipamento.has(equipamento)) porEquipamento.set(equipamento, new Map());
      const porDia = porEquipamento.get(equipamento)!;
      for (const dia of diasDaOrdem) {
        const lista = porDia.get(dia) ?? [];
        lista.push({ status: loto, descricao: o.descricao, tecnico: o.tecnicoNome, area: o.area });
        porDia.set(dia, lista);
      }
    }

    return Array.from(porEquipamento.entries())
      .map(([equipamento, porDia]) => ({
        equipamento,
        dias: dias.map(dia => {
          const itens = porDia.get(dia) ?? [];
          const statusUnicos = new Set(itens.map(i => i.status.toUpperCase()));
          return { data: dia, itens, conflito: statusUnicos.size > 1 };
        }),
      }))
      // "Sem LOTO" é o estado padrão/sem novidade — só vale a pena aparecer no
      // quadro o equipamento que tem algo realmente pra observar (bloqueio,
      // funcionando marcado, ou conflito entre equipes).
      .filter(linha => linha.dias.some(d => d.conflito || d.itens.some(i => i.status.toUpperCase() !== 'SEM LOTO')))
      .sort((a, b) => a.equipamento.localeCompare(b.equipamento));
  });

  // ── Modal: criar/editar OS ─────────────────────────────────────────────
  formAberto = signal(false);
  formIdEdicao = signal<string | null>(null);
  formTipo = signal<ManutencaoTipo>('ordem');
  formArea = signal<ManutencaoArea>('ELETRICA');
  formNumeroOs = signal('');
  formDescricao = signal('');
  formEquipamento = signal('');
  formRecursos = signal('');
  formLoto = signal('');
  formAreaAtuacao = signal('');
  formDuracaoHoras = signal<number | null>(null);
  formTipoServico = signal('');
  formTecnicoNome = signal('');
  formTecnicoMatricula = signal('');
  formDiasSelecionados = signal<string[]>([]);
  formStatus = signal('PEND');
  formObservacoes = signal('');
  buscandoOsNoSigma = signal(false);

  tecnicosDaAreaForm = computed(() => this.tecnicosPorArea(this.formArea()));

  // ── Integração com o SIGMA (mesmos links que a planilha "Fechamento Semanal.2"
  // usa via Power Query) — preenche a descrição sozinha ao informar o número da OS, e
  // confere se ela já foi apontada (executada) dentro da semana programada. Best-effort:
  // se o SIGMA estiver fora do ar, a tela continua funcionando normalmente, só sem esse
  // preenchimento/validação.
  sigmaPorOs = signal<Record<string, ConsultaSigmaResultado>>({});

  private numerosOsVisiveis = computed(() =>
    [...new Set(this.ordensDaSemana().map(o => o.numeroOs).filter((n): n is string => !!n?.trim()))],
  );

  // Telas separadas por área (/manutencao/programacao/eletrica ou /mecanica) travam o
  // filtro nessa área e escondem o seletor; a rota combinada (/manutencao/programacao,
  // sem "area" nos dados da rota) mostra as duas juntas com o seletor liberado. O
  // quadro de LOTO continua mostrando as duas áreas sempre, mesmo nas telas travadas —
  // é justamente aí que mora o conflito entre equipes.
  areaFixa: ManutencaoArea | null = null;
  pageTitle = 'Programação de Manutenção';

  constructor(
    private route: ActivatedRoute,
    private manutencaoService: ManutencaoProgramacaoService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private apontamentosService: ApontamentosService,
    private excelExportService: ExcelExportService,
  ) {
    const area = this.route.snapshot.data['area'] as ManutencaoArea | undefined;
    if (area) {
      this.areaFixa = area;
      this.areaFiltro.set(area);
      this.pageTitle = `Programação ${AREA_LABEL[area]}`;
    }

    // Refaz a consulta ao SIGMA sempre que a lista de OS visíveis na semana mudar
    // (troca de semana, nova OS criada, número de OS editado etc.).
    effect(() => {
      const numeros = this.numerosOsVisiveis();
      if (numeros.length === 0) return;
      this.buscarExecucaoSigma(numeros);
    });
  }

  private async buscarExecucaoSigma(numeros: string[]): Promise<void> {
    try {
      const resultado = await this.manutencaoService.consultarOrdensSigma(numeros);
      this.sigmaPorOs.update(atual => ({ ...atual, ...resultado }));
    } catch {
      // Consulta best-effort — falha do SIGMA não deve travar a tela de programação.
    }
  }

  // Selo de execução por OS, pra saber se ela já foi apontada (executada) dentro da
  // semana programada, ou fora dela, ou ainda nem apontada. `null` = ou não tem número
  // de OS pra checar, ou a consulta ao SIGMA ainda não voltou.
  statusExecucao(o: ManutencaoOrdem): { label: string; class: string; title: string } | null {
    if (!o.numeroOs?.trim()) return null;
    const resultado = this.sigmaPorOs()[normalizarNumeroOs(o.numeroOs)];
    if (!resultado) return null;

    if (resultado.apontamentos.length === 0) {
      return { label: 'Não executada', class: 'bg-gray-100 text-gray-500', title: 'Nenhum apontamento encontrado no SIGMA pra essa OS.' };
    }

    const diasDaSemana = o.diasPrevistos.length > 0 ? o.diasPrevistos : this.diasDaSemanaAtual().map(d => d.data);
    const dentroDaSemana = resultado.apontamentos.filter(a => diasDaSemana.includes(a.data));
    if (dentroDaSemana.length > 0) {
      return {
        label: 'Executada', class: 'bg-green-100 text-green-700',
        title: `Apontada em: ${dentroDaSemana.map(a => a.data).join(', ')}`,
      };
    }
    return {
      label: 'Fora da semana', class: 'bg-amber-100 text-amber-700',
      title: `Apontada fora da semana programada, em: ${resultado.apontamentos.map(a => a.data).join(', ')}`,
    };
  }

  // ── Buscar descrição da OS no SIGMA ao sair do campo "Número da OS" ───
  async buscarDescricaoDaOs(): Promise<void> {
    const numero = this.formNumeroOs().trim();
    if (!numero) return;

    this.buscandoOsNoSigma.set(true);
    try {
      const resultado = await this.manutencaoService.consultarOrdensSigma([numero]);
      const info = resultado[normalizarNumeroOs(numero)]?.os;
      if (!info) {
        this.notificationService.showError(`OS ${numero} não encontrada no SIGMA — confira o número ou preencha manualmente.`);
        return;
      }
      if (!this.formDescricao().trim()) this.formDescricao.set(info.descricao);
      if (!this.formEquipamento().trim() && this.equipamentos().includes(info.equipamento)) {
        this.formEquipamento.set(info.equipamento);
      }
      if (!this.formTipoServico().trim() && this.tipoServicoOpcoes.includes(info.tipoServico)) {
        this.formTipoServico.set(info.tipoServico);
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao consultar a OS no SIGMA.');
    } finally {
      this.buscandoOsNoSigma.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.manutencaoService.load();
      await this.apontamentosService.loadColaboradores();
      await this.manutencaoService.loadEquipamentos();
      if (this.areaFixa === 'APOIO') await this.carregarDadosApoio();
    } catch {
      this.errorMessage.set('Erro ao carregar a programação de manutenção.');
    }
  }

  private tecnicosPorArea(area: ManutencaoArea): { nome: string; matricula: string | null }[] {
    if (area === 'APOIO') {
      return this.equipesApoio().map(nome => ({ nome, matricula: null }));
    }
    const termo = area === 'ELETRICA' ? 'ELETR' : 'MECAN';
    return this.apontamentosService.colaboradores()
      .filter(c => normalizarTexto(c.area).includes(termo))
      .map(c => ({ nome: c.nome, matricula: c.matricula }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // Todos os técnicos das duas áreas (Elétrica + Mecânica) — usado no lançamento de
  // feriado, que vale pra equipe toda. Apoio fica de fora (folga é um conceito por
  // pessoa, e lá quem aparece é empresa/equipe).
  todosTecnicos = computed(() => [
    ...this.tecnicosPorArea('ELETRICA').map(c => ({ nome: c.nome, matricula: c.matricula, area: 'ELETRICA' as ManutencaoArea })),
    ...this.tecnicosPorArea('MECANICA').map(c => ({ nome: c.nome, matricula: c.matricula, area: 'MECANICA' as ManutencaoArea })),
  ]);

  // ── Feriado (folga em lote pra toda a equipe) ─────────────────────────
  feriadoAberto = signal(false);
  feriadoDiasSelecionados = signal<string[]>([]);
  feriadoMotivo = signal('Feriado');

  abrirFeriado(): void {
    this.feriadoDiasSelecionados.set([]);
    this.feriadoMotivo.set('Feriado');
    this.feriadoAberto.set(true);
  }

  fecharFeriado(): void {
    this.feriadoAberto.set(false);
  }

  toggleDiaFeriado(dataIso: string): void {
    const atual = this.feriadoDiasSelecionados();
    this.feriadoDiasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  canConfirmarFeriado(): boolean {
    return this.feriadoDiasSelecionados().length > 0 && this.todosTecnicos().length > 0 && !this.isProcessando();
  }

  async confirmarFeriado(): Promise<void> {
    if (!this.canConfirmarFeriado()) return;
    const tecnicos = this.todosTecnicos();
    const motivo = this.feriadoMotivo().trim() || 'Feriado';
    if (!confirm(`Lançar "${motivo}" pra ${tecnicos.length} técnicos (Elétrica + Mecânica)?`)) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarFolgaEmLote({
        diasPrevistos: this.feriadoDiasSelecionados(),
        motivo,
        tecnicos,
      });
      this.notificationService.showSuccess(`"${motivo}" lançado pra ${tecnicos.length} técnicos.`);
      this.fecharFeriado();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao lançar feriado.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Criar/Editar OS ────────────────────────────────────────────────────
  abrirCriar(): void {
    this.formIdEdicao.set(null);
    this.formTipo.set('ordem');
    const area = this.areaFiltro();
    this.formArea.set(area !== 'todos' ? area : 'ELETRICA');
    this.formNumeroOs.set('');
    this.formDescricao.set('');
    this.formEquipamento.set('');
    this.formRecursos.set('');
    this.formLoto.set('');
    this.formAreaAtuacao.set('');
    this.formDuracaoHoras.set(null);
    this.formTipoServico.set('');
    this.formTecnicoNome.set('');
    this.formTecnicoMatricula.set('');
    this.formDiasSelecionados.set([]);
    this.formStatus.set('PEND');
    this.formObservacoes.set('');
    this.formAberto.set(true);
  }

  // Abre "Novo lançamento" já preenchido a partir de um item do backlog do SIGMA —
  // poupa digitar o número da OS e esperar a busca (blur) que abrirCriar() + digitação
  // manual exigiriam.
  programarDoBacklog(item: SigmaBacklogItem): void {
    this.abrirCriar();
    this.formNumeroOs.set(item.numeroOs);
    this.formDescricao.set(item.descricao);
    if (this.equipamentos().includes(item.equipamento)) this.formEquipamento.set(item.equipamento);
    if (this.tipoServicoOpcoes.includes(item.tipoServico)) this.formTipoServico.set(item.tipoServico);
  }

  abrirEditar(o: ManutencaoOrdem): void {
    this.formIdEdicao.set(o.id);
    this.formTipo.set(o.tipo);
    this.formArea.set(o.area);
    this.formNumeroOs.set(o.numeroOs ?? '');
    this.formDescricao.set(o.descricao);
    this.formEquipamento.set(o.equipamento ?? '');
    this.formRecursos.set(o.recursos ?? '');
    this.formLoto.set(o.loto ?? '');
    this.formTipoServico.set(o.tipoServico ?? '');
    this.formAreaAtuacao.set(o.areaAtuacao ?? '');
    this.formDuracaoHoras.set(o.duracaoHoras);
    this.formTecnicoNome.set(o.tecnicoNome);
    this.formTecnicoMatricula.set(o.tecnicoMatricula ?? '');
    this.formDiasSelecionados.set([...o.diasPrevistos]);
    this.formStatus.set(o.status);
    this.formObservacoes.set(o.observacoes ?? '');
    this.formAberto.set(true);
  }

  fecharForm(): void {
    this.formAberto.set(false);
  }

  onTecnicoSelected(nome: string): void {
    this.formTecnicoNome.set(nome);
    const colaborador = this.tecnicosDaAreaForm().find(c => c.nome === nome);
    this.formTecnicoMatricula.set(colaborador?.matricula ?? '');
  }

  toggleDia(dataIso: string): void {
    const atual = this.formDiasSelecionados();
    this.formDiasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  // Descrição some pra folga/treinamento se a pessoa não digitar nada — usa o
  // próprio nome do tipo ("Folga", "Treinamento") em vez de obrigar a preencher.
  private descricaoParaEnvio(): string {
    return this.formDescricao().trim() || TIPO_LABEL[this.formTipo()];
  }

  canConfirmarForm(): boolean {
    if (this.isProcessando() || !this.formTecnicoNome().trim()) return false;
    if (this.formTipo() === 'ordem') {
      return !!this.formDescricao().trim() && !!this.formLoto();
    }
    // Folga/treinamento: precisa de pelo menos um dia marcado, senão não diz nada.
    return this.formDiasSelecionados().length > 0;
  }

  async confirmarForm(): Promise<void> {
    if (!this.canConfirmarForm()) return;
    this.isProcessando.set(true);
    try {
      const tipo = this.formTipo();
      const ehOrdem = tipo === 'ordem';
      const idEdicao = this.formIdEdicao();
      if (idEdicao) {
        await this.manutencaoService.editarOrdem(idEdicao, {
          tipo,
          area: this.formArea(),
          numeroOs: ehOrdem ? (this.formNumeroOs().trim() || null) : null,
          descricao: this.descricaoParaEnvio(),
          equipamento: ehOrdem ? (this.formEquipamento().trim() || null) : null,
          recursos: ehOrdem ? (this.formRecursos().trim() || null) : null,
          loto: ehOrdem ? (this.formLoto().trim() || null) : null,
          areaAtuacao: ehOrdem ? (this.formAreaAtuacao().trim() || null) : null,
          duracaoHoras: ehOrdem ? this.formDuracaoHoras() : null,
          tipoServico: ehOrdem ? (this.formTipoServico().trim() || null) : null,
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || null,
          diasPrevistos: this.formDiasSelecionados(),
          status: ehOrdem ? (this.formStatus().trim() || 'PEND') : '',
          observacoes: this.formObservacoes().trim() || null,
        });
        this.notificationService.showSuccess(`${TIPO_LABEL[tipo]} atualizada.`);
      } else {
        await this.manutencaoService.criarOrdem({
          tipo,
          area: this.formArea(),
          semanaInicio: this.semanaFiltro(),
          numeroOs: ehOrdem ? (this.formNumeroOs().trim() || undefined) : undefined,
          descricao: this.descricaoParaEnvio(),
          equipamento: ehOrdem ? (this.formEquipamento().trim() || undefined) : undefined,
          recursos: ehOrdem ? (this.formRecursos().trim() || undefined) : undefined,
          loto: ehOrdem ? (this.formLoto().trim() || undefined) : undefined,
          areaAtuacao: ehOrdem ? (this.formAreaAtuacao().trim() || undefined) : undefined,
          duracaoHoras: ehOrdem ? (this.formDuracaoHoras() ?? undefined) : undefined,
          tipoServico: ehOrdem ? (this.formTipoServico().trim() || undefined) : undefined,
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || undefined,
          diasPrevistos: this.formDiasSelecionados(),
          status: ehOrdem ? (this.formStatus().trim() || undefined) : undefined,
          observacoes: this.formObservacoes().trim() || undefined,
        });
        this.notificationService.showSuccess(`${TIPO_LABEL[tipo]} adicionada à programação.`);
      }
      this.fecharForm();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao salvar OS.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Excluir ────────────────────────────────────────────────────────────
  async excluir(o: ManutencaoOrdem): Promise<void> {
    if (this.isProcessando()) return;
    if (!confirm(`Excluir "${o.descricao}" (${o.tecnicoNome})?\n\nEsta ação não pode ser desfeita.`)) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluir(o.id);
      this.notificationService.showSuccess('Excluído.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
