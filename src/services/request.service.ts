import { Injectable, computed, signal } from '@angular/core';
import { HistoryEvent, PurchaseRequest, RequestStatus } from '../models/request.model';
import { UserProfile } from '../models/user.model';
import { NotificationService } from './notification.service';
import { SupabaseRestService } from './supabase-rest.service';
import { AuditLogService } from './audit-log.service';
import type { PurchaseRequestRow } from '../models/database.types';
import { withRetry } from '../utils/retry';
import { mapRequestFromDb as mapRequestFromDbUtil } from '../utils/request-mapper';
import { removerDaLista, upsertNaLista } from '../utils/lista-local';

interface StatusValidation {
  valid: boolean;
  error?: string;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos

// id.desc desempata: itens criados juntos gravam o mesmo requestdate e, sem desempate, a
// ordem entre eles muda de uma consulta pra outra (ainda mais depois de um UPDATE) — com a
// paginação por offset uma SC escapava entre duas páginas e "sumia" até a próxima carga.
const REQUEST_SELECT = 'select=*,requester:profiles!purchase_requests_requester_id_fkey(id,name,email,role)';
const REQUEST_ORDER = 'order=requestdate.desc,id.desc';

// Mesma ordem do REQUEST_ORDER, pra encaixar na lista em memória a SC gravada.
function ordemRequests(a: PurchaseRequest, b: PurchaseRequest): number {
  const porData = b.requestDate.getTime() - a.requestDate.getTime();
  if (porData !== 0) return porData;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

@Injectable({ providedIn: 'root' })
export class RequestService {
  private _requests = signal<PurchaseRequest[]>([]);
  private _lastFetchedAt = signal<Date | null>(null);

  requests = this._requests.asReadonly();
  lastFetchedAt = this._lastFetchedAt.asReadonly();
  isStale = computed(() => {
    const last = this._lastFetchedAt();
    if (!last) return false;
    return Date.now() - last.getTime() > STALE_THRESHOLD_MS;
  });

  private _inFlight: Promise<void> | null = null;
  private _hasLoaded = false;
  // Muda a cada clearRequests: carga que termina depois do logout não repopula a lista.
  private _generation = 0;
  private readonly OPERATION_TIMEOUT_MS = 10000;
  private readonly MAX_RETRIES = 3;

  constructor(
    private toastService: NotificationService,
    private supabaseRestService: SupabaseRestService,
    private auditLogService: AuditLogService
  ) {}

  private async supabaseRestRequest(
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown
  ): Promise<{ data: null; error: import('../models/database.types').RestError | null }> {
    if (method === 'POST') {
      return this.supabaseRestService.post(path, body, this.OPERATION_TIMEOUT_MS);
    }
    return this.supabaseRestService.patch(path, body, this.OPERATION_TIMEOUT_MS);
  }

  private async supabaseRestDelete(path: string): Promise<{ success: boolean; error: import('../models/database.types').RestError | null }> {
    return this.supabaseRestService.delete(path, this.OPERATION_TIMEOUT_MS);
  }

  private mapRequestFromDb(r: PurchaseRequestRow): PurchaseRequest {
    return mapRequestFromDbUtil(r);
  }

  // Quem chega com uma carga já em andamento espera por ela em vez de sair na hora.
  // Com force, a carga em andamento pode ter começado antes da gravação que pediu o
  // reload — então espera ela terminar e busca de novo (ou pega carona na que outra
  // chamada forçada já disparou).
  async loadRequests(force = false): Promise<void> {
    if (this._inFlight) {
      if (!force) return this._inFlight;
      await this._inFlight.catch(() => undefined);
      if (this._inFlight) return this._inFlight;
    } else if (this._hasLoaded && !force) {
      return;
    }

    // Limpa _inFlight dentro da própria promise: quem está esperando só retoma depois
    // disso, então não confunde a carga velha com uma nova.
    const load: Promise<void> = this.fetchAll(this._generation).finally(() => {
      if (this._inFlight === load) this._inFlight = null;
    });
    this._inFlight = load;
    return load;
  }

  private async fetchAll(generation: number): Promise<void> {
    const { data, error } = await this.supabaseRestService.getAllPaged<PurchaseRequestRow>(
      `purchase_requests?${REQUEST_SELECT}&${REQUEST_ORDER}`,
      this.OPERATION_TIMEOUT_MS
    );

    if (error) {
      throw error;
    }
    if (generation !== this._generation) return;

    const mappedData = (data || []).map(r => this.mapRequestFromDb(r));
    this._requests.set(mappedData);
    this._lastFetchedAt.set(new Date());
    this._hasLoaded = true;
  }

  // Busca uma SC direto no banco quando ela não está na lista em memória (lista ainda
  // carregando, ou carga anterior incompleta) e encaixa o resultado na lista.
  async fetchById(id: string): Promise<PurchaseRequest | undefined> {
    const generation = this._generation;
    const { data, error } = await this.supabaseRestService.get<PurchaseRequestRow[]>(
      `purchase_requests?id=eq.${encodeURIComponent(id)}&${REQUEST_SELECT}`,
      this.OPERATION_TIMEOUT_MS
    );
    if (error || !data?.length || generation !== this._generation) return undefined;

    const found = this.mapRequestFromDb(data[0]);
    this._requests.update(list => upsertNaLista(list, found, ordemRequests));
    return found;
  }

  // Aplica na lista a linha que o banco devolveu na gravação — sem recarregar todas as SCs.
  private aplicarGravada(rows: PurchaseRequestRow[] | null): PurchaseRequest | undefined {
    const row = rows?.[0];
    if (!row) return undefined;
    const gravada = this.mapRequestFromDb(row);
    this._requests.update(list => upsertNaLista(list, gravada, ordemRequests));
    return gravada;
  }

  private async getOrFetch(id: string): Promise<PurchaseRequest | undefined> {
    return this.getById(id) ?? (await this.fetchById(id));
  }

  clearRequests(): void {
    this._generation++;
    this._requests.set([]);
    this._hasLoaded = false;
    this._inFlight = null;
  }

  getById(id: string): PurchaseRequest | undefined {
    return this.requests().find(r => r.id === id);
  }

  getOpenRequestsByMaterialCode(code: string): PurchaseRequest[] {
    const openStatuses: RequestStatus[] = [
      'Pendente',
      'Aprovado no Portal',
      'Aprovado no MRP',
      'SC Criada',
      'Em Cota\u00e7\u00e3o',
      'Aprovado em RD',
      'Pedido Criado',
      'Material Recebido',
    ];

    return this.requests().filter(
      r => r.materialCode.toUpperCase() === code.toUpperCase() && openStatuses.includes(r.status)
    );
  }

  private isNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as Record<string, unknown>;
    const message = String(e['message'] ?? '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch') ||
      e['code'] === 'PGRST301'
    );
  }

