/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@angular/compiler';
import { jest } from '@jest/globals';
import { AuthService } from './auth.service';

afterEach(() => jest.useRealTimers());

it('conclui o bootstrap mesmo quando o SDK não responde à consulta de sessão', async () => {
  jest.useFakeTimers();
  const service = new AuthService({ client: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: () => new Promise(() => {}),
  } } } as any, {} as any);
  const initialized = service.initializeApp();
  await jest.advanceTimersByTimeAsync(8001);
  await initialized;
  expect(service.isInitializing()).toBe(false);
  expect(service.currentUser()).toBeNull();
  service.ngOnDestroy();
});

function authCom(getSession: () => Promise<unknown>) {
  return new AuthService({ client: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession,
  } } } as any, {} as any);
}

it('sessão lenta não vira logout: usa o token salvo e checkSession não derruba', async () => {
  jest.useFakeTimers();
  localStorage.setItem('portal-pptm-auth', JSON.stringify({ access_token: 'salvo' }));
  const service = authCom(() => new Promise(() => {}));
  const token = service.getValidAccessToken();
  const valida = service.checkSession();
  await jest.advanceTimersByTimeAsync(8001);
  expect(await token).toBe('salvo');
  expect(await valida).toBe(true);
  localStorage.removeItem('portal-pptm-auth');
  service.ngOnDestroy();
});

it('sem sessão de fato, checkSession diz que não há sessão', async () => {
  const service = authCom(async () => ({ data: { session: null }, error: null }));
  expect(await service.checkSession()).toBe(false);
  expect(await service.getValidAccessToken()).toBeNull();
  service.ngOnDestroy();
});
