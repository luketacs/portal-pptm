import { HistoryEvent, MaterialType, Priority, PurchaseRequest, RequestStatus } from '../models/request.model';
import { UserProfile } from '../models/user.model';
import type { HistoryEventRaw, PurchaseRequestRow } from '../models/database.types';

export function mapRequester(row: PurchaseRequestRow): UserProfile {
  const r = row.requester;
  return {
    id: r?.id || row.requester_id || 'desconhecido',
    name: r?.name || 'Solicitante não identificado',
    email: r?.email || '',
    department: r?.department || '',
    position: r?.position || '',
    role: (r?.role as UserProfile['role']) || 'Solicitante',
    must_change_password: r?.must_change_password ?? false,
  };
}

export function normalizeMaterialType(value: string): MaterialType {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  if (normalized.includes('mec')) return 'Mecânica';
  if (normalized.includes('ele')) return 'Elétrica';
  if (normalized.includes('refrig')) return 'Refrigeração';
  if (normalized === 'spci') return 'SPCI';
  return 'Outros';
}

export function parseHistoryDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brMatch) {
    const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = brMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const nativeParsed = new Date(raw);
  return Number.isNaN(nativeParsed.getTime()) ? null : nativeParsed;
}

export function mapRequestFromDb(r: PurchaseRequestRow): PurchaseRequest {
  const rawHistory = Array.isArray(r.history) ? (r.history as HistoryEventRaw[]) : [];
  const history = rawHistory.map((h) => ({
    date: parseHistoryDate(h?.date) ?? new Date(NaN),
    user: { id: h.user?.id ?? '', name: h.user?.name ?? '', role: h.user?.role ?? '' },
    action: h.action ?? '',
    details: h.details ?? '',
  } satisfies HistoryEvent));

  return {
    id: r.id,
    requester: mapRequester(r),
    materialCode: r.material_code,
    description: r.description,
    quantity: r.quantity,
    unit: r.unit,
    materialType: normalizeMaterialType(r.material_type),
    workOrder: r.workorder ?? '',
    priority: r.priority as Priority,
    justification: r.justification ?? '',
    requestDate: new Date(r.requestdate),
    status: r.status as RequestStatus,
    history,
    supplier: r.supplier ?? undefined,
    unitValue: r.unitvalue ?? undefined,
    totalValue: r.totalvalue ?? undefined,
    approvedValue: r.approvedvalue ?? undefined,
    scNumber: r.scnumber ?? undefined,
    responsibleBuyer: r.responsiblebuyer ?? undefined,
    orderNumber: r.ordernumber ?? undefined,
    deliveryDate: r.deliverydate ? new Date(r.deliverydate) : undefined,
    materialReceivedDate: r.materialreceiveddate ? new Date(r.materialreceiveddate) : undefined,
    internalNotes: r.internalnotes ?? undefined,
    portalApprovedBy: r.portalapprovedby ?? undefined,
    portalApprovedAt: r.portalapprovedat ? new Date(r.portalapprovedat) : undefined,
    mrpApprovedBy: r.mrpapprovedby ?? undefined,
    mrpApprovedAt: r.mrpapprovedat ? new Date(r.mrpapprovedat) : undefined,
    rdApprovedBy: r.rdapprovedby ?? undefined,
    rdApprovedAt: r.rdapprovedat ? new Date(r.rdapprovedat) : undefined,
    finishedAt: r.finishedat ? new Date(r.finishedat) : undefined,
  };
}
