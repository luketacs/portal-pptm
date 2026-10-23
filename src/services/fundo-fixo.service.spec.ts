import '@angular/compiler';
import { FundoFixoService } from './fundo-fixo.service';

// Cliente supabase de mentira: cada chamada encadeada só registra a operação e devolve
// a resposta configurada pra tabela quando é aguardada.
function clienteFake(respostas: Record<string, { data: unknown; error: unknown }>, chamadas: string[] = []) {
  return {
    from(tabela: string) {
      const q: any = {
        select: (cols: string) => { chamadas.push(`${tabela}.select(${cols})`); return q; },
        insert: () => { chamadas.push(`${tabela}.insert`); return q; },
        update: () => { chamadas.push(`${tabela}.update`); return q; },
        delete: () => { chamadas.push(`${tabela}.delete`); return q; },
        eq: () => q,
        order: () => q,
        // Paginação do load(): só a primeira página tem dados.
        range: (de: number) => { q.de = de; return q; },
        single: () => q,
        then: (ok: any, err: any) => Promise.resolve(q.de > 0 ? { data: [], error: null } : respostas[tabela]).then(ok, err),
      };
      return q;
    },
  };
}

const admin = { id: 'adm', name: 'Admin', role: 'Admin' };
const linha = (id: string, data: string, extra: Record<string, unknown> = {}) => ({
  id, numero: 1, solicitante_id: 'u', solicitante_nome: 'Fulano', setor: 'Manutenção', fornecedor: null,
  material: 'Parafuso', link_produto: null, valor_estimado: 10, valor_final: null, forma_pagamento: 'cartao',
  forma_pagamento_secundaria: null, valor_final_secundario: null, orcamento_url: null, nota_fiscal_urls: [],
  observacoes: null, status: 'pendente', aprovador_id: null, aprovador_nome: null, motivo_recusa: null,
  comprador_id: null, comprador_nome: null, gestor_aprovador: null, mes_referencia: '2026-10',
  data_solicitacao: data, data_aprovacao: null, data_compra: null, reembolsado: false, data_reembolso: null,
  teams_enviado_em: null, ...extra,
});
const saque = (id: string, data: string) => ({
  id, valor: 100, taxa: null, tipo: 'saque', data_saque: data, mes_referencia: data.slice(0, 7),
  observacoes: null, registrado_por_id: 'adm', registrado_por_nome: 'Admin', created_at: `${data}T10:00:00Z`,
});

function criar(respostas: Record<string, { data: unknown; error: unknown }>, chamadas: string[] = []) {
  return new FundoFixoService(
    { client: clienteFake(respostas, chamadas) } as any,
    { currentUser: () => admin } as any,
    { log() {} } as any,
  );
}

async function comLista(service: FundoFixoService, solicitacoes: unknown[], saques: unknown[] = []) {
  (service as any).supabaseService.client = clienteFake({
    fundo_fixo_solicitacoes: { data: solicitacoes, error: null },
    fundo_fixo_saques: { data: saques, error: null },
  });
}

it('aprovar troca só a linha devolvida pelo banco, sem recarregar a tabela', async () => {
  const chamadas: string[] = [];
  const service = criar({}, chamadas);
  await comLista(service, [linha('b', '2026-10-02T00:00:00Z'), linha('a', '2026-10-01T00:00:00Z')]);
  await service.load();

  (service as any).supabaseService.client = clienteFake({
    fundo_fixo_solicitacoes: { data: [linha('a', '2026-10-01T00:00:00Z', { status: 'aprovado' })], error: null },
  }, chamadas);
  await service.aprovar('a', 'Italo Rosse');

  expect(chamadas).toEqual(['fundo_fixo_solicitacoes.update', 'fundo_fixo_solicitacoes.select(*)']);
  expect(service.solicitacoes().map(s => [s.id, s.status])).toEqual([['b', 'pendente'], ['a', 'aprovado']]);
});

it('UPDATE barrado pelo RLS (0 linhas) vira erro com mensagem de permissão', async () => {
  const service = criar({ fundo_fixo_solicitacoes: { data: [], error: null } });
  await expect(service.marcarReembolsado('a')).rejects.toThrow('sem permissão');
});

it('criarSolicitacao encaixa a nova linha na ordem do load e devolve o número', async () => {
  const fetchOriginal = (globalThis as any).fetch;
  (globalThis as any).fetch = () => Promise.resolve();
  try {
    const service = criar({});
    await comLista(service, [linha('b', '2026-10-03T00:00:00Z'), linha('a', '2026-10-01T00:00:00Z')]);
    await service.load();
    (service as any).supabaseService.client = clienteFake({
      fundo_fixo_solicitacoes: { data: linha('c', '2026-10-02T00:00:00Z', { numero: 42 }), error: null },
    });
    const numero = await service.criarSolicitacao({ setor: 'Manutenção', material: 'X', valorEstimado: 5 } as any, null);
    expect(numero).toBe(42);
    expect(service.solicitacoes().map(s => s.id)).toEqual(['b', 'c', 'a']);
  } finally {
    (globalThis as any).fetch = fetchOriginal;
  }
});

it('saques: registrar encaixa na ordem e excluir tira da lista', async () => {
  const service = criar({});
  await comLista(service, [], [saque('s2', '2026-10-05'), saque('s1', '2026-10-01')]);
  await service.load();

  (service as any).supabaseService.client = clienteFake({ fundo_fixo_saques: { data: saque('s3', '2026-10-03'), error: null } });
  await service.registrarSaque({ valor: 100, tipo: 'saque' } as any);
  expect(service.saques().map(s => s.id)).toEqual(['s2', 's3', 's1']);

  (service as any).supabaseService.client = clienteFake({ fundo_fixo_saques: { data: [{ id: 's2' }], error: null } });
  await service.excluirSaque('s2');
  expect(service.saques().map(s => s.id)).toEqual(['s3', 's1']);
});
