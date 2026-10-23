import '@angular/compiler';
import { jest } from '@jest/globals';
import { AlmoxarifadoService } from './almoxarifado.service';

function clienteContando() {
  const chamadas = { n: 0 };
  const query: any = {
    select: () => query, eq: () => query, order: () => query,
    range: async (from: number) => { if (from === 0) chamadas.n++; return { data: from === 0 ? [{ id: 'a' }] : [], error: null }; },
  };
  return { chamadas, client: { from: () => query } };
}

it('reaproveita as tabelas do almox por alguns minutos e devolve cópia', async () => {
  const { chamadas, client } = clienteContando();
  const service = new AlmoxarifadoService({ client } as any, {} as any);
  const a = await service.getMovimentacoes();
  a.push({ id: 'x' } as any);
  const b = await service.getMovimentacoes();
  expect(chamadas.n).toBe(1);
  expect(b).toHaveLength(1);
  service.limparCache();
  await service.getMovimentacoes();
  expect(chamadas.n).toBe(2);
});

it('cache vence e busca de novo', async () => {
  jest.useFakeTimers();
  const { chamadas, client } = clienteContando();
  const service = new AlmoxarifadoService({ client } as any, {} as any);
  await service.getSaldoReal();
  jest.advanceTimersByTime(5 * 60 * 1000 + 1);
  await service.getSaldoReal();
  expect(chamadas.n).toBe(2);
  jest.useRealTimers();
});
