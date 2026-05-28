import { Injectable, signal } from '@angular/core';
import { UserProfile } from '../models/user.model';
import { SupabaseService } from './supabase.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRestService } from './supabase-rest.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { environment } from '../environments/environment';
import { withRetry } from '../utils/retry';

@Injectable({ providedIn: 'root' })
export class UserService {
  private supabase: SupabaseClient;
  private _users = signal<UserProfile[]>([]);
  users = this._users.asReadonly();
  private _isLoading = false;
  private _hasLoaded = false;
  private readonly OPERATION_TIMEOUT_MS = 10000;
  private readonly PORTAL_URL = environment.portalUrl;
  private readonly DEFAULT_RESET_PASSWORD = 'Pptm@123';

  constructor(
    supabaseService: SupabaseService,
    private supabaseRestService: SupabaseRestService,
    private authService: AuthService,
    private auditLogService: AuditLogService
  ) {
    this.supabase = supabaseService.client;
  }

  private async supabaseRestRequest(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<{ data: null; error: import('../models/database.types').RestError | null }> {
    if (method === 'POST') {
      return this.supabaseRestService.post(path, body, this.OPERATION_TIMEOUT_MS);
    }
    return this.supabaseRestService.patch(path, body, this.OPERATION_TIMEOUT_MS);
  }

  async loadUsers(): Promise<void> {
    if (this._isLoading) return;
    if (this._hasLoaded) return;

    this._isLoading = true;
    let forcedTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      forcedTimeout = setTimeout(() => { this._isLoading = false; }, 15000);

      const { data, error } = await this.supabaseRestService.get<UserProfile[]>(
        'profiles?select=*&order=name.asc',
        this.OPERATION_TIMEOUT_MS
      );
      if (error) throw error;

      this._users.set(data || []);
      this._hasLoaded = true;
    } catch (error) {
      throw error;
    } finally {
      clearTimeout(forcedTimeout);
      this._isLoading = false;
    }
  }

  clearUsers(): void {
    this._users.set([]);
    this._hasLoaded = false;
    this._isLoading = false;
  }

  async addUser(userData: Omit<UserProfile, 'id'> & { password?: string }): Promise<{ success: boolean; error?: string }> {
    if (!userData.password) {
      return { success: false, error: 'Password is required for new users.' };
    }

    try {
      await withRetry(
        async () => {
          const response = await Promise.race([
            fetch('/api/create-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: userData.email,
                password: userData.password,
                name: userData.name,
                role: userData.role,
                department: userData.department ?? '',
                position: userData.position ?? '',
              }),
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout ao criar usuário')), 20000)
            ),
          ]) as Response;

          const result = await response.json() as { success: boolean; error?: string };
          if (!result.success) {
            throw new Error(result.error || 'Erro ao criar usuário');
          }
        },
        { maxAttempts: 2 }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao criar usuário';
      return { success: false, error: message };
    }

    await new Promise(resolve => setTimeout(resolve, 300));
    this._hasLoaded = false;
    await this.loadUsers();

    const admin = this.authService.currentUser();
    if (admin) {
      this.auditLogService.log({
        user_id: admin.id,
        user_name: admin.name,
        event_type: 'user_created',
        resource_type: 'user',
        description: `${admin.name} criou o usuário ${userData.name} (${userData.email}) com perfil ${userData.role}`,
        metadata: { email: userData.email, role: userData.role, department: userData.department },
      });
    }

    // E-mail de boas-vindas: disparado via botão no componente (mailto:)

    return { success: true };
  }

  async updateUser(userId: string, updatedData: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabaseRestRequest(
        'PATCH',
        `profiles?id=eq.${encodeURIComponent(userId)}`,
        updatedData
      );

      if (error) {
        return { success: false, error: error.message };
      }
      await this.loadUsers();

      const admin = this.authService.currentUser();
      const target = this._users().find(u => u.id === userId);
      if (admin) {
        this.auditLogService.log({
          user_id: admin.id,
          user_name: admin.name,
          event_type: 'user_updated',
          resource_type: 'user',
          resource_id: userId,
          description: `${admin.name} atualizou dados do usuário ${target?.name ?? userId}`,
          metadata: { updated_fields: Object.keys(updatedData) },
        });
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro ao atualizar usuário' };
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const targetUser = this._users().find(u => u.id === userId);
    try {
      const deletePromise = this.supabase.rpc('delete_user', { user_id_to_delete: userId });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout ao excluir usuário')), 10000)
      );

      const { error } = (await Promise.race([deletePromise, timeoutPromise])) as any;

      if (error) {
        alert(`Erro ao excluir usuário: ${error.message}. Verifique se a função 'delete_user' existe no Supabase.`);
      } else {
        await this.loadUsers();

        const admin = this.authService.currentUser();
        if (admin) {
          this.auditLogService.log({
            user_id: admin.id,
            user_name: admin.name,
            event_type: 'user_deleted',
            resource_type: 'user',
            resource_id: userId,
            description: `${admin.name} excluiu o usuário ${targetUser?.name ?? userId}`,
            metadata: { deleted_user_name: targetUser?.name, deleted_user_email: targetUser?.email },
          });
        }
      }
    } catch (error: any) {
      alert(`Erro ao excluir usuário: ${error.message || 'Timeout'}`);
    }
  }

  async resetPassword(userId: string, email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error: rpcError } = await this.supabase.rpc('reset_user_password', {
        user_id: userId,
        new_password: this.DEFAULT_RESET_PASSWORD,
      });

      if (rpcError) {
        const { error: resetError } = await this.supabase.auth.resetPasswordForEmail(email, {
          redirectTo: this.getResetRedirectUrl(),
        });

        if (resetError) {
          return {
            success: false,
            error: 'Não foi possível resetar automaticamente. Instrua o usuário a usar "Esqueci minha senha".',
          };
        }

        return {
          success: true,
          error: 'E-mail de recuperação enviado. O usuário deve verificar a caixa de entrada.',
        };
      }

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Para resetar a senha, use Supabase Dashboard > Authentication > Users > Reset Password.',
      };
    }
  }

  async resetPasswordInstant(userId: string, newPassword = this.DEFAULT_RESET_PASSWORD): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.authService.getValidAccessToken();
      if (!token) {
        return { success: false, error: 'Sessão expirada. Faça login novamente.' };
      }

      const response = await fetch('/api/reset-user-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, newPassword }),
      });

      const result = await response.json().catch(() => ({} as any));
      if (!result?.success) {
        return { success: false, error: result?.error || 'Não foi possível resetar a senha.' };
      }

      const admin = this.authService.currentUser();
      const targetUser = this._users().find(u => u.id === userId);
      if (admin) {
        this.auditLogService.log({
          user_id: admin.id,
          user_name: admin.name,
          event_type: 'password_reset',
          resource_type: 'user',
          resource_id: userId,
          description: `${admin.name} redefiniu a senha de ${targetUser?.name ?? userId}`,
          metadata: { target_user_id: userId, target_user_name: targetUser?.name },
        });
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Erro ao resetar a senha.' };
    }
  }

  private getResetRedirectUrl(): string {
    if (typeof window === 'undefined') {
      return `${this.PORTAL_URL}/reset-password`;
    }

    const origin = window.location.origin;
    const isLocal =
      origin.includes('localhost')
      || origin.includes('127.0.0.1');

    return isLocal ? `${origin}/reset-password` : `${this.PORTAL_URL}/reset-password`;
  }
}
