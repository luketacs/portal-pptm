import { Component, OnInit, signal, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MaterialService } from '../../../services/material.service';
import { AuthService } from '../../../services/auth.service';
import { UnidadeMedida, Material } from '../../../models/material.model';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
const DS_MAX_BYTES    = 20 * 1024 * 1024;  // 20 MB
const PHOTO_ACCEPT    = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DS_ACCEPT       = ['application/pdf'];

@Component({
  selector: 'app-material-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './material-form.component.html',
  styleUrls: ['./material-form.component.css']
})
export class MaterialFormComponent implements OnInit {
  materialForm!: FormGroup;
  currentUser = this.authService.currentUser;
  private destroyRef = inject(DestroyRef);
  
  // Signals para controle de estado
  isSubmitting = signal(false);
  showSuccessModal = signal(false);
  successMessage = signal('');
  errorMessage = signal('');
  isEditMode = signal(false);
  isViewOnlyMode = signal(false); // Modo apenas visualização (não pode editar)
  isLoading = signal(false);
  materialId: string | null = null;
  originalMaterial: Material | null = null;

  // Opções do formulário
  unidades: UnidadeMedida[] = ['UN', 'KG', 'CX', 'MT', 'LT', 'M²', 'M³', 'PC', 'KIT'];

  // Upload de arquivo
  selectedPhoto     = signal<File | null>(null);
  photoPreviewUrl   = signal<string | null>(null);
  selectedDatasheet = signal<File | null>(null);
  datasheetName     = signal<string | null>(null);
  existingPhotoUrl  = signal<string | null>(null);
  existingDsUrl     = signal<string | null>(null);
  photoError        = signal('');
  dsError           = signal('');

