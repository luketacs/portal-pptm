export interface SafetyStockItem {
  code: string;
  description: string;
  unit: string;
  area: string;
  safetyStockQty: number;
  unitValue: number;
  totalValue: number;
}

export interface SafetyStockAreaSummary {
  area: string;
  itemCount: number;
  totalSafetyStockQty: number;
  totalValue: number;
}

export interface SafetyStockSummary {
  totalItems: number;
  totalAreas: number;
  totalSafetyStockQty: number;
  totalValue: number;
}

export interface SafetyStockDataset {
  items: SafetyStockItem[];
  areaSummaries: SafetyStockAreaSummary[];
  summary: SafetyStockSummary;
  source?: 'views' | 'table' | 'empty';
  diagnostics?: string[];
}

export interface SafetyStockBalanceSnapshotLookup {
  currentStock: number | null;
  checkedAt: number;
  error: string | null;
}

export interface SafetyStockBalanceSnapshotData {
  lookupByCode: Record<string, SafetyStockBalanceSnapshotLookup>;
  lastCheckedAt: number | null;
  updatedByName: string | null;
}
