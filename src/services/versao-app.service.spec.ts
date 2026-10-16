import '@angular/compiler';
import { jest } from '@jest/globals';
import { VersaoAppService } from './versao-app.service';

// Ambiente node: o serviço só usa addEventListener/removeEventListener do document.
(globalThis as any).document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };

afterEach(() => { jest.restoreAllMocks(); });

// fetch falso: cada chamada devolve a próxima resposta da fila (null = falha de rede).
function fetchComRespostas(respostas: (string | null)[]) {
  const fila = [...respostas];
  globalThis.fetch = jest.fn(async () => {
    const versao = fila.shift();
    if (versao === null || versao === undefined) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ versao }) } as Response;
  }) as typeof fetch;
}

it('mesma versão publicada não mostra o aviso', async () => {
  fetchComRespostas(['abc', 'abc']);
  const s = new VersaoAppService();
  await s.verificar();
  await s.verificar();
  expect(s.novaVersao()).toBe(false);
});

it('versão publicada diferente da que a aba abriu liga o aviso', async () => {
  fetchComRespostas(['abc', 'def']);
  const s = new VersaoAppService();
  await s.verificar();
  await s.verificar();
  expect(s.novaVersao()).toBe(true);
});

it('falha de rede não conta como versão nova (nem vira a versão base)', async () => {
  fetchComRespostas([null, 'abc', 'abc']);
  const s = new VersaoAppService();
  await s.verificar();
  await s.verificar();
  await s.verificar();
  expect(s.novaVersao()).toBe(false);
});
