import '@angular/compiler';
import { jest } from '@jest/globals';
import { RequestService } from './request.service';

afterEach(() => jest.useRealTimers());

it('reutiliza o identificador quando a gravação funciona mas a resposta é perdida', async () => {
  jest.useFakeTimers();
  const ids: string[] = [];
  const service = new RequestService({ showSuccess() {} } as any, {
    post: async (_path: string, rows: { id: string }[]) => {
      ids.push(rows[0].id);
      return { error: ids.length === 1 ? { message: 'Network error' } : { code: '23505' } };
    },
    get: async () => ({ data: [{ id: ids[0] }], error: null }),
  } as any, { log() {} } as any);
  const saving = service.addRequest({ materialCode: '123', description: 'Material' } as any, { id: 'user', name: 'User', role: 'Solicitante' } as any, true);
  await jest.advanceTimersByTimeAsync(1001);
  await saving;
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});
