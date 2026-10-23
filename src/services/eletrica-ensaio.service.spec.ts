import '@angular/compiler';
import { EletricaEnsaioService } from './eletrica-ensaio.service';

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
  const client = { from: () => builder, rpc: async () => respostas.shift() };
  return { client, chamadas };
}

const equip = (id: string, tag: string, tipo: string, situacao = 'instalado') => ({
  id, tag, tipo, situacao, tensao_v: 440, classe_isolamento: 'F', tipo_bobina: 'randomica',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const ensaio = (id: string, equipamentoId: string, tipo: string, data: string, numero: number) => ({
  id, equipamento_id: equipamentoId, tipo, data_ensaio: data, numero, resultado: 'aprovado', temperatura_ambiente_c: 25,
  criado_por_nome: 'U', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});

const admin = { id: 'u', name: 'Admin', role: 'Admin' };

async function criarCarregado(respostasDepois: unknown[]) {
  const fake = clienteFake([
    // load(): equipamentos e ensaios em paralelo (cada um com página de dados + página vazia).
    { data: [equip('m1', 'M-01', 'motor'), equip('m2', 'M-02', 'motor', 'reserva'), equip('t1', 'T-01', 'transformador')], error: null },
    { data: [ensaio('e1', 'm1', 'resistencia_isolamento', '2026-09-01', 1), ensaio('e2', 't1', 'transformador', '2026-09-02', 2)], error: null },
    { data: [], error: null },
    { data: [], error: null },
    ...respostasDepois,
  ]);
  const service = new EletricaEnsaioService(fake as any, { currentUser: () => admin } as any, { log() {} } as any);
  await service.load();
  fake.chamadas.length = 0;
  return { service, fake };
}

it('troca relê só os dois equipamentos envolvidos', async () => {
  const { service, fake } = await criarCarregado([
    { data: null, error: null }, // rpc
    { data: [equip('m1', 'M-01', 'motor', 'reserva'), equip('m2', 'M-02', 'motor', 'instalado')], error: null },
  ]);
  await service.trocar({ saiId: 'm1', entraId: 'm2', localSai: '', data: '2026-10-01', motivo: '' });
  expect(fake.chamadas).toContain('in("id",["m1","m2"])');
  expect(fake.chamadas.some(c => c.startsWith('range'))).toBe(false);
  expect(service.motores().map(m => [m.id, m.situacao])).toEqual([['m1', 'reserva'], ['m2', 'instalado']]);
  expect(service.trafos().map(t => t.id)).toEqual(['t1']);
});

it('ensaio gravado entra na lista do tipo certo, na ordem do load', async () => {
  const { service } = await criarCarregado([]);
  // A validação pela norma é testada nos utils; aqui só interessa o encaixe da linha devolvida.
  (service as any).aplicarEnsaio(ensaio('e3', 'm1', 'resistencia_isolamento', '2026-10-01', 3));
  (service as any).aplicarEnsaio(ensaio('e1', 'm1', 'resistencia_isolamento', '2026-09-01', 1));
  expect(service.ensaios().map(e => e.id)).toEqual(['e3', 'e1']);
  expect(service.ensaiosTrafo().map(e => e.id)).toEqual(['e2']);
});

it('excluir equipamento tira ele e os ensaios dele (cascade)', async () => {
  const { service } = await criarCarregado([{ data: [{ tag: 'T-01', tipo: 'transformador' }], error: null }]);
  await service.excluirEquipamento('t1');
  expect(service.trafos()).toEqual([]);
  expect(service.ensaiosTrafo()).toEqual([]);
  expect(service.ensaios().map(e => e.id)).toEqual(['e1']);
});
