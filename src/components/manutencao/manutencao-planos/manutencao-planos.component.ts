import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoPlanosService } from '../../../services/manutencao-planos.service';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { ExcelExportService } from '../../../services/excel-export.service';
import {
  CicloManutencao, ConsultaSigmaResultado, ManutencaoArea, ManutencaoOrdem, PeriodicidadeUnidade, PlanoManutencao,
} from '../../../models/manutencao-programacao.model';
import { calcularProximaData, dataLimiteComTolerancia } from '../../../utils/manutencao-preventivas';
import {
  DiaGradeMensal, gerarGradeMensal, planosAtrasados, planosComProximaExecucao, proximaExecucaoPlano,
} from '../../../utils/manutencao-planos';

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

const MESES_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

// Item do Calendário de Manutenção — 'real' já é ordem de verdade (ciclo com ordem
// vinculada), 'previsto' é só a próxima execução calculada do plano, ainda sem ciclo
// nenhum (mesma distinção visual já usada no histórico — borda tracejada pro previsto).
interface ItemCalendario {
  data: string;
  tipo: 'real' | 'previsto';
  plano: PlanoManutencao;
  ordem?: ManutencaoOrdem;
}

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

function normalizarTexto(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Mesmas 3 opções de LOTO_OPCOES em manutencao-programacao.component.ts (convenção do
// projeto: duplicar constante pequena em vez de criar um util só pra isso).
const LOTO_OPCOES = ['LOTO', 'SEM LOTO', 'FUNCIONANDO'];

interface PeriodicidadePreset {
  label: string;
  valor: number | null; // null = Personalizada (usuário define)
  unidade: PeriodicidadeUnidade | null;
}

const PERIODICIDADE_PRESETS: PeriodicidadePreset[] = [
  { label: 'Semanal', valor: 1, unidade: 'Semana(s)' },
  { label: 'Quinzenal', valor: 2, unidade: 'Semana(s)' },
  { label: 'Mensal', valor: 1, unidade: 'Mes(es)' },
  { label: 'Bimestral', valor: 2, unidade: 'Mes(es)' },
  { label: 'Trimestral', valor: 3, unidade: 'Mes(es)' },
  { label: 'Quadrimestral', valor: 4, unidade: 'Mes(es)' },
  { label: 'Semestral', valor: 6, unidade: 'Mes(es)' },
  { label: 'Anual', valor: 12, unidade: 'Mes(es)' },
  { label: 'Personalizada', valor: null, unidade: null },
];

@Component({
  selector: 'app-manutencao-planos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-planos.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoPlanosComponent implements OnInit {
  readonly areaLabel = AREA_LABEL;
  readonly periodicidadePresets = PERIODICIDADE_PRESETS;
  readonly lotoOpcoes = LOTO_OPCOES;
  errorMessage = signal('');
  isProcessando = signal(false);

  constructor(
    private manutencaoPlanosService: ManutencaoPlanosService,
    private manutencaoProgramacaoService: ManutencaoProgramacaoService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private excelExportService: ExcelExportService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      // Carrega as ordens junto (não só os planos) — a tela de histórico precisa delas
      // pra juntar cada ciclo com a ordem que ele gerou.
      await Promise.all([this.manutencaoPlanosService.load(), this.manutencaoProgramacaoService.load()]);
    } catch {
      this.errorMessage.set('Erro ao carregar os planos de manutenção.');
    }
  }

  isLoading = this.manutencaoPlanosService.isLoading;
  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  // Semana ISO — mesma implementação duplicada em manutencao-programacao/manutencao-
  // dashboard/kanban-oficina-publico (convenção deste código: cada tela por trás de
  // rota própria mantém sua própria cópia, não centraliza).
  private numeroSemanaISO(dataIso: string): number {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const diaDaSemana = (data.getUTCDay() + 6) % 7;
    data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
    const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
    const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
    return 1 + Math.round(diffDias / 7);
  }

  private readonly hojeInicioSemanaIso = paraIso(segundaFeiraDe(new Date()));

  // Cada plano ativo já com a próxima execução (derivada do último ciclo) e a
  // "última execução" (o próprio último ciclo, se existir) — insumo da tabela e dos KPIs.
  private planosComProximaTodos = computed(() =>
    planosComProximaExecucao(this.manutencaoPlanosService.planos(), this.ultimoCicloPorPlano(), false));

  private ultimoCicloPorPlano = computed(() => {
    const planos = this.manutencaoPlanosService.planos();
    return new Map(planos.map(p => [p.id, this.manutencaoPlanosService.ultimoCicloDoPlano(p.id)]));
  });

  private planosAtrasadosTodos = computed(() =>
    planosAtrasados(this.planosComProximaTodos(), this.hojeInicioSemanaIso, false));

  private planosAtrasadosIds = computed(() => new Set(this.planosAtrasadosTodos().map(p => p.id)));

  // ── KPIs ──────────────────────────────────────────────────────────────────
  kpiPlanosAtivos = computed(() => this.manutencaoPlanosService.planos().filter(p => p.ativo).length);
  kpiPlanosInativos = computed(() => this.manutencaoPlanosService.planos().filter(p => !p.ativo).length);
  kpiPlanosVencidos = computed(() => this.planosAtrasadosIds().size);

  private inicioFimSemana(offsetSemanas: number): { inicio: string; fim: string } {
    const segunda = segundaFeiraDe(new Date());
    segunda.setDate(segunda.getDate() + offsetSemanas * 7);
    const domingo = new Date(segunda);
    domingo.setDate(domingo.getDate() + 6);
    return { inicio: paraIso(segunda), fim: paraIso(domingo) };
  }

  kpiPrevistasNaSemana = computed(() => {
    const { inicio, fim } = this.inicioFimSemana(0);
    return this.planosComProximaTodos().filter(p => p.proximaData >= inicio && p.proximaData <= fim).length;
  });

  kpiPrevistasProximaSemana = computed(() => {
    const { inicio, fim } = this.inicioFimSemana(1);
    return this.planosComProximaTodos().filter(p => p.proximaData >= inicio && p.proximaData <= fim).length;
  });

  // "Geradas" (não "executadas" — depende da mesma lógica de apontamento SIGMA que o
  // Dashboard já usa, fica pra uma fase 2): ciclos registrados com dataPrevista dentro
  // da semana atual.
  kpiOrdensGeradasNaSemana = computed(() => {
    const { inicio, fim } = this.inicioFimSemana(0);
    return this.manutencaoPlanosService.ciclos().filter(c => c.dataPrevista >= inicio && c.dataPrevista <= fim).length;
  });

  // ── Filtros ───────────────────────────────────────────────────────────────
  filtroArea = signal<'todos' | ManutencaoArea>('todos');
  filtroStatus = signal<'todos' | 'ativo' | 'inativo'>('todos');
  filtroPeriodicidade = signal<string>('todos');
  filtroResponsavel = signal<string>('todos');
  filtroBusca = signal('');

  responsaveisComPlano = computed(() => {
    const nomes = new Set(this.manutencaoPlanosService.planos().map(p => p.responsavel).filter((r): r is string => !!r));
    return Array.from(nomes).sort();
  });

  private planosComExecucaoPorId = computed(() => new Map(this.planosComProximaTodos().map(p => [p.id, p])));

  // Extraído de linhas() pra reaproveitar no Calendário também — mesmos filtros,
  // ambas as visões (lista/calendário) mostram exatamente o mesmo recorte de planos.
  planosFiltrados = computed(() => {
    const termo = normalizarTexto(this.filtroBusca().trim());
    const area = this.filtroArea();
    const status = this.filtroStatus();
    const periodicidade = this.filtroPeriodicidade();
    const responsavel = this.filtroResponsavel();

    return this.manutencaoPlanosService.planos()
      .filter(p => area === 'todos' || p.area === area)
      .filter(p => status === 'todos' || (status === 'ativo' ? p.ativo : !p.ativo))
      .filter(p => periodicidade === 'todos' || `${p.periodicidadeValor} ${p.periodicidadeUnidade}` === periodicidade)
      .filter(p => responsavel === 'todos' || p.responsavel === responsavel)
      .filter(p => termo.length === 0 || normalizarTexto(`${p.codigo} ${p.equipamento} ${p.descricao} ${p.tagKks ?? ''}`).includes(termo));
  });

  linhas = computed(() => {
    const porId = this.planosComExecucaoPorId();
    return this.planosFiltrados()
      .map(p => {
        const comExecucao = porId.get(p.id);
        const ultimoCiclo = this.manutencaoPlanosService.ultimoCicloDoPlano(p.id);
        const proximaData = comExecucao?.proximaData ?? p.dataInicial;
        return {
          plano: p,
          ultimaExecucao: ultimoCiclo,
          proximaData,
          semanaPrevista: this.numeroSemanaISO(proximaData),
          vencido: this.planosAtrasadosIds().has(p.id),
        };
      })
      .sort((a, b) => a.plano.codigo.localeCompare(b.plano.codigo));
  });

  periodicidadesCadastradas = computed(() => {
    const valores = new Set(this.manutencaoPlanosService.planos().map(p => `${p.periodicidadeValor} ${p.periodicidadeUnidade}`));
    return Array.from(valores).sort();
  });

  private formatarDataBr(dataIso: string): string {
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  // Exporta exatamente o que está na tela (linhas() já aplica todos os filtros ativos)
  // — pra mandar só a Mecânica, por exemplo, basta filtrar por Área antes de exportar.
  exportando = signal(false);

  async exportarExcel(): Promise<void> {
    if (this.exportando()) return;
    const linhas = this.linhas();
    if (linhas.length === 0) {
      this.notificationService.showError('Nenhum plano pra exportar com esses filtros.');
      return;
    }
    this.exportando.set(true);
    try {
      const area = this.filtroArea();
      const tituloArea = area === 'todos' ? 'Todas as Áreas' : this.areaLabel[area];
      await this.excelExportService.exportarPlanos({
        titulo: `Planos de Manutenção — ${tituloArea}`,
        linhas: linhas.map(l => ({
          codigo: l.plano.codigo,
          nome: l.plano.nome,
          equipamento: l.plano.equipamento,
          tagKks: l.plano.tagKks || '—',
          area: this.areaLabel[l.plano.area],
          especialidade: l.plano.especialidade || '—',
          descricao: l.plano.descricao,
          periodicidade: `${l.plano.periodicidadeValor} ${l.plano.periodicidadeUnidade}`,
          responsavel: l.plano.responsavel || '—',
          dataInicial: this.formatarDataBr(l.plano.dataInicial),
          ultimaExecucao: l.ultimaExecucao ? this.formatarDataBr(l.ultimaExecucao) : '—',
          proximaExecucao: this.formatarDataBr(l.proximaData),
          semanaPrevista: `S${l.semanaPrevista}`,
          status: l.plano.ativo ? 'Ativo' : 'Inativo',
          tempoEstimadoHoras: l.plano.tempoEstimadoHoras != null ? String(l.plano.tempoEstimadoHoras) : '—',
          hhEstimado: l.plano.hhEstimado != null ? String(l.plano.hhEstimado) : '—',
          observacoes: l.plano.observacoes || '—',
        })),
      });
      this.notificationService.showSuccess('Planilha exportada.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao exportar.');
    } finally {
      this.exportando.set(false);
    }
  }

  // ── Ativar/Desativar/Excluir ────────────────────────────────────────────────
  async toggleAtivo(plano: PlanoManutencao): Promise<void> {
    if (this.isProcessando()) return;
    const mensagem = plano.ativo
      ? `Desativar o plano "${plano.nome}"? Ele continua no histórico, mas deixa de gerar novas sugestões de ordem.`
      : `Ativar o plano "${plano.nome}"? Ele volta a gerar sugestões de ordem conforme a periodicidade.`;
    if (!(await this.confirmDialogService.confirm(mensagem))) return;
    this.isProcessando.set(true);
    try {
      if (plano.ativo) await this.manutencaoPlanosService.desativar(plano.id);
      else await this.manutencaoPlanosService.ativar(plano.id);
      this.notificationService.showSuccess(plano.ativo ? 'Plano desativado.' : 'Plano ativado.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao atualizar o plano.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async excluir(plano: PlanoManutencao): Promise<void> {
    if (this.isProcessando()) return;
    if (!(await this.confirmDialogService.confirm(
      'Deseja realmente excluir este plano de manutenção? Essa ação não poderá ser desfeita.',
      { confirmLabel: 'Excluir', danger: true },
    ))) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoPlanosService.excluir(plano.id);
      this.notificationService.showSuccess('Plano excluído. Ordens já geradas continuam no histórico.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir o plano.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Modal: criar/editar plano ────────────────────────────────────────────
  formAberto = signal(false);
  formIdEdicao = signal<string | null>(null);
  formNome = signal('');
  formEquipamento = signal('');
  formTagKks = signal('');
  formArea = signal<ManutencaoArea>('ELETRICA');
  formEspecialidade = signal('');
  formDescricao = signal('');
  formAtividadesTexto = signal(''); // uma atividade por linha
  formPeriodicidadePreset = signal<string>('Mensal');
  formPeriodicidadeValor = signal(1);
  formPeriodicidadeUnidade = signal<PeriodicidadeUnidade>('Mes(es)');
  formDataInicial = signal(paraIso(new Date()));
  formResponsavel = signal('');
  formTempoEstimadoHoras = signal<number | null>(null);
  formHhEstimado = signal<number | null>(null);
  formObservacoes = signal('');
  formAtivo = signal(true);
  // Status de LOTO que essa manutenção sempre exige (ex.: teste que precisa do
  // equipamento rodando) — pré-preenche o campo LOTO da Nova OS ao programar (ver
  // programarDaPreventiva na Programação). '' = sem padrão.
  formLotoPadrao = signal('');
  // Outros equipamentos que devem entrar no Quadro de LOTO junto com o principal
  // sempre que esse plano for programado (ex.: teste que envolve vários equipamentos
  // ao mesmo tempo) — mesmo padrão de chips salvo como texto (join por vírgula).
  formEquipamentosRelacionadosLista = signal<string[]>([]);
  formEquipamentosRelacionadosDigitando = signal('');
  formEquipamentosRelacionadosTexto = computed(() => this.formEquipamentosRelacionadosLista().join(', '));

  adicionarEquipamentoRelacionado(valor: string): void {
    const v = valor.trim();
    if (!v) return;
    if (this.formEquipamentosRelacionadosLista().some(e => e.toUpperCase() === v.toUpperCase())) {
      this.formEquipamentosRelacionadosDigitando.set('');
      return;
    }
    this.formEquipamentosRelacionadosLista.update(lista => [...lista, v]);
    this.formEquipamentosRelacionadosDigitando.set('');
  }

  removerEquipamentoRelacionado(valor: string): void {
    this.formEquipamentosRelacionadosLista.update(lista => lista.filter(e => e !== valor));
  }

  personalizadaSelecionada = computed(() => this.formPeriodicidadePreset() === 'Personalizada');

  selecionarPreset(label: string): void {
    this.formPeriodicidadePreset.set(label);
    const preset = PERIODICIDADE_PRESETS.find(p => p.label === label);
    if (preset && preset.valor !== null && preset.unidade !== null) {
      this.formPeriodicidadeValor.set(preset.valor);
      this.formPeriodicidadeUnidade.set(preset.unidade);
    }
  }

  abrirCriar(): void {
    this.formIdEdicao.set(null);
    this.formNome.set('');
    this.formEquipamento.set('');
    this.formTagKks.set('');
    this.formArea.set('ELETRICA');
    this.formEspecialidade.set('');
    this.formDescricao.set('');
    this.formAtividadesTexto.set('');
    this.formPeriodicidadePreset.set('Mensal');
    this.formPeriodicidadeValor.set(1);
    this.formPeriodicidadeUnidade.set('Mes(es)');
    this.formDataInicial.set(paraIso(new Date()));
    this.formResponsavel.set('');
    this.formTempoEstimadoHoras.set(null);
    this.formHhEstimado.set(null);
    this.formObservacoes.set('');
    this.formAtivo.set(true);
    this.formLotoPadrao.set('');
    this.formEquipamentosRelacionadosLista.set([]);
    this.formEquipamentosRelacionadosDigitando.set('');
    this.formAberto.set(true);
  }

  abrirEditar(plano: PlanoManutencao): void {
    this.formIdEdicao.set(plano.id);
    this.formNome.set(plano.nome);
    this.formEquipamento.set(plano.equipamento);
    this.formTagKks.set(plano.tagKks ?? '');
    this.formArea.set(plano.area);
    this.formEspecialidade.set(plano.especialidade ?? '');
    this.formDescricao.set(plano.descricao);
    this.formAtividadesTexto.set(plano.atividades.join('\n'));
    const preset = PERIODICIDADE_PRESETS.find(p => p.valor === plano.periodicidadeValor && p.unidade === plano.periodicidadeUnidade);
    this.formPeriodicidadePreset.set(preset ? preset.label : 'Personalizada');
    this.formPeriodicidadeValor.set(plano.periodicidadeValor);
    this.formPeriodicidadeUnidade.set(plano.periodicidadeUnidade);
    this.formDataInicial.set(plano.dataInicial);
    this.formResponsavel.set(plano.responsavel ?? '');
    this.formTempoEstimadoHoras.set(plano.tempoEstimadoHoras);
    this.formHhEstimado.set(plano.hhEstimado);
    this.formObservacoes.set(plano.observacoes ?? '');
    this.formAtivo.set(plano.ativo);
    this.formLotoPadrao.set(plano.lotoPadrao ?? '');
    this.formEquipamentosRelacionadosLista.set((plano.equipamentosRelacionados ?? '').split(',').map(e => e.trim()).filter(Boolean));
    this.formEquipamentosRelacionadosDigitando.set('');
    this.formAberto.set(true);
  }

  fecharForm(): void {
    this.formAberto.set(false);
  }

  podeConfirmar = computed(() =>
    !this.isProcessando() && this.formNome().trim().length > 0 && this.formEquipamento().trim().length > 0
    && this.formDescricao().trim().length > 0 && this.formPeriodicidadeValor() > 0 && !!this.formDataInicial());

  async confirmarForm(): Promise<void> {
    if (!this.podeConfirmar()) return;
    this.isProcessando.set(true);
    try {
      const atividades = this.formAtividadesTexto().split('\n').map(a => a.trim()).filter(Boolean);
      const idEdicao = this.formIdEdicao();
      if (idEdicao) {
        await this.manutencaoPlanosService.editar(idEdicao, {
          nome: this.formNome().trim(),
          equipamento: this.formEquipamento().trim(),
          tagKks: this.formTagKks().trim() || null,
          area: this.formArea(),
          especialidade: this.formEspecialidade().trim() || null,
          descricao: this.formDescricao().trim(),
          atividades,
          periodicidadeValor: this.formPeriodicidadeValor(),
          periodicidadeUnidade: this.formPeriodicidadeUnidade(),
          dataInicial: this.formDataInicial(),
          responsavel: this.formResponsavel().trim() || null,
          tempoEstimadoHoras: this.formTempoEstimadoHoras(),
          hhEstimado: this.formHhEstimado(),
          observacoes: this.formObservacoes().trim() || null,
          ativo: this.formAtivo(),
          lotoPadrao: this.formLotoPadrao() || null,
          equipamentosRelacionados: this.formEquipamentosRelacionadosTexto() || null,
        });
        this.notificationService.showSuccess('Plano atualizado.');
      } else {
        await this.manutencaoPlanosService.criar({
          nome: this.formNome().trim(),
          equipamento: this.formEquipamento().trim(),
          tagKks: this.formTagKks().trim() || undefined,
          area: this.formArea(),
          especialidade: this.formEspecialidade().trim() || undefined,
          descricao: this.formDescricao().trim(),
          atividades,
          periodicidadeValor: this.formPeriodicidadeValor(),
          periodicidadeUnidade: this.formPeriodicidadeUnidade(),
          dataInicial: this.formDataInicial(),
          responsavel: this.formResponsavel().trim() || undefined,
          tempoEstimadoHoras: this.formTempoEstimadoHoras() ?? undefined,
          hhEstimado: this.formHhEstimado() ?? undefined,
          observacoes: this.formObservacoes().trim() || undefined,
          ativo: this.formAtivo(),
          lotoPadrao: this.formLotoPadrao() || undefined,
          equipamentosRelacionados: this.formEquipamentosRelacionadosTexto() || undefined,
        });
        this.notificationService.showSuccess('Plano cadastrado.');
      }
      this.fecharForm();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao salvar o plano.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Histórico do plano ───────────────────────────────────────────────────
  // Aberto ao clicar no plano (código ou nome) — mostra todos os ciclos já gerados,
  // cruzados com a ordem que cada um virou. Datas executadas/executante vêm do SIGMA de
  // verdade (mesma consulta que a Programação já usa), não do status guardado na ordem
  // (que fica "PEND" desde a criação — quem diz se executou é o apontamento no SIGMA).
  historicoAberto = signal<PlanoManutencao | null>(null);
  historicoCarregando = signal(false);
  private historicoSigma = signal<Record<string, ConsultaSigmaResultado>>({});

  historicoLinhas = computed(() => {
    const plano = this.historicoAberto();
    if (!plano) return [];
    const ordensPorId = new Map(this.manutencaoProgramacaoService.ordens().map(o => [o.id, o]));
    const sigma = this.historicoSigma();
    return this.manutencaoPlanosService.ciclos()
      .filter(c => c.planoId === plano.id)
      .map((ciclo: CicloManutencao) => {
        const ordem: ManutencaoOrdem | undefined = ordensPorId.get(ciclo.ordemId);
        const prazoLimite = dataLimiteComTolerancia(ciclo.dataPrevista, plano.periodicidadeValor, plano.periodicidadeUnidade);
        const atrasado = !!ordem && !!prazoLimite && ordem.semanaInicio > prazoLimite;
        const apontamentos = ordem?.numeroOs ? (sigma[ordem.numeroOs]?.apontamentos ?? []) : [];
        return { ciclo, ordem, atrasado, semanaPrevista: this.numeroSemanaISO(ciclo.dataPrevista), apontamentos };
      })
      .sort((a, b) => b.ciclo.dataPrevista.localeCompare(a.ciclo.dataPrevista));
  });

  // Projeção das próximas ocorrências — nenhuma delas é ordem de verdade ainda (só
  // aparece em manutencao_ciclos quando alguém programa de fato). Encadeia
  // calcularProximaData a partir da mesma "próxima execução" já usada na tabela/KPIs,
  // só que continua avançando N vezes pra dar uma prévia do que vem depois dela também.
  private readonly QTD_PREVISOES_FUTURAS = 5;

  previsoesFuturas = computed(() => {
    const plano = this.historicoAberto();
    if (!plano) return [];
    const ultimoCiclo = this.manutencaoPlanosService.ultimoCicloDoPlano(plano.id);
    let data = proximaExecucaoPlano(plano.dataInicial, plano.periodicidadeValor, plano.periodicidadeUnidade, ultimoCiclo);
    const previsoes: { data: string; semana: number }[] = [];
    for (let i = 0; i < this.QTD_PREVISOES_FUTURAS; i++) {
      previsoes.push({ data, semana: this.numeroSemanaISO(data) });
      data = calcularProximaData(data, plano.periodicidadeValor, plano.periodicidadeUnidade)!;
    }
    return previsoes;
  });

  async abrirHistorico(plano: PlanoManutencao): Promise<void> {
    this.historicoAberto.set(plano);
    this.historicoSigma.set({});
    const ordensPorId = new Map(this.manutencaoProgramacaoService.ordens().map(o => [o.id, o]));
    const numerosOs = this.manutencaoPlanosService.ciclos()
      .filter(c => c.planoId === plano.id)
      .map(c => ordensPorId.get(c.ordemId)?.numeroOs)
      .filter((n): n is string => !!n);
    if (numerosOs.length === 0) return;
    this.historicoCarregando.set(true);
    try {
      this.historicoSigma.set(await this.manutencaoProgramacaoService.consultarOrdensSigma(numerosOs));
    } catch {
      // Best-effort — sem execução do SIGMA a tela de histórico continua útil só com
      // ciclo/ordem/semana, que já vêm do banco.
    } finally {
      this.historicoCarregando.set(false);
    }
  }

  fecharHistorico(): void {
    this.historicoAberto.set(null);
  }

  // ── Calendário de Manutenção ─────────────────────────────────────────────
  // Toggle dentro da própria tela de Planos (não uma aba separada) — reaproveita os
  // mesmos filtros/dados já carregados (ver planosFiltrados()).
  visualizacao = signal<'lista' | 'calendario'>('lista');
  calendarioModo = signal<'semana' | 'mes' | 'ano'>('semana');
  calendarioAncora = signal<string>(paraIso(new Date()));

  private calendarioAnoAtual = computed(() => Number(this.calendarioAncora().split('-')[0]));
  private calendarioMesAtual = computed(() => Number(this.calendarioAncora().split('-')[1]));

  // Cada plano filtrado vira dois tipos de item: 'real' (um por ciclo já vinculado a
  // uma ordem) e 'previsto' (a próxima execução calculada, ainda sem ordem/ciclo
  // nenhum). Um item 'real' só conta UMA vez por ciclo, ancorado no primeiro dia de
  // diasPrevistos — não um item por dia (uma ordem que dura a semana toda tem vários
  // dias previstos; contar um item por dia inflava a contagem em até 5x no mês, já que
  // a mesma manutenção "aparecia" repetida em cada dia dela). ManutencaoProgramacaoService
  // já está injetado e já carrega ordens() no ngOnInit (usado pela tela de histórico) —
  // nenhum carregamento novo.
  itensCalendario = computed<ItemCalendario[]>(() => {
    const ordensPorId = new Map(this.manutencaoProgramacaoService.ordens().map(o => [o.id, o]));
    const porId = this.planosComExecucaoPorId();
    const itens: ItemCalendario[] = [];
    for (const plano of this.planosFiltrados()) {
      for (const ciclo of this.manutencaoPlanosService.ciclos().filter(c => c.planoId === plano.id)) {
        const ordem = ordensPorId.get(ciclo.ordemId);
        if (!ordem) continue;
        const data = ordem.diasPrevistos.length > 0 ? [...ordem.diasPrevistos].sort()[0] : ordem.semanaInicio;
        itens.push({ data, tipo: 'real', plano, ordem });
      }
      const comExecucao = porId.get(plano.id);
      if (comExecucao) itens.push({ data: comExecucao.proximaData, tipo: 'previsto', plano });
    }
    return itens;
  });

  itensPorDia = computed(() => {
    const mapa = new Map<string, ItemCalendario[]>();
    for (const item of this.itensCalendario()) {
      const lista = mapa.get(item.data) ?? [];
      lista.push(item);
      mapa.set(item.data, lista);
    }
    return mapa;
  });

  calendarioDiasSemana = computed(() => {
    const [ano, mes, dia] = this.calendarioAncora().split('-').map(Number);
    const segunda = segundaFeiraDe(new Date(ano, mes - 1, dia));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(segunda);
      d.setDate(d.getDate() + i);
      return paraIso(d);
    });
  });

  calendarioGradeMensal = computed<DiaGradeMensal[][]>(() =>
    gerarGradeMensal(this.calendarioAnoAtual(), this.calendarioMesAtual()));

  calendarioMesesDoAno = computed(() => {
    const ano = this.calendarioAnoAtual();
    const itensPorDia = this.itensPorDia();
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const prefixo = `${ano}-${String(mes).padStart(2, '0')}`;
      let total = 0;
      for (const [data, itens] of itensPorDia) {
        if (data.startsWith(prefixo)) total += itens.length;
      }
      return { mes, label: MESES_LABEL[i], total };
    });
  });

  calendarioLabel = computed(() => {
    const modo = this.calendarioModo();
    if (modo === 'ano') return `${this.calendarioAnoAtual()}`;
    if (modo === 'mes') return `${MESES_LABEL[this.calendarioMesAtual() - 1]} de ${this.calendarioAnoAtual()}`;
    const dias = this.calendarioDiasSemana();
    return `Semana de ${this.diaMesLabel(dias[0])} a ${this.diaMesLabel(dias[6])}`;
  });

  private diaMesLabel(dataIso: string): string {
    const [, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}`;
  }

  diaSemanaLabel(dataIso: string): string {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    return DIAS_SEMANA_LABEL[(new Date(ano, mes - 1, dia).getDay() + 6) % 7];
  }

  navegarCalendario(direcao: -1 | 1): void {
    const [ano, mes, dia] = this.calendarioAncora().split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    const modo = this.calendarioModo();
    if (modo === 'semana') d.setDate(d.getDate() + direcao * 7);
    else if (modo === 'mes') d.setMonth(d.getMonth() + direcao);
    else d.setFullYear(d.getFullYear() + direcao);
    this.calendarioAncora.set(paraIso(d));
  }

  irParaHoje(): void {
    this.calendarioAncora.set(paraIso(new Date()));
  }

  abrirMesDoAno(mes: number): void {
    this.calendarioAncora.set(`${this.calendarioAnoAtual()}-${String(mes).padStart(2, '0')}-01`);
    this.calendarioModo.set('mes');
  }
}
