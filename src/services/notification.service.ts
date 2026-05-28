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

  show(message: string, type: ToastType = 'success', duration: number = 4000): void {
    this.notification.set({ message, type });
    setTimeout(() => this.notification.set(null), duration);
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

