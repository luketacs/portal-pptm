import { fetchAllRows } from '../utils/supabase-pagination';
import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { CategoriaIndicador, ImportarIndicadorHistoricoItem, IndicadorHistoricoSemana } from '../models/manutencao-programacao.model';

interface IndicadorHistoricoRow {
  id: string;
  semana_inicio: string;
  categoria: string;
  programadas: number;
  executadas: number;
  nao_executadas: number;
  planejadas_plano: number;
  executadas_plano: number;
  nao_executadas_plano: number;
  atendimento: number;
  cumprimento: number;
  importado_por_id: string | null;
  importado_por_nome: string;
  importado_em: string;
}

function mapRow(r: IndicadorHistoricoRow): IndicadorHistoricoSemana {
  return {
    id: r.id,
    semanaInicio: r.semana_inicio,
    categoria: r.categoria as CategoriaIndicador | 'GERAL',
    programadas: Number(r.programadas),
    executadas: Number(r.executadas),
    naoExecutadas: Number(r.nao_executadas),
    planejadasPlano: Number(r.planejadas_plano),
    executadasPlano: Number(r.executadas_plano),
    naoExecutadasPlano: Number(r.nao_executadas_plano),
    atendimento: Number(r.atendimento),
    cumprimento: Number(r.cumprimento),
    importadoPorId: r.importado_por_id,
    importadoPorNome: r.importado_por_nome,
    importadoEm: new Date(r.importado_em),
  };
}

// Histórico de indicadores semanais de ANTES da Programação nativa existir (antes da
// S37/2026) — importado uma vez da planilha "Painel de Indicadores de PCM" (ver
// ManutencaoIndicadoresSemanaisComponent, botão "Importar histórico"), fica gravado
// pra sempre alimentar a Evolução ao Longo do Ano/Consolidado do Ano junto com as
// semanas calculadas ao vivo (que usam manutencao_programacao + SIGMA, não esta tabela).
@Injectable({ providedIn: 'root' })
export class ManutencaoIndicadoresHistoricoService {
  private _itens = signal<IndicadorHistoricoSemana[]>([]);
  itens = this._itens.asReadonly();
  isLoading = signal(false);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  async load(force = false): Promise<void> {
    if (!force && this._itens().length > 0) return;
    this.isLoading.set(true);
    try {
      const { data, error } = await fetchAllRows((from, to) => this.supabaseService.client
        .from('manutencao_indicadores_historico')
        .select('*')
        .order('semana_inicio').order('id').range(from, to));
      if (error) throw new Error(error.message);
      this._itens.set((data ?? []).map(mapRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  // Upsert em lote — reimportar a mesma planilha atualiza em vez de duplicar (ON
  // CONFLICT em semana_inicio+categoria, a UNIQUE da migration 044).
  async importarLote(itens: ImportarIndicadorHistoricoItem[]): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error('Só Admin pode importar histórico de indicadores.');
    if (itens.length === 0) return;

    const agora = new Date().toISOString();
    const { error } = await this.supabaseService.client
      .from('manutencao_indicadores_historico')
      .upsert(
        itens.map(item => ({
          semana_inicio: item.semanaInicio,
          categoria: item.categoria,
          programadas: item.programadas,
          executadas: item.executadas,
          nao_executadas: item.naoExecutadas,
          planejadas_plano: item.planejadasPlano,
          executadas_plano: item.executadasPlano,
          nao_executadas_plano: item.naoExecutadasPlano,
          atendimento: item.atendimento,
          cumprimento: item.cumprimento,
          importado_por_id: user.id,
          importado_por_nome: user.name,
          importado_em: agora,
        })),
        { onConflict: 'semana_inicio,categoria' },
      );
    if (error) throw new Error(error.message);

    this._itens.set([]); // força reload — load() só busca se estiver vazio
    await this.load();
  }
}
