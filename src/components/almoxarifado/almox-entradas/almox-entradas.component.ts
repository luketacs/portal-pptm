import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal, untracked } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { AlmoxarifadoService, Movimentacao, UltimaImportacao } from '../../../services/almoxarifado.service';
import { ExcelExportService } from '../../../services/excel-export.service';
import { createClientPageItems, createPageNavigation } from '../../../utils/pagination';

type Periodo = 7 | 15 | 30 | 60;

const TIP_KEY_ENTRADAS = 'almox_entradas_tip_dismissed';

@Component({
  selector: 'app-almox-entradas',
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
  templateUrl: './almox-entradas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AlmoxEntradasComponent implements OnInit {
  isLoading = signal(true);
  errorMessage = signal('');
  periodoSelecionado = signal<Periodo>(30);
  ultimaAtualizacao = signal<UltimaImportacao | null>(null);
  showTip = signal(localStorage.getItem(TIP_KEY_ENTRADAS) !== '1');

  dismissTip(): void {
    localStorage.setItem(TIP_KEY_ENTRADAS, '1');
    this.showTip.set(false);
  }
  readonly periodos: Periodo[] = [7, 15, 30, 60];

  private _todasMovs = signal<Movimentacao[]>([]);

  entradasFiltradas = computed(() =>
    this.almoxService.filtrarEntradasPorPeriodo(this._todasMovs(), this.periodoSelecionado())
      .sort((a, b) => (a.data_operacao ?? '') < (b.data_operacao ?? '') ? -1 : 1)
  );

  // Paginação
  private pageNav = createPageNavigation(computed(() => this.entradasFiltradas().length), 25);
  currentPage = this.pageNav.currentPage;
  totalPages = this.pageNav.totalPages;
  startItem = this.pageNav.startItem;
  endItem = this.pageNav.endItem;
  visiblePages = this.pageNav.visiblePages;
  entradasPaginadas = createClientPageItems(this.entradasFiltradas, this.pageNav);

  resumo = computed(() => {
    const entradas = this.entradasFiltradas();
    const codigos = new Set(entradas.map(e => e.produto_codigo));
    return {
      total:      entradas.length,
      distintos:  codigos.size,
      qtdTotal:   entradas.reduce((s, e) => s + (e.qtd_entrada ?? 0), 0),
      valorTotal: entradas.reduce((s, e) => s + (e.qtd_entrada ?? 0) * (e.custo_medio ?? 0), 0),
    };
  });

  dateRange = computed(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - this.periodoSelecionado());
    return {
      from: this.formatDate(from.toISOString().split('T')[0]),
      to:   this.formatDate(to.toISOString().split('T')[0]),
    };
  });

  constructor(
    private almoxService: AlmoxarifadoService,
    private excelExport: ExcelExportService,
  ) {
    let isFirstRun = true;
    effect(() => {
      this.entradasFiltradas();
      untracked(() => {
        if (isFirstRun) { isFirstRun = false; return; }
        this.currentPage.set(1);
      });
    });
  }

  goToPage(page: number): void {
    this.pageNav.goToPage(page);
  }

  exportarExcel(): void {
    this.excelExport.exportarEntradasPorPeriodo(
      this.entradasFiltradas(),
      this.resumo(),
      this.periodoSelecionado(),
      this.dateRange(),
    );
  }

  async ngOnInit(): Promise<void> {
    try {
      const [movs, ultima] = await Promise.all([
        this.almoxService.getMovimentacoes(),
        this.almoxService.getUltimaImportacao('movimentacoes'),
      ]);
      this._todasMovs.set(movs);
      this.ultimaAtualizacao.set(ultima);
    } catch {
      this.errorMessage.set('Erro ao carregar movimentações. Verifique se os dados foram importados.');
    } finally {
      this.isLoading.set(false);
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

  valorEntrada(m: Movimentacao): number {
    return (m.qtd_entrada ?? 0) * (m.custo_medio ?? 0);
  }
}
