import '@angular/compiler';
import { jest } from '@jest/globals';
import { UserService } from './user.service';

const perfil = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, email: `${id}@x`, role: 'Solicitante', ...extra });

function criar(rest: Record<string, unknown>, rpc: () => Promise<unknown> = async () => ({ error: null })) {
  const restCompleto = {
    getAllPaged: async () => ({ data: [perfil('a', 'Ana'), perfil('c', 'Carla')], error: null }),
    ...rest,
  };
  return new UserService(
    { client: { rpc } } as any,
    restCompleto as any,
    { currentUser: () => ({ id: 'adm', name: 'Admin', role: 'Admin' }) } as any,
    { log() {} } as any,
    { showError() {} } as any,
  );
}

it('updateUser aplica o perfil devolvido pelo banco sem recarregar', async () => {
  const getAllPaged = jest.fn(async () => ({ data: [perfil('a', 'Ana'), perfil('c', 'Carla')], error: null }));
  const service = criar({
    getAllPaged,
    patchReturning: async () => ({ data: [perfil('a', 'Debora')], error: null }),
  });
  await service.loadUsers();
  const r = await service.updateUser('a', { name: 'Debora' });
  expect(r.success).toBe(true);
  expect(getAllPaged).toHaveBeenCalledTimes(1);
  expect(service.users().map(u => u.name)).toEqual(['Carla', 'Debora']);
});

it('updateUser barrado pelo RLS (0 linhas) devolve erro', async () => {
  const service = criar({ patchReturning: async () => ({ data: [], error: null }) });
  await service.loadUsers();
  const r = await service.updateUser('a', { name: 'X' });
  expect(r.success).toBe(false);
  expect(service.users()[0].name).toBe('Ana');
});

it('deleteUser tira o usuário da lista', async () => {
  const service = criar({});
  await service.loadUsers();
  await service.deleteUser('a');
  expect(service.users().map(u => u.id)).toEqual(['c']);
});
