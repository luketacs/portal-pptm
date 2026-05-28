import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../supabase.config';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  public readonly client: SupabaseClient;
  private readonly AUTH_STORAGE_KEY = 'portal-pptm-auth';
  private readonly LEGACY_AUTH_STORAGE_KEY = 'gestor-compras-auth';

  constructor() {
    if (!supabaseConfig.url || !supabaseConfig.key || supabaseConfig.url === 'YOUR_SUPABASE_URL') {
      console.error(
        `%cERRO DE CONFIGURAÇÃO DO SUPABASE`,
        'color: white; background: red; padding: 4px; border-radius: 4px;',
        '\nA URL e a chave do Supabase não estão configuradas. Por favor, atualize o arquivo src/supabase.config.ts com suas credenciais.'
      );
      // Create a dummy client to prevent the app from crashing entirely
      this.client = { from: () => ({ select: () => Promise.resolve({ error: { message: 'Not configured' } }) } as any) } as any;
    } else {
      this.migrateLegacyAuthStorage();

      // Use the imported `createClient` function directly for robust initialization.
      this.client = createClient(supabaseConfig.url, supabaseConfig.key, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
          storageKey: this.AUTH_STORAGE_KEY,
          flowType: 'pkce'
        }
      });
    }
  }

  private migrateLegacyAuthStorage(): void {
    try {
      const current = window.localStorage.getItem(this.AUTH_STORAGE_KEY);
      if (current) return;

      const legacy = window.localStorage.getItem(this.LEGACY_AUTH_STORAGE_KEY);
      if (!legacy) return;

      window.localStorage.setItem(this.AUTH_STORAGE_KEY, legacy);
    } catch (error) {
      console.warn('[SupabaseService] Falha ao migrar chave legada de sessão:', error);
    }
  }
}


