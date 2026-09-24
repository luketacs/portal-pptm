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
