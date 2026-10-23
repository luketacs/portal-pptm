import '@angular/compiler';
import { ManutencaoPlanosService } from './manutencao-planos.service';

// Cliente Supabase falso: cada tabela tem sua fila de respostas; qualquer cadeia
// from().update().eq().select()... termina na próxima resposta (await direto ou
// .single()). Fila vazia = página vazia (fim da paginação). Registra as tabelas lidas
// pra provar que a gravação não recarrega tudo.
type Filas = Record<string, unknown[]>;
function clienteFalso(filas: Filas) {
  const tabelas: string[] = [];
  const proxima = (t: string) => Promise.resolve(filas[t]?.shift() ?? { data: [], error: null });
  const from = (t: string) => {
    tabelas.push(t);
    const cadeia: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'in', 'order', 'range', 'upsert']) cadeia[m] = () => cadeia;
    cadeia['single'] = () => proxima(t);
    cadeia['then'] = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => proxima(t).then(ok, erro);
    return cadeia;
  };
  return { tabelas, client: { from } };
}

const PLANO = {
  id: 'p2', codigo: 'PM-0002', nome: 'Plano 2', equipamento: 'TC05', tag_kks: null, area: 'ELETRICA', especialidade: null,
  descricao: 'd', atividades: [], periodicidade_valor: 1, periodicidade_unidade: 'meses', data_inicial: '2026-01-05',
  responsavel: null, tempo_estimado_horas: null, hh_estimado: null, observacoes: null, ativo: true, numero_os_reservado: null,
  loto_padrao: null, equipamentos_relacionados: null, recursos_apoio: null, agenda_rigida: false, criado_por_id: 'u1',
  criado_por_nome: 'Lucas', created_at: '2026-01-01T00:00:00Z', atualizado_por_id: null, atualizado_por_nome: null,
  atualizado_em: '2026-01-01T00:00:00Z',
};

function criarServico(filas: Filas) {
  const fake = clienteFalso(filas);
  const auth = { currentUser: () => ({ id: 'u1', name: 'Lucas', role: 'Admin' }) };
  const audit = { log: () => {} };
  const service = new ManutencaoPlanosService(fake as any, auth as any, audit as any);
  return { service, tabelas: fake.tabelas };
}

async function carregado(planos: unknown[]) {
  const filas: Filas = {
    manutencao_planos: [{ data: [{ ...PLANO, id: 'p1', codigo: 'PM-0001' }, { ...PLANO, id: 'p3', codigo: 'PM-0003' }], error: null }],
    manutencao_ciclos: [{ data: [
      { id: 'c1', plano_id: 'p1', data_prevista: '2026-02-02', ordem_id: 'o1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'c2', plano_id: 'p3', data_prevista: '2026-02-02', ordem_id: 'o2', created_at: '2026-01-01T00:00:00Z' }], error: null }],
    manutencao_os_previstas: [{ data: [{ plano_id: 'p1', data_prevista: '2026-02-02', numero_os: '123' }], error: null }],
    manutencao_adiamentos: [{ data: [{ plano_id: 'p1', data_ocorrencia: '2026-02-02', nova_data: '2026-02-09' }], error: null }],
  };
  const ctx = criarServico(filas);
  await ctx.service.load();
  filas['manutencao_planos'].push(...planos);
  ctx.tabelas.length = 0;
  return ctx;
}

it('criar coloca o plano devolvido pelo banco na lista, na ordem do código, sem recarregar', async () => {
  const { service, tabelas } = await carregado([{ data: PLANO, error: null }]);
  await service.criar({ nome: 'Plano 2', equipamento: 'TC05', area: 'ELETRICA', descricao: 'd', periodicidadeValor: 1,
    periodicidadeUnidade: 'meses', dataInicial: '2026-01-05' } as any);
  expect(service.planos().map(p => p.codigo)).toEqual(['PM-0001', 'PM-0002', 'PM-0003']);
  expect(tabelas).toEqual(['manutencao_planos']);
});

it('editar barrado pelo RLS (0 linhas) avisa em vez de fingir que salvou', async () => {
  const { service } = await carregado([{ data: null, error: { code: 'PGRST116', message: 'JSON object requested' } }]);
  await expect(service.salvarNumeroOsReservado('p1', '999')).rejects.toThrow('sem permissão');
});

it('excluir tira o plano e o que o banco apaga em cascata (ciclos, OS previstas, adiamentos)', async () => {
  const { service, tabelas } = await carregado([{ data: [{ id: 'p1' }], error: null }]);
  await service.excluir('p1');
  expect(service.planos().map(p => p.id)).toEqual(['p3']);
  expect(service.ciclos().map(c => c.id)).toEqual(['c2']);
  expect(service.osPrevista('p1', '2026-02-02')).toBeNull();
  expect(service.adiamentosPorPlano().has('p1')).toBe(false);
  expect(tabelas).toEqual(['manutencao_planos']);
});
