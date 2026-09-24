import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  message: string;
  type: ToastType;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  notification = signal<Toast | null>(null);
  // Um toast por vez: cada mensagem nova cancela o timer da anterior. Sem isso, o timer
  // de uma mensagem antiga apagava a nova antes da hora dela.
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, type: ToastType = 'success', duration: number = 4000): void {
    if (this.timer) clearTimeout(this.timer);
    this.notification.set({ message, type });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.notification.set(null);
    }, duration);
  }

  showSuccess(message: string, duration: number = 4000): void {
    this.show(message, 'success', duration);
  }

  showError(message: string, duration: number = 5000): void {
    this.show(message, 'error', duration);
  }

  showWarning(message: string, duration: number = 4000): void {
    this.show(message, 'warning', duration);
  }

  showInfo(message: string, duration: number = 4000): void {
    this.show(message, 'info', duration);
  }
}

