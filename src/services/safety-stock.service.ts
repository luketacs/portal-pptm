import { Injectable } from '@angular/core';
import { SupabaseRestService } from './supabase-rest.service';
import { SupabaseService } from './supabase.service';
import {
  SafetyStockAreaSummary,
  SafetyStockBalanceSnapshotData,
  SafetyStockBalanceSnapshotLookup,
  SafetyStockDataset,
  SafetyStockItem,
  SafetyStockSummary,
} from '../models/safety-stock.model';

@Injectable({ providedIn: 'root' })
export class SafetyStockService {
  private readonly TABLE_NAME = 'est-seg';
  private readonly DETAIL_VIEW_NAME = 'vw_est_seg_detalhe';
  private readonly AREA_VIEW_NAME = 'vw_est_seg_por_area';
  private readonly SNAPSHOT_TABLE_NAME = 'safety_stock_balance_snapshot';
  private readonly SNAPSHOT_UPSERT_BATCH_SIZE = 200;
  private readonly SUPABASE_OPERATION_TIMEOUT_MS = 10000;

  constructor(
    private supabaseRestService: SupabaseRestService,
    private supabaseService: SupabaseService
  ) {}

  private async supabaseRestGet<T>(path: string): Promise<{ data: T | null; error: any }> {
    return this.supabaseRestService.get<T>(path, this.SUPABASE_OPERATION_TIMEOUT_MS);
  }

