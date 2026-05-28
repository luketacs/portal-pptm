import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlmoxarifadoService, MaterialComSAs, UltimaImportacao } from '../../../services/almoxarifado.service';

const TIP_KEY_AGUARDANDO = 'almox_aguardando_tip_dismissed';

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
  showTip = signal(localStorage.getItem(TIP_KEY_AGUARDANDO) !== '1');

  dismissTip(): void {
    localStorage.setItem(TIP_KEY_AGUARDANDO, '1');
    this.showTip.set(false);
  }

  private _comSA = signal<MaterialComSAs[]>([]);
  private _semSA = signal<MaterialComSAs[]>([]);

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

  constructor(private almoxService: AlmoxarifadoService) {}

  async ngOnInit(): Promise<void> {
    try {
      const [movs, sas, ultima] = await Promise.all([
        this.almoxService.getMovimentacoes(),
        this.almoxService.getSolicitacoes(),
        this.almoxService.getUltimaImportacao('movimentacoes'),
      ]);
      const { comSA, semSA } = this.almoxService.calcularAguardandoRetirada(movs, sas);
      this._comSA.set(comSA);
      this._semSA.set(semSA);
      this.ultimaAtualizacao.set(ultima);
    } catch {
      this.errorMessage.set('Erro ao carregar dados. Verifique se os dados foram importados.');
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
}
