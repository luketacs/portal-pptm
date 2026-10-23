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

const row = (id: string) => ({ id, requester_id: 'u', requestdate: '2026-10-01T00:00:00Z', history: [] });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

it('pagina com desempate por id pra SC não escapar entre páginas', async () => {
  const paths: string[] = [];
  const service = new RequestService({} as any, {
    getAllPaged: async (path: string) => { paths.push(path); return { data: [], error: null }; },
  } as any, {} as any);
  await service.loadRequests();
  expect(paths[0]).toContain('order=requestdate.desc,id.desc');
});

it('reload forçado durante uma carga espera ela e busca de novo', async () => {
  const pendentes: Array<ReturnType<typeof deferred<{ data: unknown[]; error: null }>>> = [];
  const service = new RequestService({} as any, {
    getAllPaged: () => { const d = deferred<{ data: unknown[]; error: null }>(); pendentes.push(d); return d.promise; },
  } as any, {} as any);

  const primeira = service.loadRequests();
  const forcada = service.loadRequests(true);
  pendentes[0].resolve({ data: [row('a')], error: null });
  await primeira;
  await Promise.resolve();
  expect(pendentes).toHaveLength(2);
  pendentes[1].resolve({ data: [row('a'), row('b')], error: null });
  await forcada;
  expect(service.requests().map(r => r.id)).toEqual(['a', 'b']);
});

it('carga que termina depois do logout não repopula a lista', async () => {
  const d = deferred<{ data: unknown[]; error: null }>();
  const service = new RequestService({} as any, { getAllPaged: () => d.promise } as any, {} as any);
  const carga = service.loadRequests();
  service.clearRequests();
  d.resolve({ data: [row('a')], error: null });
  await carga;
  expect(service.requests()).toEqual([]);
});

it('fetchById busca a SC fora da lista e encaixa nela', async () => {
  const service = new RequestService({} as any, {
    get: async (path: string) => ({ data: path.includes('id=eq.x') ? [row('x')] : [], error: null }),
  } as any, {} as any);
  const found = await service.fetchById('x');
  expect(found?.id).toBe('x');
  expect(service.getById('x')?.id).toBe('x');
});
