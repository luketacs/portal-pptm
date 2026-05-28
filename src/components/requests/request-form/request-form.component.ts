import { ChangeDetectionStrategy, Component, signal, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormArray, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { RequestService } from '../../../services/request.service';
import { AuthService } from '../../../services/auth.service';
import { UserService } from '../../../services/user.service';
import { MaterialType, Priority, PurchaseRequest, RequestStatus } from '../../../models/request.model';
import { NotificationService } from '../../../services/notification.service';
import { MaterialService } from '../../../services/material.service';

@Component({
  selector: 'app-request-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './request-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestFormComponent implements OnInit, OnDestroy {
  currentUser;
  
  // Form options
  priorities: Priority[] = ['Baixa', 'Média', 'Alta', 'Emergencial'];
  
  requestForm: FormGroup;

  // Signals for success modal e loading
  showSuccessModal = signal(false);
  successMessage = signal('');
  isSubmitting = signal(false);
  
  // State management for each item in the form array
  private itemSubscriptions: (Subscription | undefined)[] = [];
  itemStates = signal<{ 
    isLoading: boolean; 
    apiError: string | null;
    stockAlert: { hasStock: boolean; quantity: number; location: string } | null;
    pendingRequestAlert: { exists: boolean; createdBy: string; createdAt: string } | null;
  }[]>([]);

  users;
  constructor(
    private fb: FormBuilder,
    private router: Router,
    private requestService: RequestService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private materialService: MaterialService,
    private userService: UserService
  ) {
    this.currentUser = this.authService.currentUser;
    this.users = this.userService.users;

    this.requestForm = this.fb.group({
      requester: [null], // Only used by Admin
      workOrder: ['', Validators.required],
      priority: ['Média' as Priority, Validators.required],
      justification: ['', Validators.required],
      items: this.fb.array([], [Validators.required, Validators.minLength(1)])
    });

    this.addItem(); // Start with one item by default
  }

  ngOnInit(): void {
    // Correção: resetar flags do serviço quando o componente é criado.
    // Garante que, se houve travamento anterior, o estado seja limpo.
    console.log('[RequestForm] initialized - resetting service state');
    this.requestService.resetLoadingState();
  }

  ngOnDestroy(): void {
    // Cleanup: unsubscribe de todas as subscriptions de material code listeners
    this.itemSubscriptions.forEach(sub => {
      if (sub) {
        sub.unsubscribe();
      }
    });
    this.itemSubscriptions = []; // Clear array para evitar memory leaks
  }

  // --- FormArray Management ---
  items(): FormArray {
    return this.requestForm.get('items') as FormArray;
  }
  
  createItem(): FormGroup {
    return this.fb.group({
      materialCode: ['', Validators.required],
      description: [{ value: '', disabled: true }, Validators.required],
      descriptionDetailed: [{ value: '', disabled: true }],
      quantity: [1, [Validators.required, Validators.min(1)]],
      unit: [{ value: 'un', disabled: true }, Validators.required],
      materialType: ['Mecânica' as MaterialType, Validators.required],
    });
  }

  addItem(): void {
    const itemForm = this.createItem();
    this.items().push(itemForm);
    this.itemStates.update(states => [...states, { 
      isLoading: false, 
      apiError: null,
      stockAlert: null,
      pendingRequestAlert: null
    }]);
    this.setupMaterialCodeListener(this.items().length - 1);
  }

  removeItem(index: number): void {
    const user = this.currentUser?.();
    if (!user) return;
    if (this.items().length <= 1) {
       this.notificationService.showError('A solicitação deve ter pelo menos um item.');
       return;
    }
    this.items().removeAt(index);
    this.itemSubscriptions[index]?.unsubscribe();
    this.itemSubscriptions.splice(index, 1);
    this.itemStates.update(states => {
      const newStates = [...states];
      newStates.splice(index, 1);
      return newStates;
    });

    // Rebind listeners to keep indexes in sync after removal
    this.itemSubscriptions.forEach(sub => sub?.unsubscribe());
    this.itemSubscriptions = [];
    this.items().controls.forEach((_, i) => this.setupMaterialCodeListener(i));
  }

  private mapApiTypeToModelType(apiType: string): MaterialType {
    switch (apiType) {
      case 'MC': return 'Mecânica';
      case 'EL': return 'Elétrica';
      case 'SPCI': return 'SPCI';
      case 'REF': return 'Refrigeração';
      default: return 'Outros';
    }
  }

  private setupMaterialCodeListener(index: number): void {
    const itemGroup = this.items().at(index) as FormGroup;
    const materialCodeControl = itemGroup.get('materialCode');

    if (!materialCodeControl) return;

    const subscription = materialCodeControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      tap(() => {
        this.itemStates.update(states => {
          if (states[index]) states[index] = { 
            isLoading: true, 
            apiError: null,
            stockAlert: null,
            pendingRequestAlert: null
          };
          return [...states];
        });
        itemGroup.get('description')?.reset({ value: '', disabled: true });
        itemGroup.get('descriptionDetailed')?.reset({ value: '', disabled: true });
        itemGroup.get('unit')?.reset({ value: 'un', disabled: true });
      }),
      switchMap(code =>
        this.materialService.getMaterialByCode(code).pipe(
          catchError(() => of({ success: false, data: null, error: 'Erro ao consultar material.' }))
        )
      )
    ).subscribe(response => {
      console.log('[RequestForm] response received:', response);
      console.log('[RequestForm] type:', typeof response);
      console.log('[RequestForm] response.success:', response.success);
      console.log('[RequestForm] response.data:', response.data);
      console.log('[RequestForm] index:', index);
      
      this.itemStates.update(states => {
        if (states[index]) states[index].isLoading = false;
        return [...states];
      });

      // Log the condition
      console.log('[RequestForm] response.success =', response.success, ', response.data =', !!response.data);
      
      if (response.success && response.data) {
        const materialType = this.mapApiTypeToModelType(response.data.tipo);
        
        console.log('[RequestForm] - Setting values for item', index, {
          description: response.data.texto_breve,
          descriptionDetailed: response.data.texto_completo,
          unit: response.data.unidade,
          materialType
        });
        
        // Directly set values on controls (don't use patchValue for disabled controls)
        const descControl = itemGroup.get('description');
        const descDetailedControl = itemGroup.get('descriptionDetailed');
        const unitControl = itemGroup.get('unit');
        const typeControl = itemGroup.get('materialType');
        
        console.log('[RequestForm] found:', {
          descControl: !!descControl,
          descDetailedControl: !!descDetailedControl,
          unitControl: !!unitControl,
          typeControl: !!typeControl
        });
        
        if (descControl) {
          descControl.setValue(response.data.texto_breve);
          console.log('[RequestForm] setValue done');
        }
        if (descDetailedControl) {
          descDetailedControl.setValue(response.data.texto_completo);
          console.log('[RequestForm] setValue done');
        }
        if (unitControl) {
          unitControl.setValue(response.data.unidade);
          console.log('[RequestForm] setValue done');
        }
        if (typeControl) {
          typeControl.setValue(materialType);
          console.log('[RequestForm] setValue done');
        }
        
        console.log('[RequestForm] values set successfully');

        // Check for stock alert (PTPC company, location 4922)
        const ptpcStock4922 = response.data.estoques?.find(
          e => e.empresa === 'PTPC' && e.localizacao === '4922'
        );
        
        if (ptpcStock4922 && parseInt(ptpcStock4922.qAtual) > 0) {
          console.log('[RequestForm] alert: PTPC has', ptpcStock4922.qAtual, 'units at location 4922');
          this.itemStates.update(states => {
            if (states[index]) {
              states[index].stockAlert = {
                hasStock: true,
                quantity: parseInt(ptpcStock4922.qAtual),
                location: '4922'
              };
            }
            return [...states];
          });
        } else {
          this.itemStates.update(states => {
            if (states[index]) states[index].stockAlert = null;
            return [...states];
          });
        }

        // Check for pending purchase request
        const materialCode = itemGroup.get('materialCode')?.value;
        console.log('[RequestForm] Code for pending check:', materialCode);
        console.log('[RequestForm] requests in service:', this.requestService.requests().length);
        console.log('[RequestForm] requests:', this.requestService.requests().map(r => ({ code: r.materialCode, status: r.status })));
        
        if (materialCode) {
          // Use the service method which filters by material code and open statuses
          const existingRequests = this.requestService.getOpenRequestsByMaterialCode(materialCode);
          
          console.log('[RequestForm] for pending requests for material:', materialCode);
          console.log('[RequestForm] Found', existingRequests.length, 'existing open requests');
          console.log('[RequestForm] requests details:', existingRequests.map(r => ({ 
            code: r.materialCode, 
            status: r.status,
            requester: r.requester?.name,
            date: r.requestDate
          })));
          
          if (existingRequests.length > 0) {
            const firstRequest = existingRequests[0];
            const createdByName = firstRequest.requester?.name || 'Desconhecido';
            const createdAtStr = firstRequest.requestDate 
              ? new Date(firstRequest.requestDate).toLocaleDateString('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit' })
              : 'Data desconhecida';
            
            console.log('[RequestForm] REQUEST ALERT TRIGGERED: Material already requested by', createdByName, 'on', createdAtStr);
            this.itemStates.update(states => {
              if (states[index]) {
                states[index].pendingRequestAlert = {
                  exists: true,
                  createdBy: createdByName,
                  createdAt: createdAtStr
                };
                console.log('[RequestForm] state updated for index', index, ':', states[index].pendingRequestAlert);
              }
              return [...states];
            });
          } else {
            console.log('[RequestForm] pending requests found for material:', materialCode);
            this.itemStates.update(states => {
              if (states[index]) {
                states[index].pendingRequestAlert = null;
              }
              return [...states];
            });
          }
        } else {
          console.log('[RequestForm] code is empty, skipping pending request check');
        }
      } else if (materialCodeControl.value) {
        console.error('[RequestForm] - Material not found. Response:', response);
        this.itemStates.update(states => {
          if(states[index]) {
            states[index].apiError = response?.error || 'Material não encontrado para o código informado.';
            states[index].stockAlert = null;
            states[index].pendingRequestAlert = null;
          }
          return [...states];
        });
      }
    });

    this.itemSubscriptions[index] = subscription;
  }

  // --- Form Submission ---
  async onSubmit(): Promise<void> {
    // Correção: prevenir double submit.
    if (this.isSubmitting()) {
      console.warn('[RequestForm] já em andamento, ignorando...');
      return;
    }
    
    if (this.requestForm.invalid) {
      this.requestForm.markAllAsTouched();
      this.notificationService.showError('Formulário inválido. Por favor, verifique todos os campos obrigatórios.');
      return;
    }

    const user = this.currentUser();
    if (!user) {
      this.notificationService.showError('Erro: Usuário não autenticado.');
      return;
    }

    this.isSubmitting.set(true);
    try {
      const formValue = this.requestForm.getRawValue();

      // Se admin, usa o solicitante selecionado; senão, usa o próprio usuário.
      let requester = user;
      if (user.role === 'Admin' && formValue.requester) {
        requester = formValue.requester;
      }

      // Cria array de promessas com skipReload=true para evitar múltiplos reloads.
      const creationPromises = formValue.items.map((item: any) => {
        const newRequest: Omit<PurchaseRequest, 'id' | 'requestDate' | 'status' | 'history'> = {
          requester: requester,
          materialCode: item.materialCode,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          materialType: item.materialType,
          workOrder: formValue.workOrder,
          priority: formValue.priority,
          justification: formValue.justification,
        };
        // skipReload=true para evitar reload múltiplo.
        return this.requestService.addRequest(newRequest, requester, true);
      });

      console.log('[RequestForm] request creation...', { itemCount: creationPromises.length });

      // Sem timeout: deixar as operações completarem naturalmente.
      // O retry interno do serviço já lida com timeouts e erros de rede.
      const results = await Promise.allSettled(creationPromises);

      console.log('[RequestForm] creation completed:', { 
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length 
      });

      // Conta sucessos e falhas
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0 && succeeded === 0) {
        // Todas falharam
        const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
        console.error('[RequestForm] requests failed:', firstError.reason);
        throw new Error(firstError.reason?.message || 'Erro ao criar solicitações');
      }

      // Recarrega apenas uma vez após todas as operações.
      console.log('[RequestForm] requests...');
      await this.requestService.loadRequests(true);
      console.log('[RequestForm] reloaded successfully');

      // Mensagem baseada nos resultados
      let message = '';
      if (succeeded === formValue.items.length) {
        message = formValue.items.length > 1
          ? `${formValue.items.length} solicitações foram criadas com sucesso.`
          : 'Solicitação criada com sucesso.';
      } else {
        message = `${succeeded} de ${formValue.items.length} solicitações foram criadas. ${failed} falharam.`;
      }

      this.successMessage.set(message);
      this.showSuccessModal.set(true);

      if (failed > 0) {
        this.notificationService.showError(`Atenção: ${failed} solicitação(ões) falharam ao serem criadas.`);
      }

    } catch (error) {
      console.error('Falha ao enviar solicitação:', error);
      const errorMessage = (error as any).message || 'Erro desconhecido';
      
      // Tratamento específico para erros de sessão/autenticação.
      if (errorMessage.includes('JWT') || errorMessage.includes('session') || errorMessage.includes('auth')) {
        this.notificationService.showError('Sessão expirada. Recarregue a página e faça login novamente.');
      } else if (errorMessage.includes('Timeout')) {
        this.notificationService.showError('A solicitação está demorando muito. Verifique sua conexão e tente novamente.');
      } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
        this.notificationService.showError('Erro de conexão. Verifique sua internet e tente novamente.');
      } else {
        this.notificationService.showError(`Erro ao criar solicitação: ${errorMessage}`);
      }
    } finally {
      // Sempre resetar loading, independente do resultado.
      this.isSubmitting.set(false);
    }
  }

  // --- Modal Actions ---
  navigateToRequests(): void {
    this.showSuccessModal.set(false);
    this.resetForm();
    // Navegação mais limpa com replaceUrl para evitar volta ao formulário.
    this.router.navigate(['/requests'], { replaceUrl: true });
  }

  createNewRequest(): void {
    this.showSuccessModal.set(false);
    this.resetForm();
  }

  private resetForm(): void {
    this.requestForm.reset({
      workOrder: '',
      priority: 'Média',
      justification: '',
    });
    this.items().clear();
    this.itemSubscriptions.forEach(sub => sub?.unsubscribe());
    this.itemSubscriptions = [];
    this.itemStates.set([]);
    this.addItem();
  }
}






