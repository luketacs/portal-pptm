import '@angular/compiler';
import { jest } from '@jest/globals';
import { PasswordResetService } from './password-reset.service';
import { SupabaseService } from './supabase.service';

function fixture(recoveryUserId: string | null = 'user') {
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: { user: { id: 'user' } } }, error: null })),
    updateUser: jest.fn(async () => ({ error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  const profile = { data: { id: 'user' } as { id: string } | null, error: null as { message: string } | null };
  const query: any = { update: () => query, eq: () => query, select: () => query, single: async () => profile };
  const supabase = { recoveryUserId, client: { auth, from: () => query } };
  return { auth, profile, supabase, service: new PasswordResetService(supabase as unknown as SupabaseService) };
}

it('aceita a sessão PASSWORD_RECOVERY mesmo sem token no hash (PKCE)', async () => {
  const f = fixture();
  expect(await f.service.hasRecoverySession()).toBe(true);
  expect((await f.service.confirmPasswordReset('NovaSenha123!')).success).toBe(true);
  expect(f.auth.updateUser).toHaveBeenCalledWith({ password: 'NovaSenha123!' });
  expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(f.supabase.recoveryUserId).toBeNull();
});

it('não confunde login comum com recuperação de senha', async () => {
  const f = fixture(null);
  expect((await f.service.confirmPasswordReset('NovaSenha123!')).success).toBe(false);
  expect(f.auth.updateUser).not.toHaveBeenCalled();
});

it('não informa conclusão quando o perfil não foi atualizado', async () => {
  const f = fixture();
  f.profile.data = null;
  f.profile.error = { message: 'RLS' };
  expect((await f.service.confirmPasswordReset('NovaSenha123!')).success).toBe(false);
  expect(f.auth.signOut).not.toHaveBeenCalled();
});
