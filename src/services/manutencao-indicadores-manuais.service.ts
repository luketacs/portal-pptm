import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { ChaveIndicadorManual, IndicadorManual } from '../models/manutencao-programacao.model';

interface IndicadorManualRow {
  id: string;
  ano: number;
  chave: string;
  valor: number;
  atualizado_por_id: string | null;
  atualizado_por_nome: string;
  atualizado_em: string;
}

function mapRow(r: IndicadorManualRow): IndicadorManual {
  return {
    id: r.id,
    ano: r.ano,
    chave: r.chave as ChaveIndicadorManual,
    valor: Number(r.valor),
    atualizadoPorId: r.atualizado_por_id,
    atualizadoPorNome: r.atualizado_por_nome,
    atualizadoEm: new Date(r.atualizado_em),
  };
}

// Indicadores anuais que não dão pra calcular a partir de manutencao_programacao (ex.:
// Disponibilidade Global Anual, Dias/Navio) — digitados à mão, um valor por ano/chave,
// ver migration 049. Só alimentam o índice de atingimento de meta no Consolidado do Ano
// da tela Acompanhamento de Indicadores Semanais.
@Injectable({ providedIn: 'root' })
export class ManutencaoIndicadoresManuaisService {
  private _itens = signal<IndicadorManual[]>([]);
  itens = this._itens.asReadonly();
  isLoading = signal(false);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabaseService.client
        .from('manutencao_indicadores_manuais')
        .select('*');
      if (error) throw new Error(error.message);
      this._itens.set((data ?? []).map(mapRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  valorDoAno(ano: number, chave: ChaveIndicadorManual): number | null {
    return this._itens().find(i => i.ano === ano && i.chave === chave)?.valor ?? null;
  }

  async salvar(ano: number, chave: ChaveIndicadorManual, valor: number): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error('Só Admin pode editar indicadores manuais.');
    if (!Number.isFinite(valor)) throw new Error('Informe um valor numérico válido.');

    const { error } = await this.supabaseService.client
      .from('manutencao_indicadores_manuais')
      .upsert(
        {
          ano, chave, valor,
          atualizado_por_id: user.id,
          atualizado_por_nome: user.name,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'ano,chave' },
      );
    if (error) throw new Error(error.message);

    await this.load();
  }
}