  async addRequest(
    request: Omit<PurchaseRequest, 'id' | 'requestDate' | 'status' | 'history'>,
    requester: UserProfile
  ): Promise<void> {
    const historyEvent: HistoryEvent = {
      date: new Date(),
      user: { id: requester.id, name: requester.name, role: requester.role },
      action: 'Solicitação Criada',
      details: 'Solicitação criada no sistema.',
    };

    const newRequestData = {
      id: crypto.randomUUID(),
      requester_id: requester.id,
      material_code: request.materialCode,
      description: request.description,
      quantity: request.quantity,
      unit: request.unit,
      material_type: request.materialType,
      workorder: request.workOrder,
      priority: request.priority,
      justification: request.justification,
      requestdate: new Date().toISOString(),
      status: 'Pendente' as RequestStatus,
      history: [historyEvent],
      supplier: request.supplier || null,
      unitvalue: request.unitValue ?? null,
      totalvalue: request.totalValue ?? null,
      approvedvalue: request.approvedValue ?? null,
      scnumber: request.scNumber || null,
      responsiblebuyer: request.responsibleBuyer || null,
      ordernumber: request.orderNumber || null,
      deliverydate: request.deliveryDate ? request.deliveryDate.toISOString() : null,
      materialreceiveddate: request.materialReceivedDate ? request.materialReceivedDate.toISOString() : null,
      internalnotes: request.internalNotes || null,
    };

    await withRetry(
      async () => {
        const { data, error } = await this.supabaseRestService.postReturning<PurchaseRequestRow>(
          `purchase_requests?${REQUEST_SELECT}`,
          [newRequestData],
          this.OPERATION_TIMEOUT_MS
        );
        if (error?.code === '23505') {
          // Gravou na tentativa anterior mas a resposta se perdeu: busca a linha que ficou.
          const existing = await this.supabaseRestService.get<Array<{ id: string }>>(
            `purchase_requests?id=eq.${newRequestData.id}&select=id`
          );
          if (!existing.error && existing.data?.some(row => row.id === newRequestData.id)) {
            await this.fetchById(newRequestData.id);
            return;
          }
        }
        if (error) throw error;
        this.aplicarGravada(data);
      },
      { maxAttempts: this.MAX_RETRIES, retryIf: e => this.isNetworkError(e) }
    );

    this.toastService.showSuccess('Solicitação enviada com sucesso!');

    this.auditLogService.log({
      user_id: requester.id,
      user_name: requester.name,
      event_type: 'request_created',
      resource_type: 'request',
      description: `${requester.name} criou solicitação de ${request.materialCode} — ${request.description}`,
      metadata: { material_code: request.materialCode, priority: request.priority, material_type: request.materialType },
    });
  }

