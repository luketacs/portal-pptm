import { Solicitacao, MaterialComSAs, SAComAlocacao } from '../services/almoxarifado.service';
import { ordensComMaterialTotalmenteDisponivel } from './manutencao-materiais-disponiveis';

function normalizar(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

function sa(overrides: Partial<Solicitacao>): Solicitacao {
  return {
    id: 'sa-x', sa_numero: '1', produto_codigo: 'P1', qtd_solicitada: 1, qtd_atendida: 0,
    ordem_produto: null, ordem_id: null, recebedor: null, status: 'aberta', ...overrides,
  };
}

function comSAItem(produtoCodigo: string, produtoDesc: string, sas: SAComAlocacao[]): MaterialComSAs {
  return {
    material: {
      produto_codigo: produtoCodigo, produto_desc: produtoDesc, unidade: 'UN', grupo: '',
      custo_medio: 0, saldo_qtd: 0, qtd_entrada_total: 0, qtd_saida_total: 0, valor_total: 0,
      ultima_movimentacao: null,
    },
    sas,
    hasSAs: true,
  };
}

describe('ordensComMaterialTotalmenteDisponivel', () => {
  it('inclui a OS quando a única SA dela chegou completa (não parcial)', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '047009' });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 1, parcial: false }])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1], comSA, normalizar);
    expect(resultado).toEqual([{ numeroOs: '047009', materiais: ['Rolamento 6205'] }]);
  });

  it('exclui a OS quando a SA ficou parcial', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '047009' });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 0.5, parcial: true }])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1], comSA, normalizar);
    expect(resultado).toEqual([]);
  });

  it('exclui a OS quando ela tem 2 SAs e só uma chegou (a outra nem aparece no comSA)', () => {
    // s2 nunca chegou (material ainda em qtd_entrada_total = 0) -- nem entra no comSA.
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '047009' });
    const s2 = sa({ id: 'sa-2', produto_codigo: 'P2', ordem_id: '047009' });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 1, parcial: false }])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1, s2], comSA, normalizar);
    expect(resultado).toEqual([]);
  });

  it('inclui a OS só quando as 2 SAs de materiais diferentes chegaram completas, com os 2 materiais listados', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '047009' });
    const s2 = sa({ id: 'sa-2', produto_codigo: 'P2', ordem_id: '047009' });
    const comSA = [
      comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 1, parcial: false }]),
      comSAItem('P2', 'Correia V-belt', [{ ...s2, qtd_atende: 1, parcial: false }]),
    ];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1, s2], comSA, normalizar);
    expect(resultado).toEqual([{ numeroOs: '047009', materiais: ['Rolamento 6205', 'Correia V-belt'] }]);
  });

  it('ignora SA sem ordem_id (não dá pra saber a qual OS pertence)', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: null });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 1, parcial: false }])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1], comSA, normalizar);
    expect(resultado).toEqual([]);
  });

  it('não repete o material na lista quando 2 SAs da mesma OS pedem o mesmo produto', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '047009' });
    const s2 = sa({ id: 'sa-2', produto_codigo: 'P1', ordem_id: '047009' });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [
      { ...s1, qtd_atende: 1, parcial: false },
      { ...s2, qtd_atende: 1, parcial: false },
    ])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1, s2], comSA, normalizar);
    expect(resultado).toEqual([{ numeroOs: '047009', materiais: ['Rolamento 6205'] }]);
  });

  it('normaliza o numero_os (padStart 6 dígitos) igual ao resto do sistema', () => {
    const s1 = sa({ id: 'sa-1', produto_codigo: 'P1', ordem_id: '47009' });
    const comSA = [comSAItem('P1', 'Rolamento 6205', [{ ...s1, qtd_atende: 1, parcial: false }])];
    const resultado = ordensComMaterialTotalmenteDisponivel([s1], comSA, normalizar);
    expect(resultado[0].numeroOs).toBe('047009');
  });
});
