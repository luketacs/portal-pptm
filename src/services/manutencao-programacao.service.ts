import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  ConsultaSigmaResultado, CreateManutencaoOrdemRequest, EditarManutencaoOrdemRequest, ManutencaoArea,
  ManutencaoOrdem,
} from '../models/manutencao-programacao.model';

interface ManutencaoOrdemRow {
  id: string;
  area: string;
  semana_inicio: string;
  numero_os: string | null;
  descricao: string;
  equipamento: string | null;
  recursos: string | null;
  loto: string | null;
  area_atuacao: string | null;
  duracao_horas: number | null;
  tecnico_nome: string;
  tecnico_matricula: string | null;
  dias_previstos: string[] | null;
  status: string;
  observacoes: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
}

function mapRow(r: ManutencaoOrdemRow): ManutencaoOrdem {
  return {
    id: r.id,
    area: r.area as ManutencaoArea,
    semanaInicio: r.semana_inicio,
    numeroOs: r.numero_os,
    descricao: r.descricao,
    equipamento: r.equipamento,
    recursos: r.recursos,
    loto: r.loto,
    areaAtuacao: r.area_atuacao,
    duracaoHoras: r.duracao_horas !== null ? Number(r.duracao_horas) : null,
    tecnicoNome: r.tecnico_nome,
    tecnicoMatricula: r.tecnico_matricula,
    diasPrevistos: r.dias_previstos ?? [],
    status: r.status,
    observacoes: r.observacoes,
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
  };
}

@Injectable({ providedIn: 'root' })
export class ManutencaoProgramacaoService {
  private _ordens = signal<ManutencaoOrdem[]>([]);
  ordens = this._ordens.asReadonly();
  isLoading = signal(false);

  // Catálogo fixo de equipamentos (public/equipamentos.json, mesmo padrão do
  // matriculas.json) — usado como sugestão no campo Equipamento e pra montar o
  // quadro de bloqueios (LOTO) por equipamento/dia.
  private _equipamentos = signal<string[]>([]);
  equipamentos = this._equipamentos.asReadonly();

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async loadEquipamentos(): Promise<void> {
    if (this._equipamentos().length > 0) return;
    try {
      const resp = await fetch('/equipamentos.json');
      const data = await resp.json();
      this._equipamentos.set(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[ManutencaoProgramacaoService] Falha ao carregar equipamentos.json:', err);
    }
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabaseService.client
        .from('manutencao_programacao')
        .select('*')
        .order('semana_inicio', { ascending: false });
      if (error) throw new Error(error.message);
      this._ordens.set((data ?? []).map(mapRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  getById(id: string): ManutencaoOrdem | undefined {
    return this._ordens().find(o => o.id === id);
  }

  async criarOrdem(req: CreateManutencaoOrdemRequest): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const payload = {
      area: req.area,
      semana_inicio: req.semanaInicio,
      numero_os: req.numeroOs?.trim() || null,
      descricao: req.descricao.trim(),
      equipamento: req.equipamento?.trim() || null,
      recursos: req.recursos?.trim() || null,
      loto: req.loto?.trim() || null,
      area_atuacao: req.areaAtuacao?.trim() || null,
      duracao_horas: req.duracaoHoras ?? null,
      tecnico_nome: req.tecnicoNome,
      tecnico_matricula: req.tecnicoMatricula || null,
      dias_previstos: req.diasPrevistos,
      status: req.status?.trim() || 'PEND',
      observacoes: req.observacoes?.trim() || null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    };

    const { error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_criada',
      resource_type: 'manutencao_programacao',
      description: `${user.name} adicionou OS na programação de ${req.area === 'ELETRICA' ? 'Elétrica' : 'Mecânica'}: ${req.descricao} (${req.tecnicoNome})`,
      metadata: { area: req.area, semana_inicio: req.semanaInicio, tecnico: req.tecnicoNome },
    });

    await this.load();
  }

  async editarOrdem(id: string, updates: EditarManutencaoOrdemRequest): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('manutencao_programacao')
      .update({
        area: updates.area,
        numero_os: updates.numeroOs?.trim() || null,
        descricao: updates.descricao.trim(),
        equipamento: updates.equipamento?.trim() || null,
        recursos: updates.recursos?.trim() || null,
        loto: updates.loto?.trim() || null,
        area_atuacao: updates.areaAtuacao?.trim() || null,
        duracao_horas: updates.duracaoHoras,
        tecnico_nome: updates.tecnicoNome,
        tecnico_matricula: updates.tecnicoMatricula || null,
        dias_previstos: updates.diasPrevistos,
        status: updates.status.trim() || 'PEND',
        observacoes: updates.observacoes?.trim() || null,
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_editada',
      resource_type: 'manutencao_programacao',
      resource_id: id,
      description: `${user.name} editou a OS "${updates.descricao}" da programação (${updates.tecnicoNome})`,
    });

    await this.load();
  }

  async excluir(id: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const item = this.getById(id);
    const { data, error } = await this.supabaseService.client
      .from('manutencao_programacao')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    // Sem a política de DELETE no banco, o RLS bloqueia a exclusão sem retornar erro —
    // 0 linhas afetadas é o único sinal de que nada foi realmente excluído.
    if (!data || data.length === 0) {
      throw new Error('Não foi possível excluir (permissão do banco). Verifique se a migration 020_manutencao_programacao.sql foi executada no Supabase.');
    }

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_excluida',
      resource_type: 'manutencao_programacao',
      resource_id: id,
      description: `${user.name} excluiu a OS "${item?.descricao ?? ''}" da programação (${item?.tecnicoNome ?? ''})`,
    });

    await this.load();
  }

  // Consulta as exportações do SIGMA (descrição da OS + apontamentos/execução) via
  // /api/sigma-ordens-proxy — usado tanto pra preencher a descrição sozinha quando a
  // pessoa digita o número da OS, quanto pra conferir se ela foi executada dentro da
  // semana programada. Aceita várias OS de uma vez (batch) pra não disparar uma
  // consulta por linha da tela.
  async consultarOrdensSigma(numerosOs: string[]): Promise<Record<string, ConsultaSigmaResultado>> {
    const numeros = [...new Set(numerosOs.map(n => n.trim()).filter(Boolean))];
    if (numeros.length === 0) return {};

    const token = await this.authService.getValidAccessToken();
    const resp = await fetch(`/api/sigma-ordens-proxy?numeros_os=${encodeURIComponent(numeros.join(','))}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.success) {
      throw new Error(body?.error || 'Falha ao consultar o SIGMA.');
    }
    return body.data as Record<string, ConsultaSigmaResultado>;
  }
}
