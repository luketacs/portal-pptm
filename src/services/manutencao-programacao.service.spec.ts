import '@angular/compiler';
import { jest } from '@jest/globals';
import { ManutencaoProgramacaoService, mensagemErroGravacao } from './manutencao-programacao.service';

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const LINHA = {
  id: 'os-1', tipo: 'ordem', area: 'ELETRICA', categoria_indicador: 'ELETRICA', semana_inicio: '2026-10-05', numero_os: null,
  sem_os: true, descricao: 'Teste', equipamento: null, equipamentos_relacionados: null, recursos: null, loto: 'LOTO',
  area_atuacao: null, duracao_horas: null, tipo_servico: null, tecnico_nome: 'Carlos Jr', tecnico_matricula: null,
  dias_previstos: ['2026-10-05'], status: 'PEND', observacoes: null, reuniao_horario: null, reuniao_local: null,
  plano_preventivo_id: null, ciclo_data_prevista: null, checklist: null, criado_por_id: 'u1', criado_por_nome: 'Lucas',
  created_at: '2026-09-24T12:00:00Z',
};

// Cliente Supabase mínimo: a cadeia from().insert().select().abortSignal().single() devolve
// a promessa que o teste controla.
function clienteQueResponde(resposta: Promise<unknown>) {
  const cadeia: Record<string, unknown> = {};
  for (const m of ['insert', 'update', 'select', 'eq', 'abortSignal']) cadeia[m] = () => cadeia;
  cadeia['single'] = () => resposta;
  return { client: { from: () => cadeia } };
}

function criarServico(resposta: Promise<unknown>) {
  const registros: { event_type: string; metadata?: Record<string, unknown> }[] = [];
  const auth = { currentUser: () => ({ id: 'u1', name: 'Lucas', role: 'Admin' }) };
  const audit = { log: (e: { event_type: string; metadata?: Record<string, unknown> }) => { registros.push(e); } };
  const service = new ManutencaoProgramacaoService(clienteQueResponde(resposta) as any, auth as any, audit as any);
  return { service, registros };
}

const REQ = {
  tipo: 'ordem' as const, area: 'ELETRICA' as const, semanaInicio: '2026-10-05', semOs: true, descricao: 'Teste',
  loto: 'LOTO', tecnicoNome: 'Carlos Jr', diasPrevistos: ['2026-10-05'], status: 'PEND',
};

it('limite de tempo do app vira a mensagem de "não respondeu a tempo", que orienta a tentar de novo', () => {
  expect(mensagemErroGravacao({ name: 'TimeoutError', message: 'Tempo limite de 25 s excedido.' }))
    .toContain('não respondeu a tempo');
});

it('gravação pendurada (ex.: renovação do token travada) não segura o botão pra sempre e é registrada como falha', async () => {
  jest.useFakeTimers();
  const { service, registros } = criarServico(new Promise(() => {}));
  const salvar = service.criarOrdem(REQ, 'os-1');
  const verificacao = expect(salvar).rejects.toThrow('não respondeu a tempo');
  await jest.advanceTimersByTimeAsync(30_000);
  await verificacao;
  expect(registros.map(r => r.event_type)).toContain('manutencao_programacao_salvar_falha');
});

it('gravação que funciona mas demora é registrada como lenta', async () => {
  jest.useFakeTimers();
  const resposta = new Promise(resolve => setTimeout(() => resolve({ data: LINHA, error: null }), 7000));
  const { service, registros } = criarServico(resposta);
  const salvar = service.criarOrdem(REQ, 'os-1');
  await jest.advanceTimersByTimeAsync(7000);
  await expect(salvar).resolves.toBe('os-1');
  const lento = registros.find(r => r.event_type === 'manutencao_programacao_salvar_lento');
  expect(lento?.metadata).toMatchObject({ operacao: 'criar' });
});

it('gravação rápida não gera registro de telemetria', async () => {
  const { service, registros } = criarServico(Promise.resolve({ data: LINHA, error: null }));
  await expect(service.criarOrdem(REQ, 'os-1')).resolves.toBe('os-1');
  expect(registros.map(r => r.event_type).filter(t => t.startsWith('manutencao_programacao_salvar'))).toEqual([]);
});