  constructor(
    private fb: FormBuilder,
    private materialService: MaterialService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  async ngOnInit(): Promise<void> {
    // Verificar se é modo de edição
    this.materialId = this.route.snapshot.paramMap.get('id');
    this.isEditMode.set(!!this.materialId);
    
    // Detectar modo de apenas visualização (usuário não-admin visualizando material existente)
    const canEdit = this.isAdmin;
    this.isViewOnlyMode.set(this.isEditMode() && !canEdit);

    this.initForm();
    this.setupFormListeners();

    // Se for modo de edição, carregar dados
    if (this.isEditMode() && this.materialId) {
      await this.loadMaterial(this.materialId);
      
      // Se for modo visualização, desabilitar todo o formulário
      if (this.isViewOnlyMode()) {
        this.materialForm.disable();
      }
    }
  }

  /**
   * Carrega dados do material para edição
   */
  async loadMaterial(id: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const { data, error } = await this.materialService.getMaterialById(id);

      if (error) {
        console.error('[MaterialForm] Error loading material:', error);
        this.errorMessage.set('Erro ao carregar material');
        this.isLoading.set(false);
        return;
      }

      if (data) {
        this.originalMaterial = data;
        this.materialForm.patchValue({
          codigo: data.codigo || '',
          descricao_breve: data.descricao_breve,
          descricao_detalhada: data.descricao_detalhada,
          unidade: data.unidade,
          ncm: data.ncm,
          estoque_seguranca: data.estoque_seguranca,
          qtd_estoque_seguranca: data.qtd_estoque_seguranca,
          complementar: (data as any).complementar || ''
        });
        // Carrega URLs de arquivos existentes
        this.existingPhotoUrl.set(data.photo_url ?? null);
        this.existingDsUrl.set(data.datasheet_url ?? null);
      }
    } catch (err) {
      console.error('[MaterialForm] Unexpected error:', err);
      this.errorMessage.set('Erro ao carregar material');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Inicializa o formulário com validações
   */
  private initForm(): void {
    const isAdmin = this.currentUser()?.role === 'Admin';

    this.materialForm = this.fb.group({
      // Código: desabilitado para não-admin, vazio por padrão
      codigo: [
        { value: '', disabled: !isAdmin },
        []
      ],
      descricao_breve: [
        '',
        [Validators.required, Validators.maxLength(50)]
      ],
      descricao_detalhada: [
        '',
        [Validators.required, Validators.maxLength(254)]
      ],
      unidade: [
        'UN',
        [Validators.required]
      ],
      ncm: [
        '',
        [
          Validators.required,
          Validators.pattern(/^\d{8}$/),
          Validators.minLength(8),
          Validators.maxLength(8)
        ]
      ],
      estoque_seguranca: [
        false,
        [Validators.required]
      ],
      qtd_estoque_seguranca: [
        { value: null, disabled: true },
        []
      ],
      complementar: [
        '',
        [Validators.maxLength(500)]
      ]
    });
  }

  /**
   * Configura listeners para mudanças no formulário
   */
  private setupFormListeners(): void {
    // Listener para habilitar/desabilitar campo de quantidade de estoque
    this.materialForm.get('estoque_seguranca')?.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(value => {
      const qtdControl = this.materialForm.get('qtd_estoque_seguranca');
      
      if (value === true) {
        // Habilitar e tornar obrigatório
        qtdControl?.enable();
        qtdControl?.setValidators([
          Validators.required,
          Validators.min(1),
          Validators.pattern(/^\d+$/) // Apenas números inteiros
        ]);
      } else {
        // Desabilitar e limpar validações
        qtdControl?.disable();
        qtdControl?.clearValidators();
        qtdControl?.setValue(null);
      }
      
      qtdControl?.updateValueAndValidity();
    });
  }

  /**
   * Verifica se o usuário é admin
   */
  get isAdmin(): boolean {
    return this.currentUser()?.role === 'Admin';
  }

  /**
   * Verifica se o campo mostra erro
   */
  showError(fieldName: string): boolean {
    const field = this.materialForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  /**
   * Retorna mensagem de erro para o campo
   */
  getErrorMessage(fieldName: string): string {
    const field = this.materialForm.get(fieldName);
    
    if (!field || !field.errors) return '';

    if (field.errors['required']) {
      return 'Este campo é obrigatório';
    }
    
    if (field.errors['maxLength']) {
      const maxLength = field.errors['maxLength'].requiredLength;
      return `Máximo de ${maxLength} caracteres`;
    }
    
    if (field.errors['pattern']) {
      if (fieldName === 'ncm') {
        return 'NCM deve conter exatamente 8 dígitos numéricos';
      }
      if (fieldName === 'qtd_estoque_seguranca') {
        return 'Deve ser um número inteiro positivo';
      }
    }
    
    if (field.errors['min']) {
      return `Valor mínimo: ${field.errors['min'].min}`;
    }

    if (field.errors['minLength'] || field.errors['maxLength']) {
      if (fieldName === 'ncm') {
        return 'NCM deve conter exatamente 8 dígitos';
      }
    }

    return 'Campo inválido';
  }

  // ─── Upload handlers ───────────────────────────────────────────────────────

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.photoError.set('');
    if (!file) return;

    if (!PHOTO_ACCEPT.includes(file.type)) {
      this.photoError.set('Formato inválido. Use JPG, PNG, WEBP ou GIF.');
      input.value = '';
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.photoError.set('Foto muito grande. Máximo 5 MB.');
      input.value = '';
      return;
    }

    this.selectedPhoto.set(file);
    const reader = new FileReader();
    reader.onload = e => this.photoPreviewUrl.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  onDatasheetSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.dsError.set('');
    if (!file) return;

    if (!DS_ACCEPT.includes(file.type)) {
      this.dsError.set('Apenas arquivos PDF são aceitos.');
      input.value = '';
      return;
    }
    if (file.size > DS_MAX_BYTES) {
      this.dsError.set('Arquivo muito grande. Máximo 20 MB.');
      input.value = '';
      return;
    }

    this.selectedDatasheet.set(file);
    this.datasheetName.set(file.name);
  }

  removePhoto(): void {
    this.selectedPhoto.set(null);
    this.photoPreviewUrl.set(null);
    this.existingPhotoUrl.set(null);
    this.photoError.set('');
  }

  removeDatasheet(): void {
    this.selectedDatasheet.set(null);
    this.datasheetName.set(null);
    this.existingDsUrl.set(null);
    this.dsError.set('');
  }

  openUrl(url: string | null): void {
    if (url) window.open(url, '_blank');
  }

  get displayPhotoUrl(): string | null {
    return this.photoPreviewUrl() ?? this.existingPhotoUrl();
  }

  get displayDsName(): string | null {
    if (this.datasheetName()) return this.datasheetName();
    const url = this.existingDsUrl();
    if (!url) return null;
    const parts = url.split('/');
    return parts[parts.length - 1] ?? 'datasheet.pdf';
  }

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Verifica se o formulário pode ser submetido
   */
  canSubmit(): boolean {
    // Se não é admin e o código foi alterado, bloquear
    if (!this.isAdmin && this.materialForm.get('codigo')?.dirty) {
      return false;
    }

    return this.materialForm.valid && !this.isSubmitting();
  }

  /**
   * Submete o formulário
   */
  async onSubmit(): Promise<void> {
    console.log('[MaterialForm] onSubmit called');
    
    // Bloquear submissão se for modo apenas visualização
    if (this.isViewOnlyMode()) {
      console.log('[MaterialForm] Submit blocked - view only mode');
      return;
    }
    
    // Validações finais
    if (!this.canSubmit()) {
      console.error('[MaterialForm] Cannot submit - form invalid');
      this.errorMessage.set('Por favor, corrija os erros no formulário');
      
      // Log de cada campo com erro
      Object.keys(this.materialForm.controls).forEach(key => {
        const control = this.materialForm.get(key);
        if (control?.invalid) {
          console.error(`[MaterialForm] Campo inválido: ${key}`, control.errors);
        }
      });
      
      return;
    }

    // Prevenir múltiplos envios
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      const formValue = this.materialForm.getRawValue();

      // ── Upload de arquivos ──────────────────────────────────────────────────
      // Para materiais novos: usamos um UUID gerado aqui como prefixo do path.
      // Para edição: usamos o materialId real.
      const filePathPrefix = this.materialId
        ?? (typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}`);

      // Upload de foto
      let photoUrl = this.existingPhotoUrl();
      if (this.selectedPhoto()) {
        const uploaded = await this.materialService.uploadMaterialPhoto(
          this.selectedPhoto()!, filePathPrefix
        );
        if (!uploaded) {
          this.errorMessage.set(
            'Falha ao enviar a foto. Verifique se o bucket "material-photos" existe no Supabase Storage com a política INSERT habilitada para usuários autenticados.'
          );
          this.isSubmitting.set(false);
          return;
        }
        photoUrl = uploaded;
      }

      // Upload de datasheet
      let datasheetUrl = this.existingDsUrl();
      if (this.selectedDatasheet()) {
        const uploaded = await this.materialService.uploadMaterialDatasheet(
          this.selectedDatasheet()!, filePathPrefix
        );
        if (!uploaded) {
          this.errorMessage.set(
            'Falha ao enviar o datasheet. Verifique se o bucket "material-datasheets" existe no Supabase Storage com a política INSERT habilitada para usuários autenticados.'
          );
          this.isSubmitting.set(false);
          return;
        }
        datasheetUrl = uploaded;
      }
      // ───────────────────────────────────────────────────────────────────────

      const materialData = {
        codigo: formValue.codigo?.trim().toUpperCase() || null,
        descricao_breve: formValue.descricao_breve.trim().toUpperCase(),
        descricao_detalhada: formValue.descricao_detalhada.trim().toUpperCase(),
        unidade: formValue.unidade,
        ncm: formValue.ncm.trim(),
        estoque_seguranca: formValue.estoque_seguranca,
        qtd_estoque_seguranca: formValue.estoque_seguranca ? formValue.qtd_estoque_seguranca : null,
        complementar: formValue.complementar?.trim().toUpperCase() || null,
        photo_url: photoUrl ?? null,
        datasheet_url: datasheetUrl ?? null,
      };

      // Validação adicional: Código vazio deve ser null (não string vazia)
      if (materialData.codigo === '') {
        materialData.codigo = null;
      }

      console.log('[MaterialForm] Submitting material:', materialData);

      // Enviar para o serviço
      const userId = this.currentUser()?.id;
      console.log('[MaterialForm] User ID:', userId);
      
      if (!userId) {
        console.error('[MaterialForm] No user ID found');
        this.errorMessage.set('Usuário não autenticado. Recarregue a página.');
        this.isSubmitting.set(false);
        return;
      }

      console.log('[MaterialForm] Calling service...');
      
      let data, error;

      // Verificar se é modo de edição ou criação
      if (this.isEditMode() && this.materialId) {
        // MODO DE EDIÇÃO
        console.log('[MaterialForm] Updating material...');
        const result = await this.materialService.updateMaterial(this.materialId, materialData, userId);
        data = result.data;
        error = result.error;
      } else {
        // MODO DE CRIAÇÃO
        const result = await this.materialService.createMaterial(materialData, userId);
        data = result.data;
        error = result.error;
      }

      console.log('[MaterialForm] Service response received:', { data, error });

      if (error) {
        console.error('[MaterialForm] Error:', error);
        
        // Verificar se é erro de sessão/autenticação
        if (error.message?.includes('JWT') || error.message?.includes('session') || error.code === 'PGRST301') {
          this.errorMessage.set('Sessão expirada. Por favor, recarregue a página (F5) e tente novamente.');
        } else {
          const action = this.isEditMode() ? 'atualizar' : 'cadastrar';
          this.errorMessage.set(error.message || `Erro ao ${action} material. Tente novamente.`);
        }
        this.isSubmitting.set(false);
        return;
      }

      // Sucesso!
      const action = this.isEditMode() ? 'atualizado' : 'cadastrado';
      console.log(`[MaterialForm] Material ${action} successfully:`, data);
      this.successMessage.set(`Material ${action} com sucesso!`);
      this.showSuccessModal.set(true);
      this.isSubmitting.set(false);
      
      // Se for edição, redirecionar para lista após 1.5 segundos
      if (this.isEditMode()) {
        setTimeout(() => {
          this.router.navigate(['/materials']);
        }, 1500);
      } else {
        // Se for criação, limpar formulário e estado de upload
        this.materialForm.reset({
          codigo: '',
          descricao_breve: '',
          descricao_detalhada: '',
          unidade: 'UN',
          ncm: '',
          estoque_seguranca: false,
          qtd_estoque_seguranca: null,
          complementar: ''
        });
        this.selectedPhoto.set(null);
        this.photoPreviewUrl.set(null);
        this.selectedDatasheet.set(null);
        this.datasheetName.set(null);
        this.existingPhotoUrl.set(null);
        this.existingDsUrl.set(null);
        this.photoError.set('');
        this.dsError.set('');

        // Reconfigurar estado inicial do formulário
        if (!this.isAdmin) {
          this.materialForm.get('codigo')?.disable();
        }
        this.materialForm.get('qtd_estoque_seguranca')?.disable();

        // Auto-fechar modal após 3 segundos
        setTimeout(() => {
          this.showSuccessModal.set(false);
        }, 3000);
      }

    } catch (err: any) {
      console.error('[MaterialForm] Unexpected error:', err);
      
      // Tratamento de erros específicos
      if (err.message?.includes('Timeout')) {
        this.errorMessage.set('Operação demorou muito. Verifique sua conexão e tente novamente.');
      } else if (err.message?.includes('sessão') || err.message?.includes('Session')) {
        this.errorMessage.set('Sessão expirada. Recarregue a página e faça login novamente.');
      } else {
        this.errorMessage.set('Erro inesperado ao cadastrar material. Tente novamente.');
      }
    } finally {
      // SEMPRE resetar loading, independente do resultado
      this.isSubmitting.set(false);
    }
  }

  /**
   * Cancela e volta para a lista
   */
  onCancel(): void {
    this.router.navigate(['/materials']);
  }

  /**
   * Fecha o modal de sucesso
   */
  closeSuccessModal(): void {
    this.showSuccessModal.set(false);
  }

  /**
   * Permite apenas números no campo NCM
   */
  onlyNumbers(event: KeyboardEvent): void {
    const allowedKeys = ['Backspace', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight'];
    if (allowedKeys.includes(event.key)) {
      return;
    }
    
    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  }

  /**
   * Formata NCM enquanto digita (adiciona espaço a cada 2 dígitos para facilitar leitura)
   */
  formatNCM(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, ''); // Remove não-dígitos
    
    // Limitar a 8 dígitos
    if (value.length > 8) {
      value = value.substring(0, 8);
    }
    
    this.materialForm.get('ncm')?.setValue(value, { emitEvent: false });
  }

  /**
   * Formata data para exibição
   */
  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }
}





