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
