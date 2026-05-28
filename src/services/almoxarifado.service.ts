import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface Movimentacao {
  id: string;
  produto_codigo: string;
  produto_desc: string | null;
  unidade: string | null;
  grupo: string | null;
  custo_medio: number;
  saldo_qtd: number;
  data_operacao: string | null;
  documento_num: string | null;
  qtd_entrada: number;
  qtd_saida: number;
  referencia: string | null;
}

export interface Solicitacao {
  id: string;
  sa_numero: string;
  produto_codigo: string;
  qtd_solicitada: number;
  qtd_atendida: number;
  ordem_produto: string | null;
  ordem_id: string | null;
  recebedor: string | null;
  status: string;
}

export interface MaterialAgrupado {
  produto_codigo: string;
  produto_desc: string;
  unidade: string;
  grupo: string;
  custo_medio: number;
  saldo_qtd: number;          // último saldo_qtd do material (igual ao Python)
  qtd_entrada_total: number;
  qtd_saida_total: number;
  valor_total: number;        // qtd_entrada_total × custo_medio
  ultima_movimentacao: string | null;
}

export interface SAComAlocacao extends Solicitacao {
  qtd_atende: number;
  parcial: boolean;
}

export interface MaterialComSAs {
  material: MaterialAgrupado;
  sas: SAComAlocacao[];
  hasSAs: boolean;
}

export interface UltimaImportacao {
  tipo: string;
  nome_arquivo: string;
  total_registros: number;
  importado_em: string;
  importado_por_nome?: string;
}

