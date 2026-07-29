import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlmoxarifadoService, Movimentacao, UltimaImportacao } from '../../../services/almoxarifado.service';
import { ExcelExportService } from '../../../services/excel-export.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';

type Periodo = 7 | 15 | 30 | 60;
type ModoFiltro = 'dias' | 'mes';

const TIP_KEY_SAIDAS = 'almox_saidas_tip_dismissed';
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

@Component({
  selector: 'app-almox-saidas',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule],
  templateUrl: './almox-saidas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AlmoxSaidasComponent implements OnInit {
  isLoading = signal(true);
  errorMessage = signal('');
  periodoSelecionado = signal<Periodo>(30);
  ultimaAtualizacao = signal<UltimaImportacao | null>(null);
  showTip = signal(localStorage.getItem(TIP_KEY_SAIDAS) !== '1');

  dismissTip(): void {
    localStorage.setItem(TIP_KEY_SAIDAS, '1');
    this.showTip.set(false);
  }
  readonly periodos: Periodo[] = [7, 15, 30, 60];

  // Modo de filtro da tabela: por janela de dias (como já era) ou por mês
  // específico (para comparar com a meta daquele mês).
  modoFiltro = signal<ModoFiltro>('dias');
  mesEspecifico = signal<string>(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );

  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  private _todasMovs = signal<Movimentacao[]>([]);
  private _metasSaida = signal<Record<string, number>>({});

  saidasFiltradas = computed(() => {
    const todas = this._todasMovs();
    const lista = this.modoFiltro() === 'mes'
      ? todas.filter(m => (m.data_operacao ?? '').startsWith(this.mesEspecifico()))
      : this.almoxService.filtrarSaidasPorPeriodo(todas, this.periodoSelecionado());
    return lista.sort((a, b) => (a.data_operacao ?? '') < (b.data_operacao ?? '') ? -1 : 1);
  });

  resumo = computed(() => {
    const saidas = this.saidasFiltradas();
    const codigos = new Set(saidas.map(e => e.produto_codigo));
    return {
      total:      saidas.length,
      distintos:  codigos.size,
      qtdTotal:   saidas.reduce((s, e) => s + (e.qtd_saida ?? 0), 0),
      valorTotal: saidas.reduce((s, e) => s + (e.qtd_saida ?? 0) * (e.custo_medio ?? 0), 0),
    };
  });

  dateRange = computed(() => {
    if (this.modoFiltro() === 'mes') {
      const [ano, mes] = this.mesEspecifico().split('-').map(Number);
      const ultimoDia = new Date(ano, mes, 0).getDate();
      return { from: `01/${String(mes).padStart(2, '0')}/${ano}`, to: `${ultimoDia}/${String(mes).padStart(2, '0')}/${ano}` };
    }
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - this.periodoSelecionado());
    return {
      from: this.formatDate(from.toISOString().split('T')[0]),
      to:   this.formatDate(to.toISOString().split('T')[0]),
    };
  });

  // ── Meta de retirada mensal ────────────────────────────────────────────
  anoSelecionado = signal(new Date().getFullYear());
  readonly anosDisponiveis = (() => {
    const atual = new Date().getFullYear();
    return [atual - 1, atual, atual + 1];
  })();

  mesesDoAno = computed(() => {
    const ano = this.anoSelecionado();
    return MESES_ABREV.map((label, i) => ({
      key: `${ano}-${String(i + 1).padStart(2, '0')}`,
      label: `${label} ${ano}`,
    }));
  });

  realizadoPorMes = computed(() => {
    const mapa: Record<string, number> = {};
    for (const m of this._todasMovs()) {
      const mes = (m.data_operacao ?? '').slice(0, 7);
      if (!mes) continue;
      mapa[mes] = (mapa[mes] ?? 0) + (m.qtd_saida ?? 0) * (m.custo_medio ?? 0);
    }
    return mapa;
  });

  metaDoMes(mesKey: string): number {
    return this._metasSaida()[mesKey] ?? 0;
  }

  realizadoDoMes(mesKey: string): number {
    return this.realizadoPorMes()[mesKey] ?? 0;
  }

  percentualMes(mesKey: string): number {
    const meta = this.metaDoMes(mesKey);
    if (meta <= 0) return 0;
    return (this.realizadoDoMes(mesKey) / meta) * 100;
  }

  totalMetaAno = computed(() => this.mesesDoAno().reduce((s, m) => s + this.metaDoMes(m.key), 0));
  totalRealizadoAno = computed(() => this.mesesDoAno().reduce((s, m) => s + this.realizadoDoMes(m.key), 0));

  // Meta/realizado do mês atualmente selecionado no filtro "por mês"
  metaMesFiltro = computed(() => this.metaDoMes(this.mesEspecifico()));
  percentualMesFiltro = computed(() => {
    const meta = this.metaMesFiltro();
    if (meta <= 0) return 0;
    return (this.resumo().valorTotal / meta) * 100;
  });

  metaEditandoMes = signal<string | null>(null);
  metaValorEditando = signal<number | null>(null);
  isSalvandoMeta = signal(false);

  constructor(
    private almoxService: AlmoxarifadoService,
    private excelExport: ExcelExportService,
    private authService: AuthService,
    private notificationService: NotificationService,
  ) {}

  exportarExcel(): void {
    this.excelExport.exportarSaidasPorPeriodo(
      this.saidasFiltradas(),
      this.resumo(),
      this.periodoSelecionado(),
      this.dateRange(),
    );
  }

  async ngOnInit(): Promise<void> {
    try {
      const [movs, ultima, metas] = await Promise.all([
        this.almoxService.getMovimentacoes(),
        this.almoxService.getUltimaImportacao('movimentacoes'),
        this.almoxService.getMetasSaida(),
      ]);
      this._todasMovs.set(movs);
      this.ultimaAtualizacao.set(ultima);
      this._metasSaida.set(Object.fromEntries(metas.map(m => [m.mesReferencia, m.valorMeta])));
    } catch {
      this.errorMessage.set('Erro ao carregar movimentações. Verifique se os dados foram importados.');
    } finally {
      this.isLoading.set(false);
    }
  }

  abrirEditarMeta(mesKey: string): void {
    if (!this.isAdmin()) return;
    this.metaEditandoMes.set(mesKey);
    this.metaValorEditando.set(this.metaDoMes(mesKey) || null);
  }

  fecharEditarMeta(): void {
    this.metaEditandoMes.set(null);
  }

  async salvarMeta(): Promise<void> {
    const mesKey = this.metaEditandoMes();
    if (!mesKey || this.isSalvandoMeta()) return;
    const valor = this.metaValorEditando() ?? 0;

    this.isSalvandoMeta.set(true);
    try {
      await this.almoxService.salvarMetaSaida(mesKey, valor);
      this._metasSaida.update(m => ({ ...m, [mesKey]: valor }));
      this.notificationService.showSuccess('Meta atualizada.');
      this.fecharEditarMeta();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao salvar meta.');
    } finally {
      this.isSalvandoMeta.set(false);
    }
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  }

  valorSaida(m: Movimentacao): number {
    return (m.qtd_saida ?? 0) * (m.custo_medio ?? 0);
  }
}
