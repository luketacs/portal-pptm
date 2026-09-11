import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoPlanosService } from '../../../services/manutencao-planos.service';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import {
  CicloManutencao, ConsultaSigmaResultado, ManutencaoArea, ManutencaoOrdem, PeriodicidadeUnidade, PlanoManutencao,
} from '../../../models/manutencao-programacao.model';
import { calcularProximaData, dataLimiteComTolerancia } from '../../../utils/manutencao-preventivas';
import { planosAtrasados, planosComProximaExecucao, proximaExecucaoPlano } from '../../../utils/manutencao-planos';

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

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
  errorMessage = signal('');
  isProcessando = signal(false);

  constructor(
    private manutencaoPlanosService: ManutencaoPlanosService,
    private manutencaoProgramacaoService: ManutencaoProgramacaoService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
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

  linhas = computed(() => {
    const termo = normalizarTexto(this.filtroBusca().trim());
    const area = this.filtroArea();
    const status = this.filtroStatus();
    const periodicidade = this.filtroPeriodicidade();
    const responsavel = this.filtroResponsavel();
    const porId = this.planosComExecucaoPorId();

    return this.manutencaoPlanosService.planos()
      .filter(p => area === 'todos' || p.area === area)
      .filter(p => status === 'todos' || (status === 'ativo' ? p.ativo : !p.ativo))
      .filter(p => periodicidade === 'todos' || `${p.periodicidadeValor} ${p.periodicidadeUnidade}` === periodicidade)
      .filter(p => responsavel === 'todos' || p.responsavel === responsavel)
      .filter(p => termo.length === 0 || normalizarTexto(`${p.codigo} ${p.equipamento} ${p.descricao} ${p.tagKks ?? ''}`).includes(termo))
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
}
