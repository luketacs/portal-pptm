import '@angular/compiler';
import { jest } from '@jest/globals';
import { SupabaseRestService } from './supabase-rest.service';

afterEach(() => jest.restoreAllMocks());

it.each([401, 403])('limita tentativas de paginação com HTTP %i', async status => {
  const refreshSessionBeforeOperation = jest.fn(async () => ({ success: true }));
  const service = new SupabaseRestService({ getValidAccessToken: async () => 'token', refreshSessionBeforeOperation } as any, {} as any, {} as any);
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"message":"negado"}', { status }));
  const result = await service.getPaged('tabela?select=*');
  expect(result.status).toBe(status);
  expect(fetchMock).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
  expect(refreshSessionBeforeOperation).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
