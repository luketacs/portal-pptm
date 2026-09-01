import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { ApontamentosService, Colaborador } from '../../../services/apontamentos.service';
import { ConsultaSigmaResultado, ManutencaoArea, ManutencaoOrdem } from '../../../models/manutencao-programacao.model';

type AreaFiltro = 'todos' | ManutencaoArea;

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
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

  statusBadgeClass(status: string): string {
    return STATUS_BADGE_CONHECIDOS[status.toUpperCase()] ?? STATUS_BADGE_PADRAO;
  }

  lotoBadgeClass(loto: string): string {
    return LOTO_BADGE[loto.toUpperCase()] ?? LOTO_BADGE_PADRAO;
  }

  conflitoLotoTitle(itens: { status: string; descricao: string; tecnico: string }[]): string {
    return `Conflito: ${itens.map(i => `${i.status} (${i.tecnico} — ${i.descricao})`).join(' vs. ')}`;
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
  // já mostra hoje, bloco por executante).
  grupos = computed(() => {
    const porTecnico = new Map<string, ManutencaoOrdem[]>();
    for (const o of this.listaFiltrada()) {
      const lista = porTecnico.get(o.tecnicoNome) ?? [];
      lista.push(o);
      porTecnico.set(o.tecnicoNome, lista);
    }
    return Array.from(porTecnico.entries())
      .map(([tecnico, ordens]) => ({ tecnico, ordens, totalHoras: somaHoras(ordens) }))
      .sort((a, b) => a.tecnico.localeCompare(b.tecnico));
  });

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
      .sort((a, b) => a.equipamento.localeCompare(b.equipamento));
  });

  // ── Modal: criar/editar OS ─────────────────────────────────────────────
  formAberto = signal(false);
  formIdEdicao = signal<string | null>(null);
  formArea = signal<ManutencaoArea>('ELETRICA');
  formNumeroOs = signal('');
  formDescricao = signal('');
  formEquipamento = signal('');
  formRecursos = signal('');
  formLoto = signal('');
  formAreaAtuacao = signal('');
  formDuracaoHoras = signal<number | null>(null);
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
    } catch {
      this.errorMessage.set('Erro ao carregar a programação de manutenção.');
    }
  }

  private tecnicosPorArea(area: ManutencaoArea): Colaborador[] {
    const termo = area === 'ELETRICA' ? 'ELETR' : 'MECAN';
    return this.apontamentosService.colaboradores()
      .filter(c => normalizarTexto(c.area).includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // ── Criar/Editar OS ────────────────────────────────────────────────────
  abrirCriar(): void {
    this.formIdEdicao.set(null);
    const area = this.areaFiltro();
    this.formArea.set(area !== 'todos' ? area : 'ELETRICA');
    this.formNumeroOs.set('');
    this.formDescricao.set('');
    this.formEquipamento.set('');
    this.formRecursos.set('');
    this.formLoto.set('');
    this.formAreaAtuacao.set('');
    this.formDuracaoHoras.set(null);
    this.formTecnicoNome.set('');
    this.formTecnicoMatricula.set('');
    this.formDiasSelecionados.set([]);
    this.formStatus.set('PEND');
    this.formObservacoes.set('');
    this.formAberto.set(true);
  }

  abrirEditar(o: ManutencaoOrdem): void {
    this.formIdEdicao.set(o.id);
    this.formArea.set(o.area);
    this.formNumeroOs.set(o.numeroOs ?? '');
    this.formDescricao.set(o.descricao);
    this.formEquipamento.set(o.equipamento ?? '');
    this.formRecursos.set(o.recursos ?? '');
    this.formLoto.set(o.loto ?? '');
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

  canConfirmarForm(): boolean {
    return !!this.formDescricao().trim() && !!this.formTecnicoNome().trim() && !!this.formLoto() && !this.isProcessando();
  }

  async confirmarForm(): Promise<void> {
    if (!this.canConfirmarForm()) return;
    this.isProcessando.set(true);
    try {
      const idEdicao = this.formIdEdicao();
      if (idEdicao) {
        await this.manutencaoService.editarOrdem(idEdicao, {
          area: this.formArea(),
          numeroOs: this.formNumeroOs().trim() || null,
          descricao: this.formDescricao().trim(),
          equipamento: this.formEquipamento().trim() || null,
          recursos: this.formRecursos().trim() || null,
          loto: this.formLoto().trim() || null,
          areaAtuacao: this.formAreaAtuacao().trim() || null,
          duracaoHoras: this.formDuracaoHoras(),
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || null,
          diasPrevistos: this.formDiasSelecionados(),
          status: this.formStatus().trim() || 'PEND',
          observacoes: this.formObservacoes().trim() || null,
        });
        this.notificationService.showSuccess('OS atualizada.');
      } else {
        await this.manutencaoService.criarOrdem({
          area: this.formArea(),
          semanaInicio: this.semanaFiltro(),
          numeroOs: this.formNumeroOs().trim() || undefined,
          descricao: this.formDescricao().trim(),
          equipamento: this.formEquipamento().trim() || undefined,
          recursos: this.formRecursos().trim() || undefined,
          loto: this.formLoto().trim() || undefined,
          areaAtuacao: this.formAreaAtuacao().trim() || undefined,
          duracaoHoras: this.formDuracaoHoras() ?? undefined,
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || undefined,
          diasPrevistos: this.formDiasSelecionados(),
          status: this.formStatus().trim() || undefined,
          observacoes: this.formObservacoes().trim() || undefined,
        });
        this.notificationService.showSuccess('OS adicionada à programação.');
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
    if (!confirm(`Excluir a OS "${o.descricao}" de ${o.tecnicoNome}?\n\nEsta ação não pode ser desfeita.`)) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluir(o.id);
      this.notificationService.showSuccess('OS excluída.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
