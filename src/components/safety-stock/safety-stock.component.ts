import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';
import { SafetyStockService } from '../../services/safety-stock.service';
import { MaterialService } from '../../services/material.service';
import { AuthService } from '../../services/auth.service';
import { MaterialApiResponse, StockInfo } from '../../models/material.model';
import {
  SafetyStockAreaSummary,
  SafetyStockItem,
  SafetyStockSummary,
} from '../../models/safety-stock.model';

type SafetyBalanceStatus = 'unchecked' | 'ok' | 'below' | 'out' | 'error';

interface SafetyStockBalanceLookup {
  currentStock: number | null;
  checkedAt: number;
  error: string | null;
}

interface SafetyStockBalanceRow extends SafetyStockItem {
  currentStock: number | null;
  deficitQty: number;
  balanceStatus: SafetyBalanceStatus;
  balanceError: string | null;
  checkedAt: number | null;
}

@Component({
  selector: 'app-safety-stock',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './safety-stock.component.html',
  styleUrls: ['./safety-stock.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SafetyStockComponent implements OnInit {
  private readonly TARGET_STOCK_LOCATION = '4922';
  private readonly BALANCE_REQUEST_DELAY_MS = 10000;
  private readonly RATE_LIMIT_PAUSE_MS = 20000;
  private readonly SNAPSHOT_SAVE_INTERVAL = 5;
  private readonly BALANCE_CACHE_TTL_MS = 10 * 60 * 1000;
  private readonly balanceCache = new Map<string, { timestamp: number; lookup: SafetyStockBalanceLookup }>();

  items = signal<SafetyStockItem[]>([]);
  areaSummaries = signal<SafetyStockAreaSummary[]>([]);
  balanceLookupByCode = signal<Record<string, SafetyStockBalanceLookup>>({});
  isLoading = signal(true);
  isCheckingBalances = signal(false);
  isBalancePaused = signal(false);
  errorMessage = signal('');
  diagnostics = signal<string[]>([]);
  selectedArea = signal('all');
  codeFilter = signal('');
  lastBalanceCheckAt = signal<number | null>(null);
  balanceProgress = signal({ done: 0, total: 0 });
  balanceWarningMessage = signal('');
  lastBalanceUpdatedBy = signal<string | null>(null);
  rowBalanceUpdateState = signal<Record<string, boolean>>({});

  currentUser = this.authService.currentUser;
  isAdmin = computed(() => this.currentUser()?.role === 'Admin');

  availableAreas = computed(() => this.areaSummaries().map(summary => summary.area));

  filteredItems = computed(() => {
    const area = this.selectedArea();
    const code = this.codeFilter().trim().toLowerCase();
    let result = this.items();
    if (area !== 'all') {
      result = result.filter(item => item.area === area);
    }
    if (code) {
      result = result.filter(item => item.code.toLowerCase().includes(code));
    }
    return result;
  });

  filteredAreaSummaries = computed(() => {
    const area = this.selectedArea();
    if (area === 'all') return this.areaSummaries();

    const matchedArea = this.areaSummaries().find(summary => summary.area === area);
    if (matchedArea) return [matchedArea];

    const itemsInArea = this.filteredItems();
    if (itemsInArea.length === 0) return [];

    return [{
      area,
      itemCount: itemsInArea.length,
      totalSafetyStockQty: itemsInArea.reduce((sum, item) => sum + item.safetyStockQty, 0),
      totalValue: itemsInArea.reduce((sum, item) => sum + item.totalValue, 0),
    }];
  });

  filteredSummary = computed<SafetyStockSummary>(() => {
    const rows = this.filteredItems();
    const areas = new Set(rows.map(item => item.area));
    return {
      totalItems: rows.length,
      totalAreas: areas.size,
      totalSafetyStockQty: rows.reduce((sum, item) => sum + item.safetyStockQty, 0),
      totalValue: rows.reduce((sum, item) => sum + item.totalValue, 0),
    };
  });

  balanceRows = computed<SafetyStockBalanceRow[]>(() => {
    const lookupByCode = this.balanceLookupByCode();

    return this.filteredItems().map(item => {
      const code = this.normalizeMaterialCode(item.code);
      const lookup = lookupByCode[code];

      if (!lookup) {
        return {
          ...item,
          currentStock: null,
          deficitQty: item.safetyStockQty,
          balanceStatus: 'unchecked',
          balanceError: null,
          checkedAt: null,
        };
      }

      if (lookup.error) {
        return {
          ...item,
          currentStock: null,
          deficitQty: item.safetyStockQty,
          balanceStatus: 'error',
          balanceError: lookup.error,
          checkedAt: lookup.checkedAt,
        };
      }

      const currentStock = lookup.currentStock ?? 0;
      const deficitQty = Math.max(0, item.safetyStockQty - currentStock);
      const balanceStatus: SafetyBalanceStatus =
        currentStock <= 0 ? 'out' : deficitQty > 0 ? 'below' : 'ok';

      return {
        ...item,
        currentStock,
        deficitQty,
        balanceStatus,
        balanceError: null,
        checkedAt: lookup.checkedAt,
      };
    });
  });

  checkedBalanceRows = computed(() =>
    this.balanceRows().filter(row => row.balanceStatus !== 'unchecked')
  );

  hasData = computed(() => this.filteredItems().length > 0);
  hasBalanceData = computed(() => this.checkedBalanceRows().length > 0);

  topAreas = computed(() => this.filteredAreaSummaries().slice(0, 5));

  maxAreaTotal = computed(() => {
    const max = this.filteredAreaSummaries().reduce((currentMax, area) => Math.max(currentMax, area.totalValue), 0);
    return max > 0 ? max : 1;
  });

  topArea = computed<SafetyStockAreaSummary | null>(() => {
    return this.filteredAreaSummaries().length > 0 ? this.filteredAreaSummaries()[0] : null;
  });

  averageItemValue = computed(() => {
    const totalItems = this.filteredSummary().totalItems;
    return totalItems > 0 ? this.filteredSummary().totalValue / totalItems : 0;
  });

  top5Concentration = computed(() => {
    const totalValue = this.filteredSummary().totalValue;
    if (totalValue <= 0) return 0;

    const top5Value = this.filteredAreaSummaries()
      .slice(0, 5)
      .reduce((sum, area) => sum + area.totalValue, 0);

    return (top5Value / totalValue) * 100;
  });

  outOfStockCount = computed(() =>
    this.checkedBalanceRows().filter(row => row.balanceStatus === 'out').length
  );

  belowTargetCount = computed(() =>
    this.checkedBalanceRows().filter(row => row.balanceStatus === 'below').length
  );

  coveredCount = computed(() =>
    this.checkedBalanceRows().filter(row => row.balanceStatus === 'ok').length
  );

  balanceErrorCount = computed(() =>
    this.checkedBalanceRows().filter(row => row.balanceStatus === 'error').length
  );

  totalDeficitQty = computed(() =>
    this.checkedBalanceRows()
      .filter(row => row.balanceStatus === 'out' || row.balanceStatus === 'below')
      .reduce((sum, row) => sum + row.deficitQty, 0)
  );

  criticalBalanceRows = computed(() => {
    const severityOrder: Record<SafetyBalanceStatus, number> = {
      error: 0,
      out: 1,
      below: 2,
      ok: 3,
      unchecked: 4,
    };

    return this.balanceRows()
      .filter(row => row.balanceStatus === 'error' || row.balanceStatus === 'out' || row.balanceStatus === 'below')
      .sort((a, b) => {
        const severityDiff = severityOrder[a.balanceStatus] - severityOrder[b.balanceStatus];
        if (severityDiff !== 0) return severityDiff;
        return b.deficitQty - a.deficitQty;
      });
  });

  // Quando o filtro por código está ativo, mostra TODOS os materiais (incluindo ok/unchecked).
  // Sem filtro, mostra apenas os críticos (below/out/error).
  displayBalanceRows = computed(() => {
    const code = this.codeFilter().trim();
    if (code) {
      // Com filtro de código: mostrar todos os balanceRows (inclusive ok e unchecked)
      const severityOrder: Record<SafetyBalanceStatus, number> = {
        error: 0, out: 1, below: 2, ok: 3, unchecked: 4,
      };
      return this.balanceRows().sort((a, b) => {
        const diff = severityOrder[a.balanceStatus] - severityOrder[b.balanceStatus];
        if (diff !== 0) return diff;
        return b.deficitQty - a.deficitQty;
      });
    }
    return this.criticalBalanceRows();
  });

  isFilteringByCode = computed(() => this.codeFilter().trim().length > 0);

  constructor(
    private safetyStockService: SafetyStockService,
    private materialService: MaterialService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.balanceWarningMessage.set('');

    const { data, error } = await this.safetyStockService.getSafetyStockData();

    if (error) {
      console.error('[SafetyStock] Error loading stock safety data:', error);
      const details = error?.message || error?.details || error?.hint || '';
      this.errorMessage.set(
        details
          ? `Erro ao carregar dados do estoque de seguranca: ${details}`
          : 'Erro ao carregar dados do estoque de seguranca.'
      );
      this.isLoading.set(false);
      return;
    }

    this.items.set(data?.items || []);
    this.areaSummaries.set(data?.areaSummaries || []);
    this.pruneBalanceLookupsToKnownCodes();
    this.diagnostics.set(data?.diagnostics || []);
    await this.loadLatestBalanceSnapshot();
    this.isLoading.set(false);
  }

  async checkStockBalances(forceRefresh = false): Promise<void> {
    if (this.isCheckingBalances()) return;
    if (!this.isAdmin()) {
      this.balanceWarningMessage.set('A consulta de saldo está habilitada apenas para administradores.');
      return;
    }

    const allCodesInFilter = this.uniqueCodesForCurrentFilter();
    if (allCodesInFilter.length === 0) return;

    const codesToCheck = this.selectCodesForSafeRun(allCodesInFilter, forceRefresh);
    if (codesToCheck.length === 0) {
      this.balanceWarningMessage.set(
        forceRefresh
          ? 'Nenhum código disponível para consulta neste filtro.'
          : 'Todos os itens deste filtro já foram consultados sem erro. Use Forçar consulta para atualizar novamente.'
      );
      return;
    }

    this.isCheckingBalances.set(true);
    this.isBalancePaused.set(false);
    this.balanceProgress.set({ done: 0, total: codesToCheck.length });
    this.balanceWarningMessage.set('Consulta iniciada: 1 código a cada 10 segundos.');

    const lookupByCode = { ...this.balanceLookupByCode() };
    const processedCodes: string[] = [];
    const dirtyCodes: string[] = [];

    try {
      for (let index = 0; index < codesToCheck.length; index += 1) {
        while (this.isBalancePaused()) {
          if (dirtyCodes.length > 0) {
            await this.persistLatestBalanceSnapshot(lookupByCode, dirtyCodes);
            dirtyCodes.length = 0;
          }
          await this.sleep(300);
        }

        const code = codesToCheck[index];
        const lookup = await this.fetchBalanceForCode(code, forceRefresh);
        lookupByCode[code] = lookup;
        processedCodes.push(code);
        dirtyCodes.push(code);

        if (this.isRateLimitError(lookup.error)) {
          this.balanceWarningMessage.set(
            `A API retornou limite de consultas (HTTP 429). Aguardando ${Math.round(this.RATE_LIMIT_PAUSE_MS / 1000)} segundos para continuar.`
          );
          await this.sleep(this.RATE_LIMIT_PAUSE_MS);
        }

        this.balanceLookupByCode.set({ ...lookupByCode });
        this.balanceProgress.update(progress => ({
          total: progress.total,
          done: Math.min(progress.total, progress.done + 1),
        }));

        if (dirtyCodes.length >= this.SNAPSHOT_SAVE_INTERVAL) {
          await this.persistLatestBalanceSnapshot(lookupByCode, dirtyCodes);
          dirtyCodes.length = 0;
        }

        const hasMoreCodes = index + 1 < codesToCheck.length;
        if (hasMoreCodes) {
          await this.sleep(this.BALANCE_REQUEST_DELAY_MS);
        }
      }

      const latestCheckedAt = this.resolveLatestCheckedAt(lookupByCode, processedCodes);
      if (latestCheckedAt !== null) {
        this.lastBalanceCheckAt.set(latestCheckedAt);
      }

      if (dirtyCodes.length > 0) {
        await this.persistLatestBalanceSnapshot(lookupByCode, dirtyCodes);
      }

      const remainingErrors = this.countErrorCodes(allCodesInFilter, lookupByCode);
      if (remainingErrors > 0) {
        this.balanceWarningMessage.set(
          `Consulta concluída. ${remainingErrors} itens permaneceram com erro e serão tentados novamente na próxima execução.`
        );
      } else {
        this.balanceWarningMessage.set('Consulta concluída com sucesso.');
      }
    } finally {
      this.isCheckingBalances.set(false);
      this.isBalancePaused.set(false);
    }
  }

  onBalancePrimaryAction(): void {
    if (!this.isCheckingBalances()) {
      void this.checkStockBalances(false);
      return;
    }

    this.toggleBalancePause();
  }

  toggleBalancePause(): void {
    if (!this.isCheckingBalances()) return;

    const nextPausedState = !this.isBalancePaused();
    this.isBalancePaused.set(nextPausedState);

    if (nextPausedState) {
      this.balanceWarningMessage.set('Consulta pausada pelo administrador.');
      return;
    }

    this.balanceWarningMessage.set('Consulta retomada.');
  }

  async refreshSingleItemBalance(code: string): Promise<void> {
    if (!this.isAdmin()) {
      this.balanceWarningMessage.set('A atualização individual de saldo está habilitada apenas para administradores.');
      return;
    }

    if (this.isCheckingBalances()) {
      this.balanceWarningMessage.set('Pause a consulta em lote para atualizar um item manualmente.');
      return;
    }

    const normalizedCode = this.normalizeMaterialCode(code);
    if (!normalizedCode) {
      this.balanceWarningMessage.set('Código inválido para atualização de saldo.');
      return;
    }

    if (this.isCodeUpdateInProgress(normalizedCode)) {
      return;
    }

    this.setCodeUpdateInProgress(normalizedCode, true);
    try {
      const lookup = await this.fetchBalanceForCode(normalizedCode, true);
      const nextLookupByCode = {
        ...this.balanceLookupByCode(),
        [normalizedCode]: lookup,
      };

      this.balanceLookupByCode.set(nextLookupByCode);
      this.lastBalanceCheckAt.set(
        this.lastBalanceCheckAt()
          ? Math.max(this.lastBalanceCheckAt() as number, lookup.checkedAt)
          : lookup.checkedAt
      );

      await this.persistLatestBalanceSnapshot(nextLookupByCode, [normalizedCode]);

      if (lookup.error) {
        this.balanceWarningMessage.set(`Saldo atualizado com erro para o código ${normalizedCode}: ${lookup.error}`);
      } else {
        this.balanceWarningMessage.set(`Saldo do código ${normalizedCode} atualizado com sucesso.`);
      }
    } finally {
      this.setCodeUpdateInProgress(normalizedCode, false);
    }
  }

  isCodeUpdateInProgress(code: string): boolean {
    const normalizedCode = this.normalizeMaterialCode(code);
    if (!normalizedCode) return false;
    return !!this.rowBalanceUpdateState()[normalizedCode];
  }

  onAreaChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedArea.set(select.value);
  }

  clearFilters(): void {
    this.selectedArea.set('all');
    this.codeFilter.set('');
  }

  filterContextLabel(): string {
    const area = this.selectedArea();
    const code = this.codeFilter().trim();
    const parts: string[] = [];
    if (area !== 'all') {
      parts.push(`área: ${area}`);
    }
    if (code) {
      parts.push(`código: "${code}"`);
    }
    if (parts.length === 0) {
      return 'Exibindo dados consolidados de todas as areas.';
    }
    return `Filtrando por ${parts.join(', ')}.`;
  }

  balanceStatusLabel(status: SafetyBalanceStatus): string {
    switch (status) {
      case 'ok': return 'Coberto';
      case 'below': return 'Abaixo';
      case 'out': return 'Sem saldo';
      case 'error': return 'Erro';
      default: return 'Nao consultado';
    }
  }

  balanceStatusClass(status: SafetyBalanceStatus): string {
    switch (status) {
      case 'ok': return 'status-pill status-ok';
      case 'below': return 'status-pill status-below';
      case 'out': return 'status-pill status-out';
      case 'error': return 'status-pill status-error';
      default: return 'status-pill status-unchecked';
    }
  }

  exportItemsToExcel(): void {
    const exportedItems = this.filteredItems()
      .slice()
      .sort((a, b) => {
        if (a.area !== b.area) return a.area.localeCompare(b.area, 'pt-BR');
        return b.totalValue - a.totalValue;
      });

    if (exportedItems.length === 0) {
      alert('Nao ha itens para exportar.');
      return;
    }

    try {
      const now = new Date();
      const workbook = XLSX.utils.book_new();
      const header = ['Codigo', 'Descricao', 'Area', 'Unidade', 'Qtd. Est. Seg.', 'Valor UN', 'Valor Total'];
      const rows = exportedItems.map(item => ([
        item.code,
        item.description,
        item.area,
        item.unit,
        item.safetyStockQty,
        item.unitValue,
        item.totalValue,
      ]));
      const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
      sheet['!cols'] = [
        { wch: 16 },
        { wch: 50 },
        { wch: 24 },
        { wch: 10 },
        { wch: 14 },
        { wch: 15 },
        { wch: 18 },
      ];

      const endRow = rows.length + 1;
      sheet['!autofilter'] = { ref: `A1:G${endRow}` };
      this.applyCellFormat(sheet, `E2:E${endRow}`, '#,##0.00');
      this.applyCellFormat(sheet, `F2:F${endRow}`, this.currencyFormat());
      this.applyCellFormat(sheet, `G2:G${endRow}`, this.currencyFormat());

      XLSX.utils.book_append_sheet(workbook, sheet, 'Estoque_Seguranca');

      const fileDate = now.toISOString().slice(0, 10);
      const areaSuffix = this.selectedArea() === 'all'
        ? 'todas_as_areas'
        : this.selectedArea()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .toLowerCase();
      XLSX.writeFile(workbook, `Estoque_Seguranca_${areaSuffix}_${fileDate}.xlsx`);
    } catch (error) {
      console.error('[SafetyStock] Error exporting excel:', error);
      alert('Erro ao exportar arquivo Excel.');
    }
  }

  getAreaBarWidth(totalValue: number): number {
    return Math.max(6, (totalValue / this.maxAreaTotal()) * 100);
  }

  private async loadLatestBalanceSnapshot(): Promise<void> {
    const { data, error } = await this.safetyStockService.getLatestBalanceSnapshot();

    if (error) {
      console.warn('[SafetyStock] Nao foi possivel carregar snapshot de saldo:', error);
      if (this.isAdmin() && this.isMissingSnapshotTableError(error)) {
        this.balanceWarningMessage.set(
          'A tabela de snapshot de saldo ainda nao foi criada no Supabase. Execute o SQL de configuracao para compartilhar a atualizacao com os usuarios.'
        );
      }
      return;
    }

    if (!data) {
      return;
    }

    this.balanceLookupByCode.set(data.lookupByCode);
    this.lastBalanceCheckAt.set(data.lastCheckedAt);
    this.lastBalanceUpdatedBy.set(data.updatedByName);
    this.pruneBalanceLookupsToKnownCodes();
  }

  private async persistLatestBalanceSnapshot(
    lookupByCode: Record<string, SafetyStockBalanceLookup>,
    materialCodes: string[]
  ): Promise<void> {
    const user = this.currentUser();
    if (!user || user.role !== 'Admin') {
      return;
    }

    const { error } = await this.safetyStockService.saveBalanceSnapshot(
      lookupByCode,
      materialCodes,
      user.id,
      user.name
    );

    if (error) {
      console.error('[SafetyStock] Erro ao salvar snapshot de saldo:', error);
      if (!this.balanceWarningMessage()) {
        this.balanceWarningMessage.set(
          'Consulta concluida, mas falhou ao publicar a atualizacao para outros usuarios.'
        );
      }
      return;
    }

    this.lastBalanceUpdatedBy.set(user.name);
  }

  private resolveLatestCheckedAt(
    lookupByCode: Record<string, SafetyStockBalanceLookup>,
    materialCodes: string[]
  ): number | null {
    const timestamps = materialCodes
      .map(code => lookupByCode[code]?.checkedAt ?? null)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (timestamps.length === 0) {
      return null;
    }

    return Math.max(...timestamps);
  }

  private isMissingSnapshotTableError(error: any): boolean {
    const normalized = JSON.stringify(error || '').toLowerCase();
    return normalized.includes('42p01')
      || (normalized.includes('safety_stock_balance_snapshot') && normalized.includes('does not exist'))
      || normalized.includes('could not find the table');
  }

  private async fetchBalanceForCode(code: string, forceRefresh: boolean): Promise<SafetyStockBalanceLookup> {
    const normalizedCode = this.normalizeMaterialCode(code);
    if (!normalizedCode) {
      return { currentStock: null, checkedAt: Date.now(), error: 'Codigo invalido para consulta.' };
    }

    const cached = this.balanceCache.get(normalizedCode);
    const isCacheValid =
      !!cached
      && !cached.lookup.error
      && (Date.now() - cached.timestamp) <= this.BALANCE_CACHE_TTL_MS;
    if (!forceRefresh && isCacheValid) {
      return cached.lookup;
    }

    try {
      const response = await this.queryMaterialWithTimeoutRetry(normalizedCode);
      if (!response?.success || !response.data) {
        const errorMessage = response?.error || 'Material nao encontrado na API de saldo.';
        const errorLookup: SafetyStockBalanceLookup = {
          currentStock: null,
          checkedAt: Date.now(),
          error: errorMessage,
        };
        this.balanceCache.set(normalizedCode, { timestamp: Date.now(), lookup: errorLookup });
        return errorLookup;
      }

      const stocksAtTargetLocation: StockInfo[] = (response.data.estoques || [])
        .filter((stock: StockInfo) => this.isTargetStockLocation(stock?.localizacao));

      const currentStock = stocksAtTargetLocation
        .reduce((sum: number, stock: StockInfo) => sum + this.parseBalanceQuantity(stock.qAtual), 0);

      const successLookup: SafetyStockBalanceLookup = {
        currentStock,
        checkedAt: Date.now(),
        error: null,
      };
      this.balanceCache.set(normalizedCode, { timestamp: Date.now(), lookup: successLookup });
      return successLookup;
    } catch (error: any) {
      const fallbackLookup: SafetyStockBalanceLookup = {
        currentStock: null,
        checkedAt: Date.now(),
        error: error?.message || 'Falha ao consultar saldo na API.',
      };
      this.balanceCache.set(normalizedCode, { timestamp: Date.now(), lookup: fallbackLookup });
      return fallbackLookup;
    }
  }

  private uniqueCodesForCurrentFilter(): string[] {
    const codes = this.filteredItems()
      .map(item => this.normalizeMaterialCode(item.code))
      .filter(code => !!code);
    return Array.from(new Set(codes));
  }

  private selectCodesForSafeRun(allCodes: string[], forceRefresh: boolean): string[] {
    const lookupByCode = this.balanceLookupByCode();

    const sorted = [...allCodes].sort((codeA, codeB) => {
      const lookupA = lookupByCode[codeA];
      const lookupB = lookupByCode[codeB];

      const checkedAtA = lookupA?.checkedAt ?? 0;
      const checkedAtB = lookupB?.checkedAt ?? 0;

      if (!forceRefresh) {
        const hasErrorA = !!lookupA?.error;
        const hasErrorB = !!lookupB?.error;
        if (hasErrorA !== hasErrorB) {
          return hasErrorA ? -1 : 1;
        }
      }

      if (checkedAtA !== checkedAtB) {
        return checkedAtA - checkedAtB;
      }

      return codeA.localeCompare(codeB, 'pt-BR');
    });

    if (forceRefresh) {
      return sorted;
    }

    return sorted
      .filter(code => this.isPendingForCheck(lookupByCode[code]));
  }

  private countErrorCodes(
    allCodes: string[],
    lookupByCode: Record<string, SafetyStockBalanceLookup>
  ): number {
    return allCodes.filter(code => !!lookupByCode[code]?.error).length;
  }

  private isPendingForCheck(lookup: SafetyStockBalanceLookup | undefined): boolean {
    if (!lookup) return true;
    return !!lookup.error;
  }

  private setCodeUpdateInProgress(code: string, inProgress: boolean): void {
    const normalizedCode = this.normalizeMaterialCode(code);
    if (!normalizedCode) return;

    this.rowBalanceUpdateState.update(currentState => {
      const nextState = { ...currentState };
      if (inProgress) {
        nextState[normalizedCode] = true;
      } else {
        delete nextState[normalizedCode];
      }
      return nextState;
    });
  }

  private normalizeMaterialCode(code: string): string {
    const raw = String(code || '').trim();
    if (!raw) return '';

    const compact = raw.replace(/\s+/g, '');
    const alphaNumericCode = compact.replace(/[^\dA-Za-z]/g, '');
    if (!alphaNumericCode) return '';

    const asDecimal = compact.replace(',', '.');
    if (/^\d+\.(0+)$/.test(asDecimal)) {
      return asDecimal.split('.')[0];
    }

    if (/^[\d.,]+$/.test(compact)) {
      const digitsOnly = compact.replace(/[^\d]/g, '');
      if (digitsOnly.length > 0) {
        return digitsOnly;
      }
    }

    return alphaNumericCode;
  }

  private isRateLimitError(errorMessage: string | null | undefined): boolean {
    if (!errorMessage) return false;
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('429')
      || normalized.includes('rate limit')
      || normalized.includes('limite de consultas');
  }

  private isTimeoutLookupError(errorMessage: string | null | undefined): boolean {
    if (!errorMessage) return false;
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('timeout')
      || normalized.includes('tempo limite')
      || normalized.includes('upstream_timeout');
  }

  private async queryMaterialWithTimeoutRetry(code: string): Promise<MaterialApiResponse> {
    const firstAttempt = await firstValueFrom(this.materialService.getMaterialByCode(code));
    if (!firstAttempt?.success && this.isTimeoutLookupError(firstAttempt?.error)) {
      await this.sleep(2500);
      return firstValueFrom(this.materialService.getMaterialByCode(code));
    }
    return firstAttempt;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseBalanceQuantity(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (value === null || value === undefined) return 0;

    const text = String(value)
      .trim()
      .replace(/\s+/g, '')
      .replace(/[^\d,.-]/g, '');

    if (!text) return 0;

    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private isTargetStockLocation(location: unknown): boolean {
    return this.normalizeLocationCode(location) === this.TARGET_STOCK_LOCATION;
  }

  private normalizeLocationCode(location: unknown): string {
    const onlyDigits = String(location ?? '').replace(/[^\d]/g, '');
    if (!onlyDigits) return '';

    const asNumber = Number(onlyDigits);
    if (!Number.isFinite(asNumber)) return '';

    return String(asNumber);
  }

  private pruneBalanceLookupsToKnownCodes(): void {
    const validCodes = new Set(this.items().map(item => this.normalizeMaterialCode(item.code)));
    const nextLookup: Record<string, SafetyStockBalanceLookup> = {};

    Object.entries(this.balanceLookupByCode()).forEach(([code, lookup]) => {
      if (validCodes.has(code)) {
        nextLookup[code] = lookup;
      }
    });

    this.balanceLookupByCode.set(nextLookup);
  }

  private applyCellFormat(sheet: XLSX.WorkSheet, range: string, format: string): void {
    const decoded = XLSX.utils.decode_range(range);
    for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
      for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address];
        if (cell) {
          cell.z = format;
        }
      }
    }
  }

  private currencyFormat(): string {
    return '"R$" #,##0.00';
  }
}