// ── Aviso "tela desatualizada" ────────────────────────────────────────────
// Canal realtime falso: guarda os callbacks (postgres_changes, broadcast, status) pro
// teste disparar eventos na mão, e o que o serviço manda por broadcast.
function criarServicoComRealtime() {
  const callbacks: Record<string, (p: unknown) => void> = {};
  let aoStatus: (s: string) => void = () => {};
  const enviados: unknown[] = [];
  const canal = {
    on: (tipo: string, _f: unknown, cb: (p: unknown) => void) => { callbacks[tipo] = cb; return canal; },
    subscribe: (cb: (s: string) => void) => { aoStatus = cb; return canal; },
    send: async (m: unknown) => { enviados.push(m); return 'ok'; },
  };
  const cadeia: Record<string, unknown> = {};
  for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'abortSignal']) cadeia[m] = () => cadeia;
  cadeia['single'] = () => Promise.resolve({ data: LINHA, error: null });
  // excluir() faz await direto na cadeia (.delete().eq().select('id')).
  cadeia['then'] = (ok: (v: unknown) => void) => ok({ data: [{ id: 'os-1' }], error: null });
  const supabase = { client: { from: () => cadeia, channel: () => canal, removeChannel: async () => 'ok' } };
  const auth = { currentUser: () => ({ id: 'u1', name: 'Lucas', role: 'Admin' }) };
  const service = new ManutencaoProgramacaoService(supabase as any, auth as any, { log: () => {} } as any);
  service.iniciarMonitoramentoAlteracoes();
  aoStatus('SUBSCRIBED');
  return {
    service, enviados,
    emitir: (p: unknown) => callbacks['postgres_changes'](p),
    broadcast: (payload: unknown) => callbacks['broadcast']({ payload }),
    status: (s: string) => aoStatus(s),
  };
}

const semanas = (service: ManutencaoProgramacaoService) => [...new Set(service.alteracoesExternas().map(a => a.semana))].sort();

it('a própria gravação (linha igual à da lista local) não marca a tela como desatualizada', async () => {
  jest.useFakeTimers();
  const { service, emitir } = criarServicoComRealtime();
  await service.criarOrdem(REQ, 'os-1');
  emitir({ eventType: 'INSERT', new: { ...LINHA, atualizado_por_nome: 'Lucas' }, old: {} });
  await jest.advanceTimersByTimeAsync(3000);
  expect(service.alteracoesExternas()).toEqual([]);
});

it('alteração de outro usuário registra quem alterou, na semana dela (e na antiga, se a OS mudou de semana)', async () => {
  jest.useFakeTimers();
  const { service, emitir } = criarServicoComRealtime();
  await service.criarOrdem(REQ, 'os-1');
  emitir({ eventType: 'INSERT', new: { ...LINHA, id: 'os-2', atualizado_por_nome: 'Maria' }, old: {} });
  emitir({ eventType: 'UPDATE', new: { ...LINHA, semana_inicio: '2026-10-12', loto: 'Não', atualizado_por_nome: 'João' }, old: {} });
  await jest.advanceTimersByTimeAsync(3000);
  expect(semanas(service)).toEqual(['2026-10-05', '2026-10-12']);
  expect(service.alteracoesExternas().map(a => a.nome)).toEqual(['Maria', 'João', 'João']);
});

it('exclusão: só avisa se a OS ainda está na lista local (senão foi esta tela que excluiu)', async () => {
  jest.useFakeTimers();
  const { service, emitir } = criarServicoComRealtime();
  emitir({ eventType: 'DELETE', new: {}, old: { id: 'os-1' } });
  await jest.advanceTimersByTimeAsync(3000);
  expect(service.alteracoesExternas()).toEqual([]);
  await service.criarOrdem(REQ, 'os-1');
  emitir({ eventType: 'DELETE', new: {}, old: { id: 'os-1' } });
  await jest.advanceTimersByTimeAsync(3000);
  expect(service.alteracoesExternas()).toMatchObject([{ semana: '2026-10-05', nome: null }]);
});

it('quem exclui avisa o próprio nome por broadcast, e quem recebe registra a exclusão com esse nome', async () => {
  const { service, enviados, broadcast } = criarServicoComRealtime();
  await service.criarOrdem(REQ, 'os-1');
  await service.excluir('os-1');
  expect(enviados).toEqual([{ type: 'broadcast', event: 'exclusao', payload: { semana: '2026-10-05', nome: 'Lucas' } }]);
  broadcast({ semana: '2026-10-05', nome: 'Maria' });
  expect(service.alteracoesExternas()).toMatchObject([{ semana: '2026-10-05', nome: 'Maria' }]);
});

