import { Injectable, signal } from '@angular/core';
import { UserProfile } from '../models/user.model';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase: SupabaseClient;
  currentUser = signal<UserProfile | null>(null);
  isInitializing = signal(true); // Track if initialization is in progress
  isLoggingOut = signal(false);
  isAuthenticating = signal(false);

  // This flag prevents the onAuthStateChange listener from causing race conditions during app initialization.
  private isInitialized = false;
  private authSubscription: any = null;
  private lastAuthStateChange = 0;
  private readonly AUTH_DEBOUNCE_MS = 1000; // 1 segundo de debounce
  private readonly SESSION_TIMEOUT_MS = 8000;
  private readonly LOGIN_TIMEOUT_MS = 12000;
  private readonly AUTH_STORAGE_KEY = 'portal-pptm-auth';
  private readonly LEGACY_AUTH_STORAGE_KEY = 'gestor-compras-auth';

  constructor(supabaseService: SupabaseService, private auditLogService: AuditLogService) {
    this.supabase = supabaseService.client;
    
    // Guardar subscription para cleanup posterior
    this.authSubscription = this.supabase.auth.onAuthStateChange(async (event, session) => {
      // Only allow this reactive listener to run AFTER the initial, imperative setup is complete.
      if (!this.isInitialized) {
        return;
      }
      
      // Debounce: evitar processar múltiplos eventos em sequência rápida (previne loops)
      const now = Date.now();
      if (now - this.lastAuthStateChange < this.AUTH_DEBOUNCE_MS) {
        console.log('[AuthService] Auth state change ignored (debounced):', event);
        return;
      }
      this.lastAuthStateChange = now;
      
      console.log('[AuthService] Auth state change:', event);
      
      // This listener is the single source of truth for auth state changes during the app's lifetime.
      if (event === 'SIGNED_OUT') {
        this.currentUser.set(null);
      } else if (event === 'TOKEN_REFRESHED') {
        // TOKEN_REFRESHED: não precisa recarregar perfil, apenas o token foi renovado
        // O perfil do usuário não mudou, então mantemos o currentUser como está
        console.log('[AuthService] Token renovado, mantendo perfil atual');
      } else if (event === 'SIGNED_IN') {
        // SIGNED_IN também pode ocorrer ao voltar foco na aba.
        // Se já temos o mesmo usuário em memória, evita recarregar perfil e oscilar estado.
        if (session?.user) {
          const current = this.currentUser();
          if (current?.id === session.user.id) {
            return;
          }
          await this.loadUserProfile(session.user.id, 0, true);
        }
      } else if (event === 'USER_UPDATED') {
        // USER_UPDATED: disparado por updateUser (ex: troca de senha).
        // Não recarregar perfil para evitar race condition com a atualização de must_change_password.
        console.log('[AuthService] USER_UPDATED event, mantendo perfil atual');
      } else if (session?.user) {
        // Outros eventos com usuário: manter estado atual em caso de falha transitória.
        await this.loadUserProfile(session.user.id, 0, true);
      } else {
        this.currentUser.set(null);
      }
    });
  }

  ngOnDestroy() {
    // Cleanup da subscription para evitar memory leaks
    if (this.authSubscription) {
      this.authSubscription.data.subscription?.unsubscribe();
      this.authSubscription = null;
    }
  }

  /**
   * Verifica se há uma sessão ativa e válida
   * SIMPLIFICADO: Verifica apenas se currentUser está preenchido
   * Confia no auto-refresh do Supabase
   */
  async checkSession(): Promise<boolean> {
    try {
      const session = await this.getSessionWithTimeout();
      if (!session?.user) {
        return false;
      }

      // Se estiver perto de expirar, tenta renovar preventivamente.
      const expiresAt = session.expires_at ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt > 0 && expiresAt - now <= 60) {
        const refreshed = await this.refreshSessionWithTimeout();
        return !!refreshed?.user;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Obtem o access_token salvo no localStorage (evita chamadas que podem travar)
   */
  getStoredAccessToken(): string | null {
    try {
      const raw =
        localStorage.getItem(this.AUTH_STORAGE_KEY)
        ?? localStorage.getItem(this.LEGACY_AUTH_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed?.access_token || null;
    } catch (error) {
      console.warn('[AuthService] Failed to read access token from storage:', error);
      return null;
    }
  }

  /**
   * Refrescar a sessão antes de operações críticas
   * Garante que o token está válido e a sessão está ativa
   */
  async refreshSessionBeforeOperation(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[AuthService] Refreshing session before operation...');
      const session = await this.getSessionWithTimeout();

      if (!session) {
        console.error('[AuthService] No active session');
        return { success: false, error: 'No active session' };
      }

      // Verificar se token expirou
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      
      if (expiresAt && now >= expiresAt) {
        console.log('[AuthService] Token expired, attempting to refresh...');
        const newSession = await this.refreshSessionWithTimeout();
        if (!newSession) {
          console.error('[AuthService] Failed to refresh token');
          return { success: false, error: 'Token refresh failed' };
        }

        console.log('[AuthService] Token refreshed successfully');
      } else if (expiresAt) {
        console.log('[AuthService] Session is valid, token expires in', expiresAt - now, 'seconds');
      } else {
        console.log('[AuthService] Session is valid');
      }

      return { success: true };
    } catch (error) {
      console.error('[AuthService] Session refresh error:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  async getValidAccessToken(): Promise<string | null> {
    try {
      let session = await this.getSessionWithTimeout();
      if (!session) return null;

      const expiresAt = session.expires_at ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt > 0 && expiresAt - now <= 60) {
        const refreshedSession = await this.refreshSessionWithTimeout();
        if (refreshedSession) {
          session = refreshedSession;
        }
      }

      return session.access_token ?? null;
    } catch {
      return null;
    }
  }

  private async getSessionWithTimeout(): Promise<Session | null> {
    const sessionResult = await Promise.race([
      this.supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), this.SESSION_TIMEOUT_MS)
      ),
    ]);

    const { data: { session }, error } = sessionResult as { data: { session: Session | null }; error: AuthError | null };
    if (error) {
      throw error;
    }
    return session;
  }

  private async refreshSessionWithTimeout(): Promise<Session | null> {
    const refreshResult = await Promise.race([
      this.supabase.auth.refreshSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Session refresh timeout')), this.SESSION_TIMEOUT_MS)
      ),
    ]);

    const { data: { session }, error } = refreshResult as { data: { session: Session | null }; error: AuthError | null };
    if (error) {
      throw error;
    }
    return session;
  }

  /**
   * Verifica se há uma sessão válida
   * DESABILITADO: Supabase client faz auto-refresh automaticamente
   * Manter apenas para compatibilidade - sempre retorna válido
   */
  async checkValidSession(): Promise<{ valid: boolean; error?: string }> {
    // Confia no auto-refresh do Supabase - não faz nenhuma verificação manual
    console.log('[AuthService] Sessão válida. Confiando no auto-refresh do Supabase');
    return { valid: true };
  }

  /**
   * Garante que há uma sessão válida
   * DESABILITADO: Supabase client faz auto-refresh automaticamente
   * Manter apenas para compatibilidade - sempre retorna válido
   */
  async ensureValidSession(): Promise<{ valid: boolean; error?: string }> {
    // Confia no auto-refresh do Supabase - não faz nenhuma verificação manual
    console.log('[AuthService] Sessão válida. Confiando no auto-refresh do Supabase');
    return { valid: true };
  }

  /**
   * This method is called by APP_INITIALIZER. It orchestrates the entire
   * pre-bootstrapping authentication flow to prevent race conditions.
   */
  async initializeApp(): Promise<void> {
    try {
      // 1. Get current session - without timeout to avoid race conditions
      const { data: { session } } = await this.supabase.auth.getSession();

      if (session?.user) {
        try {
          // Verificar se a sessão ainda é válida
          const isValid = await this.isSessionValid(session);
          
          if (isValid) {
            // Load profile
            await this.loadUserProfile(session.user.id);
          } else {
            // Sessão expirada, fazer logout
            console.warn('[AuthService] Session expired, logging out');
            await this.supabase.auth.signOut();
            this.currentUser.set(null);
          }
        } catch (profileError) {
          // Se falhar ao carregar perfil, apenas marca como null mas continua
          console.warn('[AuthService] Profile load failed:', (profileError as Error).message);
          this.currentUser.set(null);
        }
      } else {
        this.currentUser.set(null);
      }
    } catch (error) {
      // Se houver erro na inicialização, continua com usuário null
      console.warn('[AuthService] Initialization error:', (error as Error).message);
      this.currentUser.set(null);
    } finally {
      // IMPORTANTE: Sempre marcar como inicializado, mesmo com erro
      // Isso garante que a app renderiza e o usuário vê alguma coisa
      console.log('[AuthService] initializeApp completed');
      this.isInitialized = true;
      this.isInitializing.set(false); // Signal that initialization is complete
    }
  }

  async login(email: string, password: string): Promise<{ success: boolean; error: string | null }> {
    this.isAuthenticating.set(true);

    console.log('[AuthService] Login attempt');
    
    try {
      const signInResult = await Promise.race([
        this.supabase.auth.signInWithPassword({
          email: email,
          password: password,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Login timeout')), this.LOGIN_TIMEOUT_MS)
        ),
      ]);

      const { data, error } = signInResult as any;
      
      console.log('[AuthService] signInWithPassword result - error:', !!error, 'data:', !!data);
      
      if (error) {
        console.log('[AuthService] Authentication failed - status:', (error as any)?.status);
        const authMessage = this.getLoginAuthErrorMessage(error);
        return { success: false, error: authMessage };
      }
      
      // Validação adicional: verificar se o perfil existe e está ativo
      if (data.user) {
        console.log('[AuthService] User authenticated, loading full profile...');
        const profileResult = await Promise.race([
          this.supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Profile load timeout')), this.LOGIN_TIMEOUT_MS)
          ),
        ]);

        const { data: profile, error: profileError } = profileResult as any;

        if (profileError || !profile) {
          console.log('[AuthService] Profile not found or error:', profileError);
          await this.supabase.auth.signOut();
          return {
            success: false,
            error: this.getLoginProfileErrorMessage(profileError)
          };
        }

        // Verificar se o email do perfil corresponde ao email usado no login
        if (profile.email.toLowerCase() !== email.toLowerCase()) {
          console.log('[AuthService] Email mismatch');
          await this.supabase.auth.signOut();
          return { success: false, error: 'E-mail desatualizado. Entre em contato com o administrador para atualizar seu cadastro.' };
        }

        // Setar o perfil completo no currentUser ANTES de retornar
        // Isto garante que must_change_password e role estejam disponíveis imediatamente
        this.currentUser.set(profile as any);
        console.log('[AuthService] Login successful, profile loaded. must_change_password:', profile.must_change_password);

        this.auditLogService.log({
          user_id: profile.id,
          user_name: profile.name,
          event_type: 'login',
          resource_type: 'auth',
          description: `${profile.name} realizou login`,
          metadata: { email: profile.email, role: profile.role },
        });

        return { success: true, error: null };
      }

      console.log('[AuthService] No user data returned');
      return { success: false, error: 'Ocorreu um erro inesperado.' };
    } catch (error) {
      console.error('[AuthService] Login unexpected error:', error);
      if ((error as Error)?.message?.toLowerCase().includes('timeout')) {
        // Fallback: em cenários de rede/aba, o evento SIGNED_IN pode ocorrer
        // antes da Promise do signIn concluir.
        try {
          const session = await this.getSessionWithTimeout();
          if (session?.user) {
            await this.loadUserProfile(session.user.id, 0, true);
            if (this.currentUser()?.id === session.user.id) {
              return { success: true, error: null };
            }
          }
        } catch {}

        return {
          success: false,
          error: 'A autenticação demorou demais para responder. Verifique sua conexão e tente novamente.',
        };
      }
      return {
        success: false,
        error: 'Não foi possível conectar ao servidor de autenticação. Tente novamente em instantes.'
      };
    } finally {
      this.isAuthenticating.set(false);
    }
  }

  private getLoginAuthErrorMessage(error: any): string {
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || 0);

    if (
      message.includes('invalid login credentials') ||
      message.includes('invalid credentials') ||
      status === 400 ||
      status === 401
    ) {
      return 'E-mail ou senha inválidos.';
    }

    if (message.includes('email not confirmed')) {
      return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
    }

    if (message.includes('too many requests')) {
      return 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.';
    }

    return 'Não foi possível autenticar. Tente novamente em instantes.';
  }

  private getLoginProfileErrorMessage(error: any): string {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();

    if (code === 'PGRST116' || message.includes('no rows')) {
      return 'Usuário autenticado, mas sem cadastro no sistema. Fale com o administrador.';
    }

    if (message.includes('permission denied') || message.includes('rls')) {
      return 'Seu usuário não tem permissão para carregar o perfil. Fale com o administrador.';
    }

    return 'Falha ao carregar dados do usuário após login. Tente novamente.';
  }

  async logout(): Promise<void> {
    this.isLoggingOut.set(true);
    let forcedTimeout: any;
    try {
      // Registrar logout antes de limpar o usuário
      const userBeforeLogout = this.currentUser();
      if (userBeforeLogout) {
        this.auditLogService.log({
          user_id: userBeforeLogout.id,
          user_name: userBeforeLogout.name,
          event_type: 'logout',
          resource_type: 'auth',
          description: `${userBeforeLogout.name} encerrou a sessão`,
        });
      }

      // Limpar o currentUser
      this.currentUser.set(null);

      // Proteção: se signOut travar, forçar reset após 10s
      forcedTimeout = setTimeout(() => {
        this.isLoggingOut.set(false);
        this.currentUser.set(null);
        localStorage.removeItem(this.AUTH_STORAGE_KEY);
        localStorage.removeItem(this.LEGACY_AUTH_STORAGE_KEY);
      }, 10000);

      // Fazer o signOut
      await this.supabase.auth.signOut();

      // Limpar o localStorage manualmente como backup
      localStorage.removeItem(this.AUTH_STORAGE_KEY);
      localStorage.removeItem(this.LEGACY_AUTH_STORAGE_KEY);

      // Notificação de sucesso
    } catch (error) {
      console.error('[AuthService] Logout error:', error);
      // Mesmo com erro, garantir que o usuário seja deslogado localmente
      this.currentUser.set(null);
      localStorage.removeItem(this.AUTH_STORAGE_KEY);
      localStorage.removeItem(this.LEGACY_AUTH_STORAGE_KEY);
    } finally {
      clearTimeout(forcedTimeout);
      this.isLoggingOut.set(false);
    }
    // onAuthStateChange will fire and set currentUser to null automatically.
  }

  /**
   * Verifica se a sessão ainda é válida
   */
  private async isSessionValid(session: any): Promise<boolean> {
    try {
      // Verificar se o token não expirou
      const expiresAt = session.expires_at;
      if (expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        if (now >= expiresAt) {
          return false;
        }
      }
      
      // Verificar se consegue obter o usuário atual
      const { data: { user }, error } = await this.supabase.auth.getUser();
      
      return !error && !!user;
    } catch (error) {
      console.error('[AuthService] Session validation error:', error);
      return false;
    }
  }

  private async loadUserProfile(userId: string, retryCount: number = 0, preserveCurrentOnFailure = false): Promise<void> {
    const MAX_RETRIES = 3;
    
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[AuthService] Erro ao carregar perfil:', error);
        
        // CORREÇÃO CRÍTICA: NÃO fazer logout automático se perfil falhar
        // Pode ser problema temporário de rede ou RLS
        if (retryCount < MAX_RETRIES) {
          console.warn(`[AuthService] Tentando reconectar (${retryCount + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
          return this.loadUserProfile(userId, retryCount + 1, preserveCurrentOnFailure);
        }
        
        // Após 3 tentativas, só derruba sessão se não houver usuário atual válido.
        if (!preserveCurrentOnFailure) {
          console.error('[AuthService] Falha persistente ao carregar perfil. Fazendo logout.');
          this.currentUser.set(null);
        } else {
          console.warn('[AuthService] Falha ao recarregar perfil, mantendo usuário atual.');
        }
        return;
      }
      
      if (data) {
        this.currentUser.set(data as UserProfile);
      }
    } catch (error) {
      console.error('[AuthService] Exceção ao carregar perfil:', error);
      
      // Retry em caso de exceção
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.loadUserProfile(userId, retryCount + 1, preserveCurrentOnFailure);
      }
      
      if (!preserveCurrentOnFailure) {
        this.currentUser.set(null);
      }
    }
  }
}




