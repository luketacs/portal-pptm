import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PasswordResetService {
  private readonly PORTAL_URL = environment.portalUrl;

  constructor(private supabase: SupabaseService) {}

  async hasRecoverySession(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.supabase.client.auth.getSession(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Tempo limite de recuperação.')), 12000);
        }),
      ]);
      // O SDK publica PASSWORD_RECOVERY no próximo turno após concluir a troca PKCE.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return !result.error && !!result.data.session
        && this.supabase.recoveryUserId === result.data.session.user.id;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

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
      if (!(await this.hasRecoverySession())) {
        return { success: false, message: 'Link inválido ou expirado. Solicite um novo link.' };
      }
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

      const { data: profile, error: profileError } = await this.supabase.client
        .from('profiles').update({ must_change_password: false }).eq('id', session.user.id).select('id').single();
      if (profileError || !profile) {
        return { success: false, message: 'Senha alterada, mas não foi possível concluir a atualização do perfil.' };
      }
      await this.supabase.client.auth.signOut({ scope: 'local' });
      this.supabase.recoveryUserId = null;
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