@Injectable({ providedIn: 'root' })
export class AlmoxarifadoService {
  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService
  ) {}

  async getMovimentacoes(): Promise<Movimentacao[]> {
    const { data, error } = await this.supabaseService.client
      .from('almox_movimentacoes')
      .select('*')
      .order('data_operacao', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Movimentacao[];
  }

  async getSolicitacoes(): Promise<Solicitacao[]> {
    const { data, error } = await this.supabaseService.client
      .from('almox_solicitacoes')
      .select('*')
      .eq('status', 'aberta')   // apenas abertas — exclui 'encerrada' e 'atendida'
      .order('sa_numero');
    if (error) throw new Error(error.message);
    return (data ?? []) as Solicitacao[];
  }

  async getUltimaImportacao(tipo: string): Promise<UltimaImportacao | null> {
    const { data } = await this.supabaseService.client
      .from('almox_importacoes')
      .select('tipo, nome_arquivo, total_registros, importado_em, profiles:importado_por(name)')
      .eq('tipo', tipo)
      .order('importado_em', { ascending: false })
      .limit(1)
      .single();

    if (!data) return null;
    const d = data as Record<string, unknown>;
    return {
      tipo: d['tipo'] as string,
      nome_arquivo: d['nome_arquivo'] as string,
      total_registros: d['total_registros'] as number,
      importado_em: d['importado_em'] as string,
      importado_por_nome: (d['profiles'] as { name?: string } | null)?.name ?? '—',
    };
  }

  async getUltimasImportacoes(): Promise<UltimaImportacao[]> {
    const { data } = await this.supabaseService.client
      .from('almox_importacoes')
      .select('tipo, nome_arquivo, total_registros, importado_em, profiles:importado_por(name)')
      .order('importado_em', { ascending: false })
      .limit(10);

    return (data ?? []).map((d: Record<string, unknown>) => ({
      tipo: d['tipo'] as string,
      nome_arquivo: d['nome_arquivo'] as string,
      total_registros: d['total_registros'] as number,
      importado_em: d['importado_em'] as string,
      importado_por_nome: (d['profiles'] as { name?: string } | null)?.name ?? '—',
    }));
  }

  // ── Agregação e algoritmo FIFO ──────────────────────────────────────────

  agruparMovimentacoes(movs: Movimentacao[]): MaterialAgrupado[] {
    const map = new Map<string, MaterialAgrupado>();

    // O arquivo é percorrido em ordem — o Python faz o mesmo:
    // m["custo_medio"] = row[5] or 0  → sempre sobrescreve (último valor vence)
    // m["saldo_qtd"]   = row[6]       → idem
    for (const m of movs) {
      const key = m.produto_codigo;
      if (!map.has(key)) {
        map.set(key, {
          produto_codigo:      m.produto_codigo,
          produto_desc:        m.produto_desc ?? '—',
          unidade:             m.unidade ?? '',
          grupo:               m.grupo ?? '',
          custo_medio:         m.custo_medio ?? 0,
          saldo_qtd:           m.saldo_qtd ?? 0,
          qtd_entrada_total:   0,
          qtd_saida_total:     0,
          valor_total:         0,
          ultima_movimentacao: null,
        });
      }

      const ag = map.get(key)!;
      ag.qtd_entrada_total += m.qtd_entrada ?? 0;
      ag.qtd_saida_total   += m.qtd_saida ?? 0;

      // Sempre sobrescreve custo_medio e saldo_qtd — igual ao Python (último vence)
      ag.custo_medio = m.custo_medio ?? ag.custo_medio;
      ag.saldo_qtd   = m.saldo_qtd   ?? ag.saldo_qtd;

      // Última data de movimentação = máxima entre todas as linhas do material
      if (m.data_operacao && (!ag.ultima_movimentacao || m.data_operacao > ag.ultima_movimentacao)) {
        ag.ultima_movimentacao = m.data_operacao;
      }
    }

    for (const ag of map.values()) {
      // valor_total = qtd_entrada_total × custo_medio (igual ao Python)
      ag.valor_total = ag.qtd_entrada_total * ag.custo_medio;
    }

    return Array.from(map.values());
  }

  calcularAguardandoRetirada(movs: Movimentacao[], sas: Solicitacao[]): { comSA: MaterialComSAs[]; semSA: MaterialComSAs[] } {
    const agrupados = this.agruparMovimentacoes(movs)
      .filter(m => m.qtd_entrada_total > 0 && m.qtd_saida_total === 0);

    const comSA: MaterialComSAs[] = [];
    const semSA: MaterialComSAs[] = [];

    for (const material of agrupados) {
      const matSAs = sas
        .filter(sa => sa.produto_codigo === material.produto_codigo)
        .sort((a, b) => a.sa_numero.localeCompare(b.sa_numero)); // FIFO: SA mais antiga primeiro

      if (matSAs.length === 0) {
        semSA.push({ material, sas: [], hasSAs: false });
        continue;
      }

      // Algoritmo FIFO — réplica exata do Python (filtrar_sas_por_estoque)
      let disponivel = material.qtd_entrada_total;
      let acumulado = 0;
      const alocadas: SAComAlocacao[] = [];

      for (const sa of matSAs) {
        if (acumulado >= disponivel) break;
        const restante = disponivel - acumulado;
        const atende = Math.min(sa.qtd_solicitada, restante);
        alocadas.push({ ...sa, qtd_atende: atende, parcial: atende < sa.qtd_solicitada });
        acumulado += sa.qtd_solicitada; // acumula qtd_solicitada (não qtd_atende)
      }

      // Fallback Python: se nenhuma SA coube, inclui a mais antiga com alocação parcial
      if (alocadas.length === 0 && matSAs.length > 0) {
        const primeira = matSAs[0];
        alocadas.push({
          ...primeira,
          qtd_atende: Math.min(primeira.qtd_solicitada, disponivel),
          parcial: true,
        });
      }

      comSA.push({ material, sas: alocadas, hasSAs: true });
    }

    return { comSA, semSA };
  }

  filtrarEntradasPorPeriodo(movs: Movimentacao[], dias: number): Movimentacao[] {
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    desde.setHours(0, 0, 0, 0);
    const ref = desde.toISOString().split('T')[0];
    return movs.filter(m => m.qtd_entrada > 0 && m.data_operacao && m.data_operacao >= ref);
  }

  // ── Upload ──────────────────────────────────────────────────────────────

  async importarArquivo(tipo: 'movimentacoes' | 'solicitacoes' | 'status_sas', file: File): Promise<{ inseridos?: number; encerradas?: number }> {
    const token = await this.authService.getValidAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    const base64 = await this.fileToBase64(file);

    const response = await fetch('/api/import-almox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tipo, fileData: base64, fileName: file.name }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Erro ao importar arquivo.');
    return result;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const result = e.target?.result as string;
        resolve(result.split(',')[1]); // remove "data:...;base64,"
      };
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });
  }
}
