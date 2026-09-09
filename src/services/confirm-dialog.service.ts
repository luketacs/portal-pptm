import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface ConfirmDialogOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  // Deixa o botão de confirmar vermelho — pra ações destrutivas (excluir etc.),
  // mesmo espírito do "Esta ação não pode ser desfeita" usado em vários confirm()
  // nativos que este serviço substitui.
  danger?: boolean;
}

// Substitui o `confirm()` nativo do navegador (popup sem nenhum estilo do app, visual
// do sistema operacional) por um modal próprio — mesmo padrão do NotificationService:
// serviço com estado em signal + um componente único (<app-confirm-dialog/>) montado
// no app-shell (ver app.component.html), consumido de qualquer lugar via injeção.
@Injectable({
  providedIn: 'root',
})
export class ConfirmDialogService {
  request = signal<ConfirmDialogRequest | null>(null);
  private resolver: ((value: boolean) => void) | null = null;

  confirm(message: string, options?: ConfirmDialogOptions): Promise<boolean> {
    this.request.set({
      message,
      confirmLabel: options?.confirmLabel ?? 'Confirmar',
      cancelLabel: options?.cancelLabel ?? 'Cancelar',
      danger: options?.danger ?? false,
    });
    return new Promise<boolean>(resolve => {
      this.resolver = resolve;
    });
  }

  respond(valor: boolean): void {
    this.request.set(null);
    if (this.resolver) {
      this.resolver(valor);
      this.resolver = null;
    }
  }
}
