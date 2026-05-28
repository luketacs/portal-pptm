import { ChangeDetectionStrategy, Component, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationRealtimeService } from '../../services/notification-realtime.service';
import { Notification } from '../../models/notification.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  currentUser;
  isLoggingOut = false;
  showNotifications = signal(false);

  constructor(
    private router: Router, 
    public authService: AuthService,
    public notificationService: NotificationRealtimeService
  ) {
    this.currentUser = this.authService.currentUser;
  }

  // Fechar dropdown ao clicar fora
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.relative')) {
      this.showNotifications.set(false);
    }
  }

  toggleNotifications(): void {
    this.showNotifications.update(v => !v);
  }

  async handleNotificationClick(notification: Notification): Promise<void> {
    console.log('[Header] Notification clicked');
    
    // Marcar como lida
    if (!notification.is_read) {
      console.log('[Header] Marking notification as read:', notification.id);
      await this.notificationService.markAsRead(notification.id);
    } else {
      console.log('[Header] Notification already read');
    }

    // Navegar para a solicitação se houver
    if (notification.request_id) {
      console.log('[Header] Navigating to request:', notification.request_id);
      this.showNotifications.set(false);
      this.router.navigate(['/requests', notification.request_id]);
    }
    
    // Navegar para materiais se houver material_id
    if (notification.material_id) {
      console.log('[Header] Navigating to materials list');
      this.showNotifications.set(false);
      this.router.navigate(['/materials']);
    }
  }

  async markAllAsRead(): Promise<void> {
    await this.notificationService.markAllAsRead();
  }

  formatNotificationDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `${diffMins}m atrás`;
    if (diffHours < 24) return `${diffHours}h atrás`;
    if (diffDays < 7) return `${diffDays}d atrás`;
    
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async logout(): Promise<void> {
    this.isLoggingOut = true;
    try {
      this.showNotifications.set(false);
      await this.authService.logout();
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch (error) {
      console.error('[Header] Logout error:', error);
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } finally {
      this.isLoggingOut = false;
    }
  }
}