it('reconexão do canal marca tudo como possivelmente desatualizado', () => {
  const { service, status } = criarServicoComRealtime();
  status('SUBSCRIBED');
  expect(semanas(service)).toEqual(['*']);
});

// ── Cadastros (férias/semanas fechadas/parada) sem recarregar a tabela ────────
// Fila de respostas por tabela; fila vazia = página vazia (fim da paginação).
function servicoComTabelas(filas: Record<string, unknown[]>) {
  const tabelas: string[] = [];
  const proxima = (t: string) => Promise.resolve(filas[t]?.shift() ?? { data: [], error: null });
  const from = (t: string) => {
    tabelas.push(t);
    const cadeia: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'delete', 'select', 'eq', 'is', 'order', 'range', 'limit']) cadeia[m] = () => cadeia;
    cadeia['single'] = () => proxima(t);
    cadeia['then'] = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => proxima(t).then(ok, erro);
    return cadeia;
  };
  const auth = { currentUser: () => ({ id: 'u1', name: 'Lucas', role: 'Admin' }) };
  const service = new ManutencaoProgramacaoService({ client: { from } } as any, auth as any, { log: () => {} } as any);
  return { service, tabelas };
}

const FERIAS = (id: string, inicio: string) =>
  ({ id, tecnico_nome: 'Carlos Jr', tecnico_matricula: null, area: 'ELETRICA', data_inicio: inicio, data_fim: inicio });