  private translateFieldName(fieldName: keyof PurchaseRequest): string {
    const translations: { [key in keyof PurchaseRequest]?: string } = {
      requester: 'Solicitante',
      description: 'Descrição',
      quantity: 'Quantidade',
      unit: 'Unidade',
      materialType: 'Tipo de Material',
      workOrder: 'Ordem de Serviço',
      priority: 'Prioridade',
      justification: 'Justificativa',
      supplier: 'Fornecedor',
      unitValue: 'Valor Unitário',
      totalValue: 'Valor Total',
      approvedValue: 'Valor Aprovado',
      scNumber: 'Número da SC',
      responsibleBuyer: 'Comprador Responsável',
      orderNumber: 'Número do Pedido',
      deliveryDate: 'Data de Entrega',
      materialReceivedDate: 'Data de Recebimento',
      internalNotes: 'Observações Internas',
    };
    return translations[fieldName] || fieldName;
  }

  private toSnakeCase(data: Partial<PurchaseRequest>): Record<string, unknown> {
    const snakeCaseData: Record<string, unknown> = {};

    const fieldMap: Record<string, string> = {
      materialCode: 'material_code',
      materialType: 'material_type',
      workOrder: 'workorder',
      requestDate: 'requestdate',
      unitValue: 'unitvalue',
      totalValue: 'totalvalue',
      approvedValue: 'approvedvalue',
      scNumber: 'scnumber',
      responsibleBuyer: 'responsiblebuyer',
      orderNumber: 'ordernumber',
      requester: 'requester_id',
      deliveryDate: 'deliverydate',
      materialReceivedDate: 'materialreceiveddate',
      internalNotes: 'internalnotes',
      portalApprovedBy: 'portalapprovedby',
      portalApprovedAt: 'portalapprovedat',
      mrpApprovedBy: 'mrpapprovedby',
      mrpApprovedAt: 'mrpapprovedat',
      rdApprovedBy: 'rdapprovedby',
      rdApprovedAt: 'rdapprovedat',
      finishedAt: 'finishedat',
    };

    const skipFields = [
      'id',
      'history',
      'portalApprovedBy',
      'portalApprovedAt',
      'mrpApprovedBy',
      'mrpApprovedAt',
      'rdApprovedBy',
      'rdApprovedAt',
      'finishedAt',
    ];

    for (const [key, value] of Object.entries(data)) {
      if (skipFields.includes(key)) {
        continue;
      }

      const dbKey = fieldMap[key] || key;
      if (key === 'requester') {
        const requesterId = (value as UserProfile | undefined)?.id;
        if (requesterId) {
          snakeCaseData[dbKey] = requesterId;
        }
        continue;
      }
      snakeCaseData[dbKey] = value instanceof Date ? value.toISOString() : value;
    }

    return snakeCaseData;
  }

  private sanitizeUpdatePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const numericFields = new Set(['quantity', 'unitvalue', 'totalvalue', 'approvedvalue']);

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;

      if (value instanceof Date) {
        if (!isNaN(value.getTime())) {
          sanitized[key] = value.toISOString();
        }
        continue;
      }

