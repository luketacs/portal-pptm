import '@angular/compiler';
import { jest } from '@jest/globals';
import { RequestService } from './request.service';

afterEach(() => jest.useRealTimers());

const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, requester_id: 'u', requestdate: '2026-10-01T00:00:00Z', history: [], status: 'Pendente', ...extra });

it('reutiliza o identificador quando a gravação funciona mas a resposta é perdida', async () => {
  jest.useFakeTimers();
  const ids: string[] = [];
  const service = new RequestService({ showSuccess() {} } as any, {
    postReturning: async (_path: string, rows: { id: string }[]) => {
      ids.push(rows[0].id);
      return { data: null, error: ids.length === 1 ? { message: 'Network error' } : { code: '23505' } };
    },
    get: async () => ({ data: [row(ids[0])], error: null }),
  } as any, { log() {} } as any);
  const saving = service.addRequest({ materialCode: '123', description: 'Material' } as any, { id: 'user', name: 'User', role: 'Solicitante' } as any);
  await jest.advanceTimersByTimeAsync(1001);
  await saving;
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect(service.getById(ids[0])).toBeDefined();
});

it('criar SC entra na lista com a linha devolvida, sem recarregar tudo', async () => {
  const getAllPaged = jest.fn();
  const service = new RequestService({ showSuccess() {} } as any, {
    postReturning: async (_p: string, rows: { id: string }[]) => ({ data: [row(rows[0].id)], error: null }),
    getAllPaged,
  } as any, { log() {} } as any);
  await service.addRequest({ materialCode: '1', description: 'M' } as any, { id: 'u', name: 'U', role: 'Solicitante' } as any);
  expect(service.requests()).toHaveLength(1);
  expect(getAllPaged).not.toHaveBeenCalled();
});

it('editar SC troca só ela na lista; 0 linhas devolvidas (RLS) vira erro', async () => {
  let devolve: unknown[] = [row('a', { description: 'nova' })];
  const getAllPaged = jest.fn(async () => ({ data: [row('a', { description: 'velha' }), row('b')], error: null }));
  const service = new RequestService({} as any, {
    getAllPaged,
    patchReturning: async () => ({ data: devolve, error: null }),
  } as any, { log() {} } as any);
  await service.loadRequests();
  const user = { id: 'u', name: 'U', role: 'Admin' } as any;
  await service.updateRequest('a', { description: 'nova' }, user);
  expect(service.getById('a')?.description).toBe('nova');
  expect(service.requests()).toHaveLength(2);
  expect(getAllPaged).toHaveBeenCalledTimes(1);

  devolve = [];
  await expect(service.updateRequest('a', { description: 'outra' }, user)).rejects.toThrow(/sem permissão/);
});

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