  async getSafetyStockData(): Promise<{ data: SafetyStockDataset | null; error: any }> {
    try {
      const diagnostics: string[] = [];

      const fromViews = await this.getFromViews(diagnostics);
      if (fromViews.data && fromViews.data.items.length > 0) {
        return { data: fromViews.data, error: null };
      }

      const fromTable = await this.getFromRawTable(diagnostics);
      if (fromTable.data && fromTable.data.items.length > 0) {
        return { data: fromTable.data, error: null };
      }

      if (fromViews.error && fromTable.error) {
        return {
          data: null,
          error: {
            message: 'Falha ao ler estoque de segurança.',
            details: diagnostics.join(' | '),
          },
        };
      }

      if (diagnostics.length === 0) {
        diagnostics.push(
          'Nenhuma linha retornada. Verifique se existe dado publicado e policy RLS de SELECT para authenticated.'
        );
      }

      const emptyData: SafetyStockDataset = {
        items: [],
        areaSummaries: [],
        summary: {
          totalItems: 0,
          totalAreas: 0,
          totalSafetyStockQty: 0,
          totalValue: 0,
        },
        source: 'empty',
        diagnostics,
      };
      return {
        data: emptyData,
        error: null,
      };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async getLatestBalanceSnapshot(): Promise<{ data: SafetyStockBalanceSnapshotData | null; error: any }> {
    const queryPath =
      `${this.SNAPSHOT_TABLE_NAME}?select=material_code,current_stock,error_message,checked_at,updated_by_name&order=checked_at.desc&limit=10000`;

    const { data: rows, error } = await this.supabaseRestGet<Record<string, unknown>[]>(queryPath);
    if (error) {
      return { data: null, error };
    }

    const lookupByCode: Record<string, SafetyStockBalanceSnapshotLookup> = {};
    let lastCheckedAt: number | null = null;
    let updatedByName: string | null = null;

    (rows || []).forEach(row => {
      const code = this.normalizeMaterialCode(
        this.parseText(this.getRowValue(row, ['material_code', 'code']))
      );
      if (!code) return;

      const checkedAt = this.parseTimestamp(this.getRowValue(row, ['checked_at']));
      if (checkedAt === null) return;

      if (lastCheckedAt === null || checkedAt > lastCheckedAt) {
        lastCheckedAt = checkedAt;
        const updaterName = this.parseText(this.getRowValue(row, ['updated_by_name']));
        updatedByName = updaterName || null;
      }

      lookupByCode[code] = {
        currentStock: this.parseNullableNumber(this.getRowValue(row, ['current_stock'])),
        checkedAt,
        error: this.parseText(this.getRowValue(row, ['error_message'])) || null,
      };
    });

    return {
      data: {
        lookupByCode,
        lastCheckedAt,
        updatedByName,
      },
      error: null,
    };
  }

  async saveBalanceSnapshot(
    lookupByCode: Record<string, SafetyStockBalanceSnapshotLookup>,
    materialCodes: string[],
    updatedByUserId: string,
    updatedByName: string
  ): Promise<{ data: { savedCount: number } | null; error: any }> {
    const normalizedCodes = Array.from(
      new Set(
        materialCodes
          .map(code => this.normalizeMaterialCode(code))
          .filter(code => !!code)
      )
    );

    const payload = normalizedCodes
      .map(code => {
        const lookup = lookupByCode[code];
        if (!lookup) {
          return null;
        }

        return {
          material_code: code,
          current_stock: lookup.currentStock,
          error_message: lookup.error,
          checked_at: new Date(lookup.checkedAt).toISOString(),
          updated_by: updatedByUserId,
          updated_by_name: updatedByName,
        };
      })
      .filter((row): row is {
        material_code: string;
        current_stock: number | null;
        error_message: string | null;
        checked_at: string;
        updated_by: string;
        updated_by_name: string;
      } => !!row);

    if (payload.length === 0) {
      return { data: { savedCount: 0 }, error: null };
    }

    let savedCount = 0;
    for (let index = 0; index < payload.length; index += this.SNAPSHOT_UPSERT_BATCH_SIZE) {
      const chunk = payload.slice(index, index + this.SNAPSHOT_UPSERT_BATCH_SIZE);

      const { error } = await this.supabaseService.client
        .from(this.SNAPSHOT_TABLE_NAME)
        .upsert(chunk, { onConflict: 'material_code' });

      if (error) {
        return { data: null, error };
      }

      savedCount += chunk.length;
    }

    return { data: { savedCount }, error: null };
  }

  private async getFromViews(diagnostics: string[]): Promise<{ data: SafetyStockDataset | null; error: any }> {
    const { data: detailRows, error: detailError } = await this.supabaseRestGet<Record<string, unknown>[]>(
      `${this.DETAIL_VIEW_NAME}?select=*`
    );

    if (detailError) {
      diagnostics.push(`view detalhe: ${this.normalizeError(detailError)}`);
      return { data: null, error: detailError };
    }

    const items = this.mapRowsToItems(detailRows || []);

    const { data: areaRows, error: areaError } = await this.supabaseRestGet<Record<string, unknown>[]>(
      `${this.AREA_VIEW_NAME}?select=*`
    );

    let areaSummaries: SafetyStockAreaSummary[];
    if (areaError) {
      diagnostics.push(`view area: ${this.normalizeError(areaError)}`);
      areaSummaries = this.buildAreaSummaries(items);
    } else {
      areaSummaries = this.mapRowsToAreaSummaries(areaRows || []);
      if (areaSummaries.length === 0 && items.length > 0) {
        areaSummaries = this.buildAreaSummaries(items);
      }
    }

    const summary = this.buildSummary(items, areaSummaries);
    return {
      data: {
        items,
        areaSummaries,
        summary,
        source: 'views',
        diagnostics,
      },
      error: null,
    };
  }

  private async getFromRawTable(diagnostics: string[]): Promise<{ data: SafetyStockDataset | null; error: any }> {
    const { data: rows, error } = await this.getSafetyStockRows();
    if (error) {
      diagnostics.push(`tabela ${this.TABLE_NAME}: ${this.normalizeError(error)}`);
      return { data: null, error };
    }

    const items = this.mapRowsToItems(rows || []);
    const areaSummaries = this.buildAreaSummaries(items);
    const summary = this.buildSummary(items, areaSummaries);

    return {
      data: {
        items,
        areaSummaries,
        summary,
        source: 'table',
        diagnostics,
      },
      error: null,
    };
  }

  private async getSafetyStockRows(): Promise<{ data: Record<string, unknown>[] | null; error: any }> {
    const fullSelect = await this.supabaseRestGet<Record<string, unknown>[]>(`${this.TABLE_NAME}?select=*`);

    if (!fullSelect.error) {
      return fullSelect;
    }

    const errorAsText = JSON.stringify(fullSelect.error || '').toLowerCase();
    const isNumericCastError =
      errorAsText.includes('22p02') || errorAsText.includes('invalid input syntax for type numeric');

    if (!isNumericCastError) {
      return fullSelect;
    }

    // Fallback: avoid selecting derived/problematic columns and keep only the raw import fields.
    const safeSelectPath =
      `${this.TABLE_NAME}?select=%22Codigo%22,%22Descricao%22,%22Unidade%22,%22EstSeg-PPTM%22,%22Valor_UN%22,%22%C3%81rea%22`;

    const safeSelect = await this.supabaseRestGet<Record<string, unknown>[]>(safeSelectPath);
    if (!safeSelect.error) {
      return safeSelect;
    }

    return fullSelect;
  }

  private mapRowsToItems(rows: Record<string, unknown>[]): SafetyStockItem[] {
    return rows
      .map((row, index) => this.mapRowToItem(row, index))
      .filter(item => item.code || item.description || item.totalValue > 0);
  }

  private mapRowsToAreaSummaries(rows: Record<string, unknown>[]): SafetyStockAreaSummary[] {
    return rows
      .map(row => {
        const area = this.normalizeAreaLabel(
          this.parseText(this.getRowValue(row, ['area'])) || 'Sem área'
        );
        const itemCount = this.parseNumber(this.getRowValue(row, ['qtd_itens', 'item_count', 'total_itens']));
        const totalValue = this.parseNumber(
          this.getRowValue(row, ['valor_total_area', 'total_value', 'valor_total'])
        );
        const totalSafetyStockQty = this.parseNumber(
          this.getRowValue(row, ['qtd_total_est_seg', 'total_safety_stock_qty', 'qtd_est_seg'])
        );

        return {
          area,
          itemCount,
          totalSafetyStockQty,
          totalValue,
        };
      })
      .filter(summary => summary.area)
      .sort((a, b) => b.totalValue - a.totalValue);
  }

  private mapRowToItem(row: Record<string, unknown>, index: number): SafetyStockItem {
    const code = this.parseText(
      this.getRowValue(row, ['codigo', 'code', 'cod_material', 'material_code'])
    ) || `item-${index + 1}`;

    const description = this.parseText(
      this.getRowValue(row, ['descricao', 'description', 'descricao_breve'])
    ) || 'Sem descrição';

    const unit = this.parseText(
      this.getRowValue(row, ['unidade', 'unit', 'uom'])
    ) || '-';

    const area = this.parseText(
      this.getRowValue(row, ['area', 'setor', 'departamento', 'grupo_area'])
    ) || 'Sem área';

    const safetyStockQty = this.parseNumber(
      this.getRowValue(row, [
        'estseg-pptm',
        'est_seg_pptm',
        'estoque_seguranca',
        'qtd_estoque_seguranca',
        'qtd_est_seg',
      ])
    );

    const unitValue = this.parseNumber(
      this.getRowValue(row, ['valor_un', 'valor_unitario', 'unit_value', 'preco_unitario'])
    );

    const totalValueFromRow = this.parseNumber(
      this.getRowValue(row, ['valor_total_item', 'total_value', 'valor_total'])
    );
    const calculatedTotal = safetyStockQty * unitValue;

    return {
      code,
      description,
      unit,
      area: this.normalizeAreaLabel(area),
      safetyStockQty,
      unitValue,
      totalValue: totalValueFromRow > 0 ? totalValueFromRow : calculatedTotal,
    };
  }

  private buildAreaSummaries(items: SafetyStockItem[]): SafetyStockAreaSummary[] {
    const areaMap = new Map<string, SafetyStockAreaSummary>();

    items.forEach(item => {
      const current = areaMap.get(item.area) || {
        area: item.area,
        itemCount: 0,
        totalSafetyStockQty: 0,
        totalValue: 0,
      };

      current.itemCount += 1;
      current.totalSafetyStockQty += item.safetyStockQty;
      current.totalValue += item.totalValue;

      areaMap.set(item.area, current);
    });

    return Array.from(areaMap.values()).sort((a, b) => b.totalValue - a.totalValue);
  }

  private buildSummary(
    items: SafetyStockItem[],
    areaSummaries: SafetyStockAreaSummary[]
  ): SafetyStockSummary {
    return {
      totalItems: items.length,
      totalAreas: areaSummaries.length,
      totalSafetyStockQty: items.reduce((sum, item) => sum + item.safetyStockQty, 0),
      totalValue: items.reduce((sum, item) => sum + item.totalValue, 0),
    };
  }

  private getRowValue(row: Record<string, unknown>, candidates: string[]): unknown {
    const normalizedRow = new Map<string, unknown>();

    Object.entries(row).forEach(([key, value]) => {
      normalizedRow.set(this.normalizeKey(key), value);
    });

    for (const candidate of candidates) {
      const value = normalizedRow.get(this.normalizeKey(candidate));
      if (!this.isEmpty(value)) {
        return value;
      }
    }

    return undefined;
  }

  private parseText(value: unknown): string {
    if (this.isEmpty(value)) {
      return '';
    }
    return String(value).trim();
  }

  private normalizeAreaLabel(area: string): string {
    return area
      .replace(/\bmecãnica\b/gi, 'Mecânica')
      .replace(/\bmecanica\b/gi, 'Mecânica');
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

  private parseNumber(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (this.isEmpty(value)) {
      return 0;
    }

    let text = String(value)
      .trim()
      .replace(/\s+/g, '')
      .replace(/R\$/gi, '')
      .replace(/[^\d,.-]/g, '');

    if (!text) {
      return 0;
    }

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma || hasDot) {
      const decimalSeparator = hasComma && hasDot
        ? (text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.')
        : (hasComma ? ',' : '.');

      const split = text.split(decimalSeparator);
      const hasManyGroups = split.length > 2;
      const groupsAfterFirst = split.slice(1);
      const allThousandsGroups = groupsAfterFirst.length > 0 && groupsAfterFirst.every(group => group.length === 3);

      let integerPart = '';
      let decimalPart = '';

      if (hasManyGroups && allThousandsGroups) {
        integerPart = split.join('');
      } else if (split.length > 1) {
        integerPart = split.slice(0, -1).join('');
        decimalPart = split[split.length - 1];
      } else {
        integerPart = split[0];
      }

      integerPart = integerPart.replace(/[.,]/g, '');
      decimalPart = decimalPart.replace(/[.,]/g, '');

      if (!decimalPart && split.length === 2) {
        const maybeThousands = split[1].length === 3 && split[0] !== '0';
        if (maybeThousands) {
          integerPart = `${split[0]}${split[1]}`.replace(/[.,]/g, '');
        } else {
          decimalPart = split[1].replace(/[.,]/g, '');
        }
      }

      text = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private parseNullableNumber(value: unknown): number | null {
    if (this.isEmpty(value)) {
      return null;
    }

    const parsed = this.parseNumber(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseTimestamp(value: unknown): number | null {
    if (this.isEmpty(value)) {
      return null;
    }

    const asDate = new Date(String(value));
    const time = asDate.getTime();
    return Number.isFinite(time) ? time : null;
  }

  private isEmpty(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  }

  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizeError(error: any): string {
    if (!error) {
      return 'erro desconhecido';
    }
    return (
      error.message ||
      error.details ||
      error.hint ||
      JSON.stringify(error)
    );
  }
}
