import { removerDaLista, upsertNaLista, upsertVariosNaLista } from './lista-local';

const a = { id: 'a', n: 1 }, b = { id: 'b', n: 2 };

it('upsertNaLista troca pelo id ou insere no início', () => {
  expect(upsertNaLista([a, b], { id: 'b', n: 9 })).toEqual([a, { id: 'b', n: 9 }]);
  expect(upsertNaLista([a], b)).toEqual([b, a]);
  expect(upsertNaLista([b], a, (x, y) => x.n - y.n)).toEqual([a, b]);
});

it('upsertVariosNaLista aplica trocas e inserções juntas', () => {
  expect(upsertVariosNaLista([a], [{ id: 'a', n: 5 }, b])).toEqual([b, { id: 'a', n: 5 }]);
});

it('removerDaLista tira pelo id', () => {
  expect(removerDaLista([a, b], 'a')).toEqual([b]);
});