it('criarFerias entra na lista na ordem de data_inicio, sem reler a tabela', async () => {
  const filas: Record<string, unknown[]> = { manutencao_ferias: [{ data: [FERIAS('f1', '2026-01-05'), FERIAS('f3', '2026-03-02')], error: null }] };
  const { service, tabelas } = servicoComTabelas(filas);
  await service.loadFerias();
  filas['manutencao_ferias'].push({ data: FERIAS('f2', '2026-02-02'), error: null });
  tabelas.length = 0;
  await service.criarFerias({ tecnicoNome: 'Carlos Jr', tecnicoMatricula: null, area: 'ELETRICA', dataInicio: '2026-02-02', dataFim: '2026-02-02' });
  expect(service.ferias().map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
  expect(tabelas).toEqual(['manutencao_ferias']);
});

it('fechar e reabrir semana atualizam o mapa local sem reler', async () => {
  const filas: Record<string, unknown[]> = {
    manutencao_semanas_fechadas: [
      { data: { semana_inicio: '2026-10-05', fechado_por_nome: 'Lucas', fechado_em: '2026-10-09T10:00:00Z' }, error: null },
      { data: [{ semana_inicio: '2026-10-05' }], error: null },
    ],
  };
  const { service, tabelas } = servicoComTabelas(filas);
  await service.fecharSemana('2026-10-05');
  expect(service.infoSemanaFechada('2026-10-05')?.fechadoPorNome).toBe('Lucas');
  await service.reabrirSemana('2026-10-05');
  expect(service.semanaEstaFechada('2026-10-05')).toBe(false);
  expect(tabelas).toEqual(['manutencao_semanas_fechadas', 'manutencao_semanas_fechadas']);
});

it('reabrir semana barrado pelo RLS (0 linhas) avisa em vez de fingir que reabriu', async () => {
  const fechada = { semana_inicio: '2026-10-05', fechado_por_nome: 'Lucas', fechado_em: '2026-10-09T10:00:00Z' };
  const filas: Record<string, unknown[]> = {
    manutencao_semanas_fechadas: [{ data: [fechada], error: null }, { data: [], error: null }, { data: [fechada], error: null }],
  };
  const { service } = servicoComTabelas(filas);
  await service.loadSemanasFechadas();
  await expect(service.reabrirSemana('2026-10-05')).rejects.toThrow('permissão');
  expect(service.semanaEstaFechada('2026-10-05')).toBe(true);
});

// ── Carga inteligente e cache do SIGMA ───────────────────────────────────
function criarServicoContandoCargas() {
  const cargas = { n: 0 };
  let aoStatus: (s: string) => void = () => {};
  const callbacks: Record<string, (p: unknown) => void> = {};
  const canal = {
    on: (tipo: string, _f: unknown, cb: (p: unknown) => void) => { callbacks[tipo] = cb; return canal; },
    subscribe: (cb: (s: string) => void) => { aoStatus = cb; return canal; },
  };
  const cadeia: Record<string, unknown> = {};
  for (const m of ['select', 'order']) cadeia[m] = () => cadeia;
  cadeia['range'] = async (from: number) => { if (from === 0) cargas.n++; return { data: from === 0 ? [LINHA] : [], error: null }; };
  const supabase = { client: { from: () => cadeia, channel: () => canal, removeChannel: async () => 'ok' } };
  const service = new ManutencaoProgramacaoService(supabase as any, { currentUser: () => null, getValidAccessToken: async () => 't' } as any, { log: () => {} } as any);
  return { service, cargas, status: (s: string) => aoStatus(s), emitir: (p: unknown) => callbacks['postgres_changes'](p) };
}

it('voltar à tela sem alteração externa não relê as OS; com alteração (ou canal caído), relê', async () => {
  jest.useFakeTimers();
  const { service, cargas, status, emitir } = criarServicoContandoCargas();
  service.iniciarMonitoramentoAlteracoes();
  status('SUBSCRIBED');
  await service.loadSeNecessario();
  await service.loadSeNecessario();
  expect(cargas.n).toBe(1);

  emitir({ eventType: 'INSERT', new: { ...LINHA, id: 'os-9' }, old: {} });
  await jest.advanceTimersByTimeAsync(3000);
  await service.loadSeNecessario();
  expect(cargas.n).toBe(2);

  status('CHANNEL_ERROR');
  await service.loadSeNecessario();
  expect(cargas.n).toBe(3);
});

it('sem canal de alterações, sempre relê', async () => {
  const { service, cargas } = criarServicoContandoCargas();
  await service.loadSeNecessario();
  await service.loadSeNecessario();
  expect(cargas.n).toBe(2);
});

it('SIGMA: OS consultada há pouco vem do cache; forçar consulta de novo', async () => {
  const pedidos: string[] = [];
  globalThis.fetch = (async (url: string) => {
    pedidos.push(decodeURIComponent(url.split('numeros_os=')[1] ?? ''));
    const numeros = (decodeURIComponent(url.split('numeros_os=')[1] ?? '')).split(',');
    return { ok: true, json: async () => ({ success: true, data: Object.fromEntries(numeros.map(n => [n, { numero: n }])) }) };
  }) as any;
  const { service } = criarServicoContandoCargas();
  await service.consultarOrdensSigma(['1', '2']);
  const r = await service.consultarOrdensSigma(['1', '2', '3']);
  expect(Object.keys(r).sort()).toEqual(['1', '2', '3']);
  await service.consultarOrdensSigma(['1'], true);
  expect(pedidos).toEqual(['1,2', '3', '1']);
});

it('editar: queda de rede (Failed to fetch) tenta de novo uma vez antes de falhar', async () => {
  let chamadas = 0;
  const cadeia: Record<string, unknown> = {};
  for (const m of ['update', 'select', 'eq', 'abortSignal']) cadeia[m] = () => cadeia;
  cadeia['single'] = () => {
    chamadas++;
    return Promise.resolve(chamadas === 1
      ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
      : { data: LINHA, error: null });
  };
  const registros: { event_type: string }[] = [];
  const service = new ManutencaoProgramacaoService({ client: { from: () => cadeia } } as any,
    { currentUser: () => ({ id: 'u1', name: 'Lucas', role: 'Admin' }) } as any, { log: (e: { event_type: string }) => registros.push(e) } as any);
  const executar = (service as any).executarGravacao.bind(service);
  const r = await executar('editar', () => (cadeia['single'] as () => Promise<unknown>)());
  expect(r.error).toBeNull();
  expect(chamadas).toBe(2);
  expect(registros).toEqual([]);

  chamadas = 0;
  const criar = await executar('criar', () => (cadeia['single'] as () => Promise<unknown>)());
  expect(criar.error?.message).toContain('Failed to fetch');
  expect(chamadas).toBe(1);
});
