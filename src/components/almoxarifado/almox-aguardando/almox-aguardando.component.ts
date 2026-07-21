import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlmoxarifadoService, MaterialComSAs, SaldoReal, UltimaImportacao } from '../../../services/almoxarifado.service';
import { ExcelExportService } from '../../../services/excel-export.service';

const TIP_KEY_AGUARDANDO = 'almox_aguardando_tip_dismissed';
const TOLERANCIA_SALDO = 0.01;

export type StatusSaldo = 'sem_conferencia' | 'ok' | 'divergente';

@Component({
  selector: 'app-almox-aguardando',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, FormsModule],
  templateUrl: './almox-aguardando.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AlmoxAguardandoComponent implements OnInit {
  isLoading = signal(true);
  errorMessage = signal('');
  searchTerm = signal('');
  recebedorFilter = signal('');
  ultimaAtualizacao = signal<UltimaImportacao | null>(null);
  ultimaConferenciaSaldo = signal<UltimaImportacao | null>(null);
  showTip = signal(localStorage.getItem(TIP_KEY_AGUARDANDO) !== '1');

  dismissTip(): void {
    localStorage.setItem(TIP_KEY_AGUARDANDO, '1');
    this.showTip.set(false);
  }

  private _comSA = signal<MaterialComSAs[]>([]);
  private _semSA = signal<MaterialComSAs[]>([]);
  private _saldoReal = signal<SaldoReal[]>([]);

  saldoRealMap = computed(() => new Map(this._saldoReal().map(s => [s.produto_codigo, s])));

  comSAFiltrado = computed(() => {
    const t   = this.searchTerm().toLowerCase();
    const rec = this.recebedorFilter().trim().toLowerCase();

    return this._comSA().filter(r => {
      if (t && !r.material.produto_codigo.toLowerCase().includes(t) &&
               !r.material.produto_desc.toLowerCase().includes(t)) {
        return false;
      }
      // includes() — busca parcial: "RAF" encontra "RAFAEL", "RAFAEL, RAFAEL B", etc.
      if (rec) {
        const temRecebedor = r.sas.some(
          sa => (sa.recebedor ?? '').toLowerCase().includes(rec)
        );
        if (!temRecebedor) return false;
      }
      return true;
    });
  });

  // Total sem filtros — para o indicador "X de Y materiais"
  _comSATotal = computed(() => this._comSA().length);

  totalGeral = computed(() => ({
    qtd:   this.comSAFiltrado().reduce((s, r) => s + r.material.qtd_entrada_total, 0),
    valor: this.comSAFiltrado().reduce((s, r) => s + r.material.valor_total, 0),
  }));

  constructor(
    private almoxService: AlmoxarifadoService,
    private excelExport: ExcelExportService,
  ) {}

  exportarExcel(): void {
    this.excelExport.exportarAguardandoRetirada(
      this.comSAFiltrado(),
      this.totalGeral(),
      this.saldoRealMap(),
      !!this.ultimaConferenciaSaldo(),
    );
  }

  async ngOnInit(): Promise<void> {
    try {
      const [movs, sas, ultima, saldoReal, ultimaSaldo] = await Promise.all([
        this.almoxService.getMovimentacoes(),
        this.almoxService.getSolicitacoes(),
        this.almoxService.getUltimaImportacao('movimentacoes'),
        this.almoxService.getSaldoReal(),
        this.almoxService.getUltimaImportacao('saldo'),
      ]);
      const { comSA, semSA } = this.almoxService.calcularAguardandoRetirada(movs, sas);
      this._comSA.set(comSA);
      this._semSA.set(semSA);
      this._saldoReal.set(saldoReal);
      this.ultimaAtualizacao.set(ultima);
      this.ultimaConferenciaSaldo.set(ultimaSaldo);
    } catch {
      this.errorMessage.set('Erro ao carregar dados. Verifique se os dados foram importados.');
    } finally {
      this.isLoading.set(false);
    }
  }

  // Total solicitado (soma das SAs pendentes) — é contra isso que o saldo real é conferido,
  // não contra a qtd. de entrada: o que importa é se dá pra atender o que foi pedido.
  solicitadoTotal(row: MaterialComSAs): number {
    return row.sas.reduce((s, sa) => s + sa.qtd_solicitada, 0);
  }

  // Se ainda não foi importado nenhum arquivo de saldo, não há o que conferir.
  // Se foi importado mas o material não aparece nele, o saldo real é 0 — ou ainda
  // não chegou fisicamente, ou já foi retirado (a Movimentações pode estar desatualizada).
  saldoRealDe(codigo: string): number | null {
    if (!this.ultimaConferenciaSaldo()) return null;
    return this.saldoRealMap().get(codigo)?.saldo_qtd ?? 0;
  }

  statusSaldo(row: MaterialComSAs): StatusSaldo {
    if (!this.ultimaConferenciaSaldo()) return 'sem_conferencia';
    const saldoReal   = this.saldoRealMap().get(row.material.produto_codigo)?.saldo_qtd ?? 0;
    const solicitado  = this.solicitadoTotal(row);
    return saldoReal >= solicitado - TOLERANCIA_SALDO ? 'ok' : 'divergente';
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
}
