import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  ConsultaSigmaResultado, CreateManutencaoOrdemRequest, EditarManutencaoOrdemRequest, EquipeApoioItem, ManutencaoArea,
  ManutencaoOrdem, ManutencaoTipo, OperadorEscalaApoio, SigmaBacklogItem,
} from '../models/manutencao-programacao.model';

interface ManutencaoOrdemRow {
  id: string;
  tipo: string;
  area: string;
  semana_inicio: string;
  numero_os: string | null;
  sem_os: boolean;
  descricao: string;
  equipamento: string | null;
  recursos: string | null;
  loto: string | null;
  area_atuacao: string | null;
  duracao_horas: number | null;
  tipo_servico: string | null;
  tecnico_nome: string;
  tecnico_matricula: string | null;
  dias_previstos: string[] | null;
  status: string;
  observacoes: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
}

const AREA_LABEL_LOG: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

function mapRow(r: ManutencaoOrdemRow): ManutencaoOrdem {
  return {
    id: r.id,
    tipo: (r.tipo as ManutencaoTipo) || 'ordem',
    area: r.area as ManutencaoArea,
    semanaInicio: r.semana_inicio,
    numeroOs: r.numero_os,
    semOs: r.sem_os,
    descricao: r.descricao,
    equipamento: r.equipamento,
    recursos: r.recursos,
    loto: r.loto,
    areaAtuacao: r.area_atuacao,
    duracaoHoras: r.duracao_horas !== null ? Number(r.duracao_horas) : null,
    tipoServico: r.tipo_servico,
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

  // Cadastro de empresas/equipes do Apoio e da escala de turno — no banco (editável
  // por Admin), diferente do catálogo de equipamentos acima (que continua estático).
  private _equipesApoio = signal<EquipeApoioItem[]>([]);
  equipesApoio = this._equipesApoio.asReadonly();
  private _escalaApoio = signal<OperadorEscalaApoio[]>([]);
  escalaApoio = this._escalaApoio.asReadonly();

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
      tipo: req.tipo ?? 'ordem',
      area: req.area,
      semana_inicio: req.semanaInicio,
      numero_os: req.semOs ? null : (req.numeroOs?.trim() || null),
      sem_os: req.semOs ?? false,
      descricao: req.descricao.trim(),
      equipamento: req.equipamento?.trim() || null,
      recursos: req.recursos?.trim() || null,
      loto: req.loto?.trim() || null,
      area_atuacao: req.areaAtuacao?.trim() || null,
      duracao_horas: req.duracaoHoras ?? null,
      tipo_servico: req.tipoServico?.trim() || null,
      tecnico_nome: req.tecnicoNome,
      tecnico_matricula: req.tecnicoMatricula || null,
      dias_previstos: req.diasPrevistos,
      // Status do SIGMA só faz sentido pra OS de verdade — folga/treinamento não tem.
      status: (req.tipo ?? 'ordem') === 'ordem' ? (req.status?.trim() || 'PEND') : '',
      observacoes: req.observacoes?.trim() || null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    };

    const { error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload);
    if (error) throw new Error(error.message);

    const acaoLabel = req.tipo === 'folga' ? 'lançou folga'
      : req.tipo === 'treinamento' ? 'lançou treinamento'
      : req.tipo === 'exame_medico' ? 'lançou exame médico'
      : 'adicionou OS';
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_criada',
      resource_type: 'manutencao_programacao',
      description: `${user.name} ${acaoLabel} na programação de ${AREA_LABEL_LOG[req.area]}: ${req.descricao} (${req.tecnicoNome})`,
      metadata: { tipo: req.tipo ?? 'ordem', area: req.area, semana_inicio: req.semanaInicio, tecnico: req.tecnicoNome },
    });

    await this.load();
  }

  // Lança folga (ex.: feriado) pra vários técnicos de uma vez, num único insert —
  // evita N chamadas de criarOrdem() (cada uma recarregando a lista inteira) quando o
  // dia vale pra toda a equipe, não só uma pessoa.
  async criarFolgaEmLote(params: {
    diasPrevistos: string[];
    motivo: string;
    tecnicos: { nome: string; matricula: string | null; area: ManutencaoArea }[];
  }): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (params.tecnicos.length === 0) throw new Error('Nenhum técnico encontrado.');

    const semanaInicio = this.semanaDoDia(params.diasPrevistos[0]);
    const descricao = params.motivo.trim() || 'Feriado';

    const payload = params.tecnicos.map(t => ({
      tipo: 'folga',
      area: t.area,
      semana_inicio: semanaInicio,
      numero_os: null,
      sem_os: false,
      descricao,
      equipamento: null,
      recursos: null,
      loto: null,
      area_atuacao: null,
      duracao_horas: null,
      tecnico_nome: t.nome,
      tecnico_matricula: t.matricula,
      dias_previstos: params.diasPrevistos,
      status: '',
      observacoes: null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    }));

    const { error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_criada',
      resource_type: 'manutencao_programacao',
      description: `${user.name} lançou "${descricao}" pra ${params.tecnicos.length} técnicos, em ${params.diasPrevistos.join(', ')}`,
      metadata: { tipo: 'folga', dias: params.diasPrevistos, tecnicos: params.tecnicos.length },
    });

    await this.load();
  }

  // Segunda-feira da semana de uma data 'YYYY-MM-DD' — o backend guarda tudo por
  // semana_inicio, então precisa disso mesmo recebendo datas já dentro da semana certa.
  private semanaDoDia(dataIso: string): string {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async editarOrdem(id: string, updates: EditarManutencaoOrdemRequest): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('manutencao_programacao')
      .update({
        tipo: updates.tipo,
        area: updates.area,
        numero_os: updates.semOs ? null : (updates.numeroOs?.trim() || null),
        sem_os: updates.semOs,
        descricao: updates.descricao.trim(),
        equipamento: updates.equipamento?.trim() || null,
        recursos: updates.recursos?.trim() || null,
        loto: updates.loto?.trim() || null,
        area_atuacao: updates.areaAtuacao?.trim() || null,
        duracao_horas: updates.duracaoHoras,
        tipo_servico: updates.tipoServico?.trim() || null,
        tecnico_nome: updates.tecnicoNome,
        tecnico_matricula: updates.tecnicoMatricula || null,
        dias_previstos: updates.diasPrevistos,
        status: updates.tipo === 'ordem' ? (updates.status.trim() || 'PEND') : '',
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
      description: `${user.name} editou "${updates.descricao}" da programação (${updates.tecnicoNome})`,
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

  // Backlog do SIGMA: OS abertas de uma área, ainda não lançadas na nossa programação —
  // ajuda a montar a semana a partir do que já existe no ERP. `atualizadoEm` reflete
  // quando o proxy buscou os dados do SIGMA por último (cache de até 10min lá) — não é
  // tempo real, então a tela mostra esse horário pra deixar isso visível.
  async consultarBacklogSigma(area: ManutencaoArea): Promise<{ itens: SigmaBacklogItem[]; atualizadoEm: number }> {
    const token = await this.authService.getValidAccessToken();
    const resp = await fetch(`/api/sigma-ordens-proxy?backlog_area=${area}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.success) {
      throw new Error(body?.error || 'Falha ao consultar o backlog do SIGMA.');
    }
    return { itens: body.backlog as SigmaBacklogItem[], atualizadoEm: body.atualizadoEm as number };
  }

  // ── Cadastro de Apoio (equipes/empresas + escala de turno) ──────────────────

  async loadApoioCadastros(): Promise<void> {
    const [equipesRes, escalaRes] = await Promise.all([
      this.supabaseService.client.from('manutencao_apoio_equipes').select('id, nome').order('nome'),
      this.supabaseService.client.from('manutencao_apoio_escala').select('id, nome, equipe').order('equipe').order('nome'),
    ]);
    if (equipesRes.error) throw new Error(equipesRes.error.message);
    if (escalaRes.error) throw new Error(escalaRes.error.message);
    this._equipesApoio.set(equipesRes.data ?? []);
    this._escalaApoio.set((escalaRes.data ?? []) as OperadorEscalaApoio[]);
  }

  async criarEquipeApoio(nome: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const nomeLimpo = nome.trim().toUpperCase();
    if (!nomeLimpo) throw new Error('Informe o nome da equipe/empresa.');

    const { error } = await this.supabaseService.client
      .from('manutencao_apoio_equipes')
      .insert({ nome: nomeLimpo, criado_por_id: user.id, criado_por_nome: user.name });
    if (error) throw new Error(error.code === '23505' ? 'Essa equipe/empresa já está cadastrada.' : error.message);
    await this.loadApoioCadastros();
  }

  async excluirEquipeApoio(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_equipes')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    await this.loadApoioCadastros();
  }

  async criarOperadorEscala(nome: string, equipe: 'A' | 'B' | 'C' | 'D'): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) throw new Error('Informe o nome do operador.');

    const { error } = await this.supabaseService.client
      .from('manutencao_apoio_escala')
      .insert({ nome: nomeLimpo, equipe, criado_por_id: user.id, criado_por_nome: user.name });
    if (error) throw new Error(error.message);
    await this.loadApoioCadastros();
  }

  async excluirOperadorEscala(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_escala')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    await this.loadApoioCadastros();
  }
}
