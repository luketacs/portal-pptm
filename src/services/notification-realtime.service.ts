import { Injectable, signal, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { Notification } from '../models/notification.model';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { SupabaseRestService } from './supabase-rest.service';
import type { NotificationRow } from '../models/database.types';

@Injectable({
  providedIn: 'root'
})
export class NotificationRealtimeService {
  private supabase = this.supabaseService.client;
  private channel: RealtimeChannel | null = null;
  private lastSubscribeAttempt = 0;
  private readonly SUBSCRIBE_DEBOUNCE_MS = 3000; // 3 segundos entre reconexões
  private readonly OPERATION_TIMEOUT_MS = 10000;
  
  notifications = signal<Notification[]>([]);
  unreadCount = signal(0);
  isLoading = signal(false);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private supabaseRestService: SupabaseRestService
  ) {
    // Quando usuário logar, carregar notificações e iniciar realtime
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadNotifications();
        this.subscribeToNotifications();
      } else {
        this.unsubscribe();
        this.clearNotifications();
      }
    });
  }

  private async supabaseRestRequest(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<{ data: null; error: import('../models/database.types').RestError | null }> {
    if (method === 'POST') {
      return this.supabaseRestService.post(path, body, this.OPERATION_TIMEOUT_MS);
    }
    return this.supabaseRestService.patch(path, body, this.OPERATION_TIMEOUT_MS);
  }

  private async supabaseRestDelete(path: string): Promise<{ success: boolean; error: import('../models/database.types').RestError | null }> {
    return this.supabaseRestService.delete(path, this.OPERATION_TIMEOUT_MS);
  }

  async loadNotifications(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    this.isLoading.set(true);
    let forcedTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      forcedTimeout = setTimeout(() => {
        this.isLoading.set(false);
      }, 15000);
      console.log('[NotificationRealtimeService] Loading notifications');

      const { data, error } = await this.supabaseRestService.get<Notification[]>(
        `notifications?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=50`,
        this.OPERATION_TIMEOUT_MS
      );

      if (error) {
        console.error('[NotificationRealtimeService] Error loading notifications:', error);
        throw error;
      }

      console.log('[NotificationRealtimeService] Loaded', data?.length || 0, 'notifications');
      console.log('[NotificationRealtimeService] Unread count:', data?.filter((n: Notification) => !n.is_read).length || 0);

      this.notifications.set(data || []);
      this.updateUnreadCount();
    } catch (error) {
      console.error('[NotificationRealtimeService] Exception loading notifications:', error);
    } finally {
      clearTimeout(forcedTimeout);
      this.isLoading.set(false);
    }
  }

  private subscribeToNotifications(): void {
    const user = this.authService.currentUser();
    if (!user) return;

    // Debounce: evitar reconexões rápidas que causam loops
    const now = Date.now();
    if (now - this.lastSubscribeAttempt < this.SUBSCRIBE_DEBOUNCE_MS) {
      console.log('[NotificationRealtimeService] Subscribe attempt ignored (debounced)');
      return;
    }
    this.lastSubscribeAttempt = now;

    // Cancelar subscription anterior se existir
    this.unsubscribe();
    
    console.log('[NotificationRealtimeService] Subscribing to notifications');

    // Criar nova subscription
    this.channel = this.supabase
      .channel('notifications')
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
          console.log('[NotificationRealtimeService] INSERT event received');
          const newNotification = payload.new as Notification;
          this.notifications.update(notifications => [newNotification, ...notifications]);
          this.updateUnreadCount();
          this.showBrowserNotification(newNotification);
        }
      )
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
          console.log('[NotificationRealtimeService] UPDATE event received');
          const updatedNotification = payload.new as Notification;
          this.notifications.update(notifications =>
            notifications.map(n => (n.id === updatedNotification.id ? updatedNotification : n))
          );
          this.updateUnreadCount();
        }
      )
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
          console.log('[NotificationRealtimeService] DELETE event received');
          const deletedId = (payload.old as Partial<NotificationRow>).id;
          this.notifications.update(notifications =>
            notifications.filter(n => n.id !== deletedId)
          );
          this.updateUnreadCount();
        }
      )
      .subscribe();
  }

  private unsubscribe(): void {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  async markAsRead(notificationId: string): Promise<void> {
    console.log('[NotificationRealtimeService] Marking as read:', notificationId);
    
    // Atualizar localmente PRIMEIRO (otimista) para feedback imediato
    this.notifications.update(notifications =>
      notifications.map(n =>
        n.id === notificationId ? { ...n, is_read: true } : n
      )
    );
    this.updateUnreadCount();
    
    // Depois atualizar no banco (o realtime fará sync automático se houver conflito)
    const { error } = await this.supabaseRestRequest(
      'PATCH',
      `notifications?id=eq.${encodeURIComponent(notificationId)}`,
      { is_read: true }
    );

    if (error) {
      console.error('[NotificationRealtimeService] Error marking notification as read:', error);
      
      // Reverter mudança local em caso de erro
      this.notifications.update(notifications =>
        notifications.map(n =>
          n.id === notificationId ? { ...n, is_read: false } : n
        )
      );
      this.updateUnreadCount();
      return;
    }
    
    console.log('[NotificationRealtimeService] Successfully marked as read:', notificationId);
  }

  async markAllAsRead(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    console.log('[NotificationRealtimeService] Marking all as read for user:', user.id);
    
    // Salvar estado anterior para possível rollback
    const previousNotifications = this.notifications();
    
    // Atualizar localmente PRIMEIRO (otimista)
    this.notifications.update(notifications =>
      notifications.map(n => ({ ...n, is_read: true }))
    );
    this.updateUnreadCount();

    // Depois atualizar no banco
    const { error } = await this.supabaseRestRequest(
      'PATCH',
      `notifications?user_id=eq.${encodeURIComponent(user.id)}&is_read=eq.false`,
      { is_read: true }
    );

    if (error) {
      console.error('[NotificationRealtimeService] Error marking all as read:', error);
      
      // Reverter para estado anterior em caso de erro
      this.notifications.set(previousNotifications);
      this.updateUnreadCount();
      return;
    }
    
    console.log('[NotificationRealtimeService] Successfully marked all as read');
  }

  async deleteNotification(notificationId: string): Promise<void> {
    const { error } = await this.supabaseRestDelete(
      `notifications?id=eq.${encodeURIComponent(notificationId)}`
    );

    if (error) {
      console.error('Error deleting notification:', error);
      return;
    }

    // Remover localmente
    this.notifications.update(notifications =>
      notifications.filter(n => n.id !== notificationId)
    );
    this.updateUnreadCount();
  }

  private updateUnreadCount(): void {
    const unread = this.notifications().filter(n => !n.is_read).length;
    const previousCount = this.unreadCount();
    
    if (previousCount !== unread) {
      console.log('[NotificationRealtimeService] Unread count changed:', previousCount, '→', unread);
    }
    
    this.unreadCount.set(unread);
  }

  private showBrowserNotification(notification: Notification): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/icon-192x192.png'
      });
    }
  }

  async requestPermission(): Promise<void> {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  clearNotifications(): void {
    this.notifications.set([]);
    this.unreadCount.set(0);
  }
}
