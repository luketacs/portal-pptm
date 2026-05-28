import { ChangeDetectionStrategy, Component, computed, signal, effect, OnDestroy, EffectRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { EmailService } from '../../../services/email.service';
import { PurchaseRequest, RequestStatus, Priority } from '../../../models/request.model';
import { UserProfile } from '../../../models/user.model';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../../../services/notification.service';
import { RequestHistoryComponent } from '../request-history/request-history.component';
import { UserService } from '../../../services/user.service';

type EditableRequest = Partial<Omit<PurchaseRequest, 'deliveryDate' | 'materialReceivedDate'>> & { 
  deliveryDate?: string; 
  materialReceivedDate?: string;
  requesterId?: string;
};

@Component({
  selector: 'app-request-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, RequestHistoryComponent],
  templateUrl: './request-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestDetailComponent implements OnDestroy {
  private paramsSubscription?: Subscription;
  private effectRef?: EffectRef;
  
  currentUser;
  users;
  request = signal<PurchaseRequest | undefined>(undefined);
  hasAccess = signal(true); // Signal to control view access
  
  // Editable request state for forms
  editableRequest = signal<EditableRequest>({});

  // Form options
  priorities: Priority[] = ['Baixa', 'Média', 'Alta', 'Emergencial'];
  units = ['un', 'kg', 'm', 'caixa', 'L', 'p'];

  // Signals for actions
  rejectionReason = signal('');
  rejectionReasonRD = signal('');

  // Loading states for async actions
  isSaving = signal(false);
  isApproving = signal(false);
  isRejecting = signal(false);
  isApprovingRD = signal(false);
  isRejectingRD = signal(false);
  isUpdatingStatus = signal(false);

  // This workflow helps determine field visibility
  private readonly STATUS_WORKFLOW: RequestStatus[] = [
    'Pendente', 'Aprovado no Portal', 'Aprovado no MRP', 'SC Criada', 
    'Em Cotação', 'Aprovado em RD', 'Pedido Criado', 'Material Recebido', 'Finalizado'
  ];

  // Timeline steps para visualização
  timelineSteps = computed(() => {
    const req = this.request();
    if (!req) return [];

    const currentStatusIndex = this.getStatusIndex(req.status);
    const isRejected = req.status === 'Reprovado' || req.status === 'Reprovado em RD';

    // Se foi reprovado, mostrar apenas até o ponto de rejeição.
    if (isRejected) {
      const rejectionIndex = req.status === 'Reprovado' ? 
        this.getStatusIndex('Aprovado no Portal') : 
        this.getStatusIndex('Aprovado em RD');
      
      return [
        { status: 'Pendente', label: 'Solicitação Criada', completed: true, current: false, icon: 'check' },
        { status: 'Aprovado no Portal', label: 'Aprovação Portal', completed: false, current: false, rejected: req.status === 'Reprovado', icon: 'x' },
        ...(req.status === 'Reprovado em RD' ? [
          { status: 'Aprovado no Portal', label: 'Aprovado no Portal', completed: true, current: false, icon: 'check' },
          { status: 'Aprovado em RD', label: 'Aprovação RD', completed: false, current: false, rejected: true, icon: 'x' }
        ] : [])
      ];
    }

    return [
      { 
        status: 'Pendente', 
        label: 'Solicitação Criada', 
        completed: currentStatusIndex >= 0, 
        current: currentStatusIndex === 0,
        icon: 'document'
      },
      { 
        status: 'Aprovado no Portal', 
        label: 'Aprovado no Portal', 
        completed: currentStatusIndex >= 1, 
        current: currentStatusIndex === 1,
        icon: 'check'
      },
      { 
        status: 'Aprovado no MRP', 
        label: 'Aprovado no MRP', 
        completed: currentStatusIndex >= 2, 
        current: currentStatusIndex === 2,
        icon: 'check'
      },
      { 
        status: 'SC Criada', 
        label: 'SC Criada', 
        completed: currentStatusIndex >= 3, 
        current: currentStatusIndex === 3,
        icon: 'document-text'
      },
      { 
        status: 'Em Cotação', 
        label: 'Em Cotação', 
        completed: currentStatusIndex >= 4, 
        current: currentStatusIndex === 4,
        icon: 'currency-dollar'
      },
      { 
        status: 'Aprovado em RD', 
        label: 'Aprovado em RD', 
        completed: currentStatusIndex >= 5, 
        current: currentStatusIndex === 5,
        icon: 'check-circle'
      },
      { 
        status: 'Pedido Criado', 
        label: 'Pedido Criado', 
        completed: currentStatusIndex >= 6, 
        current: currentStatusIndex === 6,
        icon: 'shopping-cart'
      },
      { 
        status: 'Material Recebido', 
        label: 'Material Recebido', 
        completed: currentStatusIndex >= 7, 
        current: currentStatusIndex === 7,
        icon: 'truck'
      },
      { 
        status: 'Finalizado', 
        label: 'Finalizado', 
        completed: currentStatusIndex >= 8, 
        current: currentStatusIndex === 8,
        icon: 'check-badge'
      }
    ];
  });

  // Progresso percentual da timeline
  timelineProgress = computed(() => {
    const steps = this.timelineSteps();
    if (steps.length === 0) return 0;
    const completedSteps = steps.filter(s => s.completed).length;
    return (completedSteps / steps.length) * 100;
  });

  // Controla exibição do botão de e-mail após mudança de status
  lastStatusChange = signal<{ request: PurchaseRequest; newStatus: string; changedBy: UserProfile } | null>(null);

  constructor(
    public route: ActivatedRoute,
    public router: Router,
    public requestService: RequestService,
    public authService: AuthService,
    public notificationService: NotificationService,
    private userService: UserService,
    private emailService: EmailService
  ) {
    this.currentUser = this.authService.currentUser;
    this.users = this.userService.users;
    
    // Reage a mudanças de parâmetro de rota.
    this.paramsSubscription = this.route.paramMap.subscribe(params => {
      const requestId = params.get('id');
      if (requestId) {
        this.loadRequestById(requestId);
      }
    });

    // Effect para atualizar quando a lista de requests mudar.
    this.effectRef = effect(() => {
      const currentRequestId = this.route.snapshot.paramMap.get('id');
      if (!currentRequestId) return;

      const allRequests = this.requestService.requests();
      if (allRequests.length === 0) return;

      const foundRequest = allRequests.find(r => r.id === currentRequestId);
      if (foundRequest && foundRequest !== this.request()) {
        this.updateRequestState(foundRequest);
      }
    });
  }

  ngOnDestroy() {
    this.paramsSubscription?.unsubscribe();
    this.effectRef?.destroy();
    // Reset states para evitar memory leaks.
    this.request.set(undefined);
    this.editableRequest.set({});
    this.rejectionReason.set('');
    this.rejectionReasonRD.set('');
  }

  private loadRequestById(requestId: string) {
    const user = this.currentUser();
    if (!user) {
      this.hasAccess.set(false);
      this.notificationService.showError('Usuário não autenticado.');
      return;
    }
    
    const foundRequest = this.requestService.getById(requestId);
    
    if (!foundRequest) {
      this.request.set(undefined);
      this.hasAccess.set(false);
      return;
    }
    
    // Correção crítica de segurança: validar acesso ANTES de carregar dados.
    // Previne vazamento de dados para usuários não autorizados.
    if (user.role === 'Solicitante' && foundRequest.requester.id !== user.id) {
      this.hasAccess.set(false);
      this.request.set(undefined); // Não carregar dados.
      this.notificationService.showError('Acesso negado: você só pode ver suas próprias solicitações.');
      this.router.navigate(['/requests']); // Redirecionar imediatamente.
      return;
    }
    
    // Só atualiza estado se tiver acesso.
    this.updateRequestState(foundRequest);
  }

  private updateRequestState(foundRequest: PurchaseRequest) {
    this.request.set(foundRequest);
    this.editableRequest.set({
      ...foundRequest,
      deliveryDate: foundRequest.deliveryDate?.toISOString().split('T')[0],
      materialReceivedDate: foundRequest.materialReceivedDate?.toISOString().split('T')[0],
      requesterId: foundRequest.requester.id
    });

    // J validado em loadRequestById, apenas confirmar
    this.hasAccess.set(true);
  }

  isAdmin = computed(() => this.currentUser()?.role === 'Admin');

  canEditRequest = computed(() => {
    const user = this.currentUser();
    const req = this.request();
    if (!user || !req) return false;
    // Visualizador nunca pode editar
    if (user.role === 'Visualizador') return false;
    // Nova lógica: após aprovação inicial (Aprovado no Portal), ninguém pode editar os campos da solicitação original.
    // Admin só preenche campos específicos através de canEditScNumber, canEditBuyerField, etc.
    // Solicitante só edita se pendente.
    if (user.role === 'Solicitante') {
      return req.status === 'Pendente';
    }
    // Admin pode editar totalmente a solicitação
    if (user.role === 'Admin') {
      return true;
    }
    return false;
  });

  canEditRequester = computed(() => {
    const user = this.currentUser();
    const req = this.request();
    if (!user || !req) return false;
    return user.role === 'Admin';
  });

  canSaveGeneralChanges = computed(() => this.canEditRequest() || this.canEditRequester());

  // Controla se pode avançar status (independente de canEditRequest).
  canAdvanceStatus = computed(() => {
    const user = this.currentUser();
    const req = this.request();
    if (!user || !req || user.role !== 'Admin') return false;
    // Admin pode avançar status se não estiver finalizado ou rejeitado.
    return req.status !== 'Finalizado' && req.status !== 'Reprovado' && req.status !== 'Reprovado em RD';
  });

  private getStatusIndex(status: RequestStatus | undefined): number {
    if (!status) return -1;
    return this.STATUS_WORKFLOW.indexOf(status);
  }

  // --- Field Visibility Computeds ---
  showScNumberField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Aprovado no MRP');
  });

  // SC só pode ser editada quando status == 'Aprovado no MRP' (primeira vez).
  // Depois que avança para 'SC Criada', fica bloqueada mesmo para Admin.
  canEditScNumber = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'Aprovado no MRP';
  });

  // Mostrar campo de Comprador a partir de 'SC Criada' para permitir preencher
  // e avançar para 'Em Cotação'.
  showBuyerField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('SC Criada');
  });

  // Comprador só pode ser editado quando status == 'SC Criada'.
  canEditBuyerField = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'SC Criada';
  });

  // Campos de Fornecedor/Valor só aparecem a partir de 'Em Cotação'.
  showSupplierFields = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Em Cotação');
  });

  // Fornecedor e Valor podem ser editados em 'Em Cotação' e 'Aprovado em RD'.
  canEditSupplierFields = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'Em Cotação' || req.status === 'Aprovado em RD';
  });

  showApprovedValueField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Em Cotação');
  });

  // Número do Pedido aparece a partir de 'Aprovado em RD' (para poder preencher).
  showOrderNumberField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Aprovado em RD');
  });

  // Número do Pedido só pode ser editado em 'Aprovado em RD'.
  canEditOrderNumber = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'Aprovado em RD';
  });

  // Data de Entrega aparece a partir de 'Aprovado em RD' (necessária para criar pedido).
  showDeliveryDateField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Aprovado em RD');
  });

  // Data de Entrega só pode ser editada em 'Aprovado em RD'.
  canEditDeliveryDate = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'Aprovado em RD';
  });

  // Data de Recebimento aparece a partir de 'Pedido Criado'.
  showMaterialReceivedField = computed(() => {
    const reqStatus = this.request()?.status;
    return this.getStatusIndex(reqStatus) >= this.getStatusIndex('Pedido Criado');
  });

  // Data de Recebimento só pode ser editada em 'Pedido Criado' e 'Material Recebido'.
  canEditMaterialReceivedDate = computed(() => {
    const req = this.request();
    if (!req) return false;
    if (this.isAdmin()) return true;
    return req.status === 'Pedido Criado' || req.status === 'Material Recebido';
  });


  async saveChanges(): Promise<void> {
    const user = this.currentUser();
    const originalReq = this.request();
    if (!originalReq || !user) return;
    this.isSaving.set(true);
    
    const editableData = this.editableRequest();
    console.log('[RequestDetail] Saving changes. Editable data:', editableData);
    
    // Deconstruct editableData to handle the dates (string) separately from other properties
    const { deliveryDate: deliveryDateStr, materialReceivedDate: materialReceivedDateStr, requesterId, ...restOfData } = editableData;
    const updatedData: Partial<PurchaseRequest> = restOfData;

    const requesterChanged = !!requesterId && requesterId !== originalReq.requester.id;

    if (user.role === 'Admin' && requesterId && this.canEditRequester()) {
      const selectedRequester = this.users().find((u: UserProfile) => u.id === requesterId);
      if (selectedRequester) {
        updatedData.requester = selectedRequester;
      }
    }

    if (!this.canEditRequest() && !(this.canEditRequester() && requesterChanged)) {
      this.notificationService.showError('Você não tem permissão para salvar alterações neste status.');
      this.isSaving.set(false);
      return;
    }


     // Recalculate total value if unit value is changed by admin
    if (user.role === 'Admin' && editableData.unitValue !== undefined) {
      updatedData.totalValue = (editableData.unitValue ?? 0) * (editableData.quantity ?? originalReq.quantity);
    }
    
    // Convert date string from input back to Date object
    if (deliveryDateStr) {
      const [year, month, day] = deliveryDateStr.split('-').map(Number);
      updatedData.deliveryDate = new Date(year, month - 1, day);
    }

    // Convert material received date string to Date object
    if (materialReceivedDateStr) {
      const [year, month, day] = materialReceivedDateStr.split('-').map(Number);
      updatedData.materialReceivedDate = new Date(year, month - 1, day);
    }
    
    console.log('[RequestDetail] Update data to send:', updatedData);

    try {
      // Adiciona timeout de 30 segundos
      const updatePromise = this.requestService.updateRequest(originalReq.id, updatedData, user);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 30000)
      );
      
      await Promise.race([updatePromise, timeoutPromise]);
      this.notificationService.showSuccess('Alterações salvas com sucesso.');
      this.refreshRequest();
      
      console.log('[RequestDetail] Changes saved and refreshed');
    } catch (error: any) {
      console.error('[RequestDetail] Error saving changes:', error);
      this.notificationService.showError('Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
    } finally {
      this.isSaving.set(false);
    }
  }

  async approve(): Promise<void> {
    const req = this.request();
    const user = this.currentUser();
    if (!req || !user || !this.isAdmin()) return;
    
    // Correção: prevenir double click.
    if (this.isApproving()) {
      console.warn('[RequestDetail] Aprovação já em andamento');
      return;
    }
    
    this.isApproving.set(true);
    try {
      const approvePromise = this.requestService.updateRequestStatus(req.id, 'Aprovado no Portal', user);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );
      
      await Promise.race([approvePromise, timeoutPromise]);
      this.notificationService.showSuccess('Solicitação aprovada.');
      this.refreshRequest();
    } catch (error: any) {
      this.notificationService.showError('Erro ao aprovar: ' + (error.message || 'Erro desconhecido'));
    } finally {
      // Correção: garantir que finally sempre executa.
      setTimeout(() => this.isApproving.set(false), 100);
    }
  }
  
  async reject(): Promise<void> {
    const req = this.request();
    const user = this.currentUser();
    if (!req || !user || !this.isAdmin() || !this.rejectionReason()) return;
    
    if (this.isRejecting()) return; // Prevenir double click
    
    this.isRejecting.set(true);
    try {
      const rejectPromise = this.requestService.updateRequestStatus(req.id, 'Reprovado', user, this.rejectionReason());
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );
      
      await Promise.race([rejectPromise, timeoutPromise]);
      this.notificationService.showSuccess('Solicitação reprovada.');
      this.refreshRequest();
    } catch (error: any) {
      this.notificationService.showError('Erro ao reprovar: ' + (error.message || 'Erro desconhecido'));
    } finally {
      setTimeout(() => this.isRejecting.set(false), 100);
    }
  }

  async approveRD(): Promise<void> {
    const req = this.request();
    const user = this.currentUser();
    if (!req || !user || !this.isAdmin()) return;
    
    // Validar se o valor aprovado foi preenchido.
    const editableData = this.editableRequest();
    if (!editableData.approvedValue || editableData.approvedValue <= 0) {
      this.notificationService.showError('O campo "Valor Aprovado do Material" é obrigatório para aprovar em RD.');
      return;
    }

    this.isApprovingRD.set(true);
    try {
      const updatePromise = Promise.all([
        this.requestService.updateRequest(req.id, { approvedValue: editableData.approvedValue }, user),
        this.requestService.updateRequestStatus(req.id, 'Aprovado em RD', user)
      ]);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );
      
      await Promise.race([updatePromise, timeoutPromise]);
      this.notificationService.showSuccess('Solicitação aprovada em RD.');
      this.refreshRequest();
    } catch (error: any) {
      this.notificationService.showError('Erro ao aprovar em RD: ' + (error.message || 'Erro desconhecido'));
    } finally {
      this.isApprovingRD.set(false);
    }
  }

  async rejectRD(): Promise<void> {
    const req = this.request();
    const user = this.currentUser();
    if (!req || !user || !this.isAdmin() || !this.rejectionReasonRD()) return;
    this.isRejectingRD.set(true);
    try {
      const rejectPromise = this.requestService.updateRequestStatus(req.id, 'Reprovado em RD', user, this.rejectionReasonRD());
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );
      
      await Promise.race([rejectPromise, timeoutPromise]);
      this.notificationService.showSuccess('Solicitação reprovada em RD.');
      this.refreshRequest();
    } catch (error: any) {
      this.notificationService.showError('Erro ao reprovar em RD: ' + (error.message || 'Erro desconhecido'));
    } finally {
      this.isRejectingRD.set(false);
    }
  }

  async updateBuyerStatus(newStatus: RequestStatus): Promise<void> {
    const req = this.request();
    const user = this.currentUser();
    if (!req || !user || !this.isAdmin()) return;
    
    // Proteção contra double-click.
    if (this.isUpdatingStatus() || this.isSaving()) {
      console.warn('[RequestDetail] Operação já em andamento, ignorando click...');
      return;
    }
    
    this.isUpdatingStatus.set(true);
    try {
      // Correção: mesclar editableRequest com request antes de validar.
      // Assim a validação vê os campos preenchidos pelo usuário.
      const editable = this.editableRequest();
      const requestWithEdits = { 
        ...req, 
        scNumber: editable.scNumber || req.scNumber,
        responsibleBuyer: editable.responsibleBuyer || req.responsibleBuyer,
        supplier: editable.supplier || req.supplier,
        unitValue: editable.unitValue !== undefined ? editable.unitValue : req.unitValue,
        approvedValue: editable.approvedValue !== undefined ? editable.approvedValue : req.approvedValue,
        orderNumber: editable.orderNumber || req.orderNumber,
        deliveryDate: editable.deliveryDate ? new Date(editable.deliveryDate) : req.deliveryDate,
        materialReceivedDate: editable.materialReceivedDate ? new Date(editable.materialReceivedDate) : req.materialReceivedDate,
      };

      console.log('[RequestDetail] Validating status transition:', { 
        from: req.status, 
        to: newStatus,
        scNumber: requestWithEdits.scNumber,
        responsibleBuyer: requestWithEdits.responsibleBuyer 
      });

      const validation = this.requestService.validateStatusTransition(requestWithEdits, newStatus, true);
      if (!validation.valid) {
        console.warn('[RequestDetail] Validation failed:', validation.error);
        this.notificationService.showError(validation.error || 'Não é possível avançar para este status.');
        return;
      }

      // Primeiro: salvar campos editados (scNumber, responsibleBuyer, etc.) ANTES de atualizar status.
      const hasChanges = editable.scNumber || editable.responsibleBuyer || editable.supplier || 
                         editable.unitValue !== undefined || editable.approvedValue !== undefined || 
                         editable.orderNumber || editable.deliveryDate || editable.materialReceivedDate;
      
      if (hasChanges) {
        console.log('[RequestDetail] Saving edited fields before status update...');
        // Converter datas em string para Date.
        const updates: Partial<PurchaseRequest> = {
          scNumber: editable.scNumber,
          responsibleBuyer: editable.responsibleBuyer,
          supplier: editable.supplier,
          unitValue: editable.unitValue,
          approvedValue: editable.approvedValue,
          orderNumber: editable.orderNumber,
          deliveryDate: editable.deliveryDate ? new Date(editable.deliveryDate) : undefined,
          materialReceivedDate: editable.materialReceivedDate ? new Date(editable.materialReceivedDate) : undefined,
        };
        await this.requestService.updateRequest(req.id, updates, user);
      }

      // Segundo: atualizar status (sem timeout duplicado, o serviço já tem timeout interno).
      console.log('[RequestDetail] Updating status to:', newStatus);
      await this.requestService.updateRequestStatus(req.id, newStatus, user);

      this.notificationService.showSuccess(`Status atualizado para "${newStatus}".`);
      console.log('[RequestDetail] Status updated successfully');

      // Guarda referência para o botão de notificação por e-mail
      this.lastStatusChange.set({ request: req, newStatus, changedBy: user });

      // Aguardar reload em background completar.
      await new Promise(resolve => setTimeout(resolve, 1500));
      this.refreshRequest();
    } catch (error: any) {
      console.error('[RequestDetail] Error updating status:', error);
      this.notificationService.showError('Erro ao atualizar status: ' + (error.message || 'Erro desconhecido'));
    } finally {
      this.isUpdatingStatus.set(false);
    }
  }

  notifyByEmail(): void {
    const change = this.lastStatusChange();
    if (!change) return;
    const { request, newStatus, changedBy } = change;
    if (!request.requester.email) {
      this.notificationService.showError('E-mail do solicitante não disponível.');
      return;
    }
    this.emailService.openRequestStatusEmail({
      to: request.requester.email,
      requesterName: request.requester.name,
      materialCode: request.materialCode,
      materialDescription: request.description,
      newStatus,
      requestId: request.id,
      changedByName: changedBy.name,
    });
  }

  updateEditableRequest(patch: Partial<EditableRequest>): void {
    this.editableRequest.update(current => ({ ...current, ...patch }));
  }

  private refreshRequest() {
    const req = this.request();
    if (req) {
        const refreshed = this.requestService.getById(req.id)
        this.request.set(refreshed);
        if(refreshed) {
          this.editableRequest.set({
             ...refreshed,
            deliveryDate: refreshed.deliveryDate?.toISOString().split('T')[0],
            materialReceivedDate: refreshed.materialReceivedDate?.toISOString().split('T')[0],
            requesterId: refreshed.requester.id
          });
        }
    }
  }
  
  goBack() {
    window.history.back();
  }
}




