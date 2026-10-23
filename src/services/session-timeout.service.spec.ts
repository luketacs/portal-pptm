/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@angular/compiler';
import { jest } from '@jest/globals';
import { SessionTimeoutService } from './session-timeout.service';

afterEach(() => { jest.useRealTimers(); localStorage.clear(); });

const zona = { run: (f: () => unknown) => f(), runOutsideAngular: (f: () => unknown) => f() };

it('aba parada não desloga enquanto outra aba tem atividade', async () => {
  jest.useFakeTimers();
  const logout = jest.fn(async () => undefined);
  const service = new SessionTimeoutService(
    { logout } as any, { navigateByUrl: async () => true } as any,
    { showError() {}, showWarning() {} } as any, zona as any,
  );
  service.start();
  // Outra aba registra atividade aos 20 min.
  await jest.advanceTimersByTimeAsync(20 * 60_000);
  localStorage.setItem('portal-pptm-ultima-atividade', String(Date.now()));
  await jest.advanceTimersByTimeAsync(15 * 60_000);
  expect(logout).not.toHaveBeenCalled();
  // Ninguém mexe mais: 30 min depois da última atividade, desloga.
  await jest.advanceTimersByTimeAsync(16 * 60_000);
  expect(logout).toHaveBeenCalledTimes(1);
  service.stop();
});
