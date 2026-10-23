import '@angular/compiler';
import { EletricaReparoService } from './eletrica-reparo.service';

// Builder mínimo do supabase-js: encadeia tudo e resolve com a resposta da fila.
function clienteFake(respostas: unknown[]) {
  const chamadas: string[] = [];
  const builder: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        const r = respostas.shift();
        return (ok: (v: unknown) => void) => ok(r);
      }
      return (...args: unknown[]) => { chamadas.push(`${prop}(${args.map(a => JSON.stringify(a)).join(',')})`); return builder; };
    },
  });
  return { client: { from: () => builder }, chamadas };
}

const linha = (id: string, criado: string, extra: Record<string, unknown> = {}) => ({
  id, numero: 1, solicitante_id: 'u', solicitante_nome: 'U', equipamento: 'Motor', resumo: 'r', servico_solicitado: 's',
  status: 'aberto', created_at: criado, ...extra,
});

const admin = { id: 'u', name: 'Admin', role: 'Admin' };

function criar(respostas: unknown[]) {
  const fake = clienteFake(respostas);
  const service = new EletricaReparoService(fake as any, { currentUser: () => admin } as any, { log() {} } as any);
  return { service, fake };
}

it('atualizarStatus troca só a linha gravada, sem recarregar a tabela', async () => {
  const { service, fake } = criar([
    { data: [linha('a', '2026-10-02T00:00:00Z'), linha('b', '2026-10-01T00:00:00Z')], error: null },
    { data: [], error: null },
    { data: [linha('b', '2026-10-01T00:00:00Z', { status: 'em_reparo' })], error: null },
  ]);
  await service.load();
  fake.chamadas.length = 0;
  await service.atualizarStatus('b', { status: 'em_reparo' } as any);
  expect(fake.chamadas.some(c => c.startsWith('range'))).toBe(false);
  expect(service.reparos().map(r => [r.id, r.status])).toEqual([['a', 'aberto'], ['b', 'em_reparo']]);
});

it('atualizarStatus barrado pelo RLS (0 linhas) avisa e não mexe na lista', async () => {
  const { service } = criar([
    { data: [linha('a', '2026-10-02T00:00:00Z')], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await service.load();
  await expect(service.atualizarStatus('a', { status: 'em_reparo' } as any)).rejects.toThrow('Sem permissão');
  expect(service.reparos()[0].status).toBe('aberto');
});

it('excluir tira o reparo da lista', async () => {
  const { service } = criar([
    { data: [linha('a', '2026-10-02T00:00:00Z'), linha('b', '2026-10-01T00:00:00Z')], error: null },
    { data: [], error: null },
    { data: [{ numero: 1, equipamento: 'Motor' }], error: null },
  ]);
  await service.load();
  await service.excluir('a');
  expect(service.reparos().map(r => r.id)).toEqual(['b']);
});
