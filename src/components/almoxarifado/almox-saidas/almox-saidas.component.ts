import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { AlmoxarifadoService, Movimentacao, UltimaImportacao } from '../../../services/almoxarifado.service';
import { ExcelExportService } from '../../../services/excel-export.service';

type Periodo = 7 | 15 | 30 | 60;

const TIP_KEY_SAIDAS = 'almox_saidas_tip_dismissed';

@Component({
  selector: 'app-almox-saidas',
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
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

  private _todasMovs = signal<Movimentacao[]>([]);

  saidasFiltradas = computed(() =>
    this.almoxService.filtrarSaidasPorPeriodo(this._todasMovs(), this.periodoSelecionado())
      .sort((a, b) => (a.data_operacao ?? '') < (b.data_operacao ?? '') ? -1 : 1)
  );

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

  valorSaida(m: Movimentacao): number {
    return (m.qtd_saida ?? 0) * (m.custo_medio ?? 0);
  }
}
