import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PasswordResetService {
  private readonly PORTAL_URL = environment.portalUrl;

  constructor(private supabase: SupabaseService) {}

  /**
   * Solicita reset de senha enviando e-mail com link.
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const redirectTo = this.getResetRedirectUrl();
      console.log('[PasswordReset] Requesting reset for:', email, 'redirectTo:', redirectTo);

      const { error } = await this.supabase.client.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        console.error('[PasswordReset] Supabase error:', {
          message: error.message,
          status: error.status,
          name: error.name,
        });

        if (error.status === 500) {
          return {
            success: false,
            message: 'Erro no servidor de e-mail do Supabase.',
            error: 'O serviço de e-mail do Supabase está com problema. Verifique as configurações de SMTP no Supabase Dashboard (Authentication > SMTP Settings). ' +
              'Se estiver usando o e-mail integrado do Supabase, o limite de envio pode ter sido atingido (~3/hora). Configure um SMTP externo (ex: Resend, SendGrid).',
          };
        }

        return {
          success: false,
          message: 'Erro ao solicitar reset de senha.',
          error: error.message,
        };
      }

      return {
        success: true,
        message: 'E-mail de reset enviado com sucesso. Verifique sua caixa de entrada.',
      };
    } catch (err: any) {
      console.error('[PasswordReset] Exception:', err);
      return {
        success: false,
        message: 'Erro ao solicitar reset de senha.',
        error: err.message,
      };
    }
  }

  /**
   * Confirma reset com a nova senha.
   */
  async confirmPasswordReset(newPassword: string): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const { data: { session }, error: sessionError } = await this.supabase.client.auth.getSession();

      if (sessionError || !session) {
        return {
          success: false,
          message: 'Sessão inválida.',
          error: 'Faça login novamente.',
        };
      }

      const { error } = await this.supabase.client.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return {
          success: false,
          message: 'Erro ao atualizar senha.',
          error: error.message,
        };
      }

      return {
        success: true,
        message: 'Senha atualizada com sucesso.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: 'Erro ao atualizar senha.',
        error: err.message,
      };
    }
  }

  /**
   * Verifica se há token de reset na URL.
   */
  getResetTokenFromUrl(): boolean {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const type = params.get('type');
    return type === 'recovery';
  }

  /**
   * Obtém o tipo de autenticação da URL.
   */
  getAuthTypeFromUrl(): string | null {
    const params = new URLSearchParams(window.location.hash.substring(1));
    return params.get('type');
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