      if (numericFields.has(key)) {
        if (value === null || value === '') {
          sanitized[key] = null;
          continue;
        }
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          sanitized[key] = asNumber;
        }
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }

  private formatSupabaseError(error: unknown): string {
    if (!error || typeof error !== 'object') return 'Erro desconhecido';
    const e = error as Record<string, unknown>;
    const message = String(e['message'] ?? 'Erro desconhecido');
    const details = e['details'] ? ` Detalhes: ${e['details']}` : '';
    const hint = e['hint'] ? ` Dica: ${e['hint']}` : '';
    const code = e['code'] ? ` (código: ${e['code']})` : '';
    return `${message}${code}${details}${hint}`;
  }

  async updateRequest(id: string, data: Partial<PurchaseRequest>, user: UserProfile): Promise<void> {
    const req = await this.getOrFetch(id);
    if (!req) {
      throw new Error('Solicitação não encontrada');
    }

    const changes: string[] = [];
    const auditableFields: (keyof PurchaseRequest)[] = [
      'requester',
      'description',
      'quantity',
      'unit',
      'materialType',
      'workOrder',
      'priority',
      'justification',
      'supplier',
      'unitValue',
      'totalValue',
      'approvedValue',
      'scNumber',
      'responsibleBuyer',
      'orderNumber',
      'deliveryDate',
      'materialReceivedDate',
      'internalNotes',
    ];

    for (const key of auditableFields) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const oldValue = req[key];
        const newValue = data[key];

        const changed =
          key === 'requester'
            ? (oldValue as UserProfile | undefined)?.id !== (newValue as UserProfile | undefined)?.id
            : oldValue instanceof Date && newValue instanceof Date
              ? oldValue.getTime() !== newValue.getTime()
              : String(oldValue ?? '') !== String(newValue ?? '');

        if (changed) {
          const fieldName = this.translateFieldName(key);
          changes.push(`Campo '${fieldName}' alterado.`);
        }
      }
    }

    const updatedHistory = [...req.history];
    if (changes.length > 0) {
      updatedHistory.push({
        date: new Date(),
        user: { id: user.id, name: user.name, role: user.role },
        action: 'Solicitação Modificada Manualmente',
        details: changes.join('\n'),
      });
    }

    const updatePayload = this.sanitizeUpdatePayload({
      ...this.toSnakeCase(data),
      ...(changes.length > 0 ? { history: updatedHistory } : {}),
    });

    await this.patchAplicando(id, updatePayload);

    if (changes.length > 0) {
      this.auditLogService.log({
        user_id: user.id,
        user_name: user.name,
        event_type: 'request_updated',
        resource_type: 'request',
        resource_id: id,
        description: `${user.name} editou manualmente a solicitação ${req.materialCode}: ${changes.join('; ')}`,
        metadata: { material_code: req.materialCode, fields_changed: changes },
      });
    }
  }

  // PATCH pedindo a linha de volta. O RLS barra UPDATE sem erro (0 linhas) — sem linha
  // devolvida, a gravação não aconteceu.
  private async patchAplicando(id: string, payload: Record<string, unknown>): Promise<PurchaseRequest> {
    let rows: PurchaseRequestRow[] | null = null;
    await withRetry(
      async () => {
        const { data, error } = await this.supabaseRestService.patchReturning<PurchaseRequestRow>(
          `purchase_requests?id=eq.${encodeURIComponent(id)}&${REQUEST_SELECT}`,
          payload,
          this.OPERATION_TIMEOUT_MS
        );
        if (error) throw new Error(this.formatSupabaseError(error));
        rows = data;
      },
      { maxAttempts: this.MAX_RETRIES, retryIf: e => this.isNetworkError(e) }
    );
    const gravada = this.aplicarGravada(rows);
    if (!gravada) {
      throw new Error('Alteração não gravada: sem permissão para editar esta solicitação no status atual.');
    }
    return gravada;
  }

  validateStatusTransition(request: PurchaseRequest, newStatus: RequestStatus, isAdmin = false): StatusValidation {
    if (!isAdmin) {
      return { valid: false, error: 'Apenas administradores podem alterar o status.' };
    }

    if (request.status === newStatus) {
      return { valid: false, error: 'A solicitação já está neste status.' };
    }

    const transitions: Partial<Record<RequestStatus, RequestStatus[]>> = {
      Pendente: ['Aprovado no Portal', 'Reprovado'],
      'Aprovado no Portal': ['Aprovado no MRP'],
      'Aprovado no MRP': ['SC Criada'],
      'SC Criada': ['Em Cota\u00e7\u00e3o'],
      'Em Cota\u00e7\u00e3o': ['Aprovado em RD', 'Reprovado em RD'],
      'Aprovado em RD': ['Pedido Criado'],
      'Pedido Criado': ['Material Recebido'],
      'Material Recebido': ['Finalizado'],
    };

    const allowedNext = transitions[request.status] || [];
    if (!allowedNext.includes(newStatus)) {
      return { valid: false, error: `Transição inválida de "${request.status}" para "${newStatus}".` };
    }

    if (newStatus === 'SC Criada' && !request.scNumber) {
      return { valid: false, error: 'Preencha o número da SC antes de avançar para SC Criada.' };
    }

    if (newStatus === 'Em Cota\u00e7\u00e3o' && !request.responsibleBuyer) {
      return { valid: false, error: 'Preencha o comprador responsável antes de avançar para Em Cotação.' };
    }

    if (newStatus === 'Aprovado em RD' && (!request.supplier || !request.unitValue || !request.approvedValue)) {
      return { valid: false, error: 'Preencha fornecedor, valor unitário e valor aprovado antes de aprovar em RD.' };
    }

    if (newStatus === 'Pedido Criado' && (!request.orderNumber || !request.deliveryDate)) {
      return { valid: false, error: 'Preencha número do pedido e data de entrega antes de criar o pedido.' };
    }

    if (newStatus === 'Material Recebido' && !request.materialReceivedDate) {
      return { valid: false, error: 'Preencha a data de recebimento do material antes de avançar.' };
    }

    return { valid: true };
  }

  async updateRequestStatus(
    id: string,
    newStatus: RequestStatus,
    user: UserProfile,
    details?: string
  ): Promise<void> {
    const request = await this.getOrFetch(id);
    if (!request) {
      throw new Error('Solicitação não encontrada');
    }

    const validation = this.validateStatusTransition(request, newStatus, user.role === 'Admin');
    if (!validation.valid) {
      throw new Error(validation.error || 'Transição de status inválida.');
    }

    const updatedHistory = [...request.history];
    const historyEntry: HistoryEvent = {
      date: new Date(),
      user: { id: user.id, name: user.name, role: user.role },
      action: 'Status Atualizado',
      details: details
        ? `Status alterado de "${request.status}" para "${newStatus}". Motivo: ${details}`
        : `Status alterado de "${request.status}" para "${newStatus}".`,
    };
    updatedHistory.push(historyEntry);

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      status: newStatus,
      history: updatedHistory,
    };

    if (newStatus === 'Aprovado no Portal') {
      payload['portalapprovedby'] = user.id;
      payload['portalapprovedat'] = nowIso;
    }
    if (newStatus === 'Aprovado no MRP') {
      payload['mrpapprovedby'] = user.id;
      payload['mrpapprovedat'] = nowIso;
    }
    if (newStatus === 'Aprovado em RD') {
      payload['rdapprovedby'] = user.id;
      payload['rdapprovedat'] = nowIso;
    }
    if (newStatus === 'Finalizado' || newStatus === 'Reprovado' || newStatus === 'Reprovado em RD') {
      payload['finishedat'] = nowIso;
    }

    const sanitizedPayload = this.sanitizeUpdatePayload(payload);

    const refreshedRequest = await this.patchAplicando(id, sanitizedPayload);
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'request_status_changed',
      resource_type: 'request',
      resource_id: id,
      description: `${user.name} alterou status de "${request.status}" para "${newStatus}"${details ? ` — ${details}` : ''}`,
      metadata: {
        material_code: request.materialCode,
        old_status: request.status,
        new_status: newStatus,
        ...(details ? { reason: details } : {}),
      },
    });

    if (refreshedRequest) {
      const title = 'Status da Solicitação Atualizado';
      const message = details
        ? `Sua solicitação ${refreshedRequest.materialCode} foi atualizada para "${newStatus}". Motivo: ${details}`
        : `Sua solicitação ${refreshedRequest.materialCode} foi atualizada para "${newStatus}".`;

      // Notificação in-app: só envia se não for o próprio solicitante alterando
      if (refreshedRequest.requester.id !== user.id) {
        await this.createNotificationForRequester(refreshedRequest, title, message);
      }

      // E-mail: disparado via botão no componente (mailto: abre o Outlook)
    }
  }

  async deleteRequest(id: string, user: UserProfile): Promise<void> {
    if (user.role !== 'Admin') {
      throw new Error('Apenas administradores podem excluir solicitações');
    }

    const request = await this.getOrFetch(id);
    if (!request) {
      throw new Error('Solicitação não encontrada');
    }

    const { success, error } = await this.supabaseRestDelete(
      `purchase_requests?id=eq.${encodeURIComponent(id)}`
    );

    if (error) {
      throw error;
    }

    if (!success) {
      throw new Error('Não foi possível excluir a solicitação. Verifique as permissões.');
    }

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'request_deleted',
      resource_type: 'request',
      resource_id: id,
      description: `${user.name} excluiu a solicitação ${request.materialCode} — ${request.description}`,
      metadata: { material_code: request.materialCode, status: request.status },
    });

    this._requests.update(list => removerDaLista(list, id));
  }

  private async createNotificationForRequester(request: PurchaseRequest, title: string, message: string): Promise<void> {
    try {
      await this.supabaseRestRequest('POST', 'notifications', [
        {
          user_id: request.requester.id,
          request_id: request.id,
          type: 'status_update',
          title,
          message,
          is_read: false,
          metadata: {
            material_code: request.materialCode,
            requester_name: request.requester.name,
          },
        },
      ]);
    } catch (error) {
      console.error('[RequestService] Exception creating notification:', error);
    }
  }
}


