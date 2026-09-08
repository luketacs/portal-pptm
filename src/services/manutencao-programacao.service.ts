import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  ConsultaSigmaResultado, CreateManutencaoOrdemRequest, EditarManutencaoOrdemRequest, EquipeApoioItem, FeriasTecnico,
  ManutencaoArea, ManutencaoOrdem, ManutencaoTipo, OperadorEscalaApoio, ParadaPlanta, PeriodicidadeUnidade,
  PlanoPreventivo, RecursoEspecialItem, SigmaBacklogItem,
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
  reuniao_horario: string | null;
  reuniao_local: string | null;
  plano_preventivo_id: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
}

interface PlanoPreventivoRow {
  id: string;
  bem: string;
  nome_bem: string;
  servico: string;
  nome_servico: string;
  sequencia: string;
  nome_manut: string;
  area: string;
  tecnico_apoio: string | null;
  periodicidade_valor: number;
  periodicidade_unidade: string;
  ultima_execucao: string | null;
  ativo: boolean;
}

function mapPlanoPreventivoRow(r: PlanoPreventivoRow): PlanoPreventivo {
  return {
    id: r.id,
    bem: r.bem,
    nomeBem: r.nome_bem,
    servico: r.servico,
    nomeServico: r.nome_servico,
    sequencia: r.sequencia,
    nomeManut: r.nome_manut,
    area: r.area as ManutencaoArea,
    tecnicoApoio: r.tecnico_apoio,
    periodicidadeValor: Number(r.periodicidade_valor),
    periodicidadeUnidade: r.periodicidade_unidade as PeriodicidadeUnidade,
    ultimaExecucao: r.ultima_execucao,
    ativo: r.ativo,
  };
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
    reuniaoHorario: r.reuniao_horario,
    reuniaoLocal: r.reuniao_local,
    planoPreventivoId: r.plano_preventivo_id,
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

  // Períodos de férias por técnico (Elétrica/Mecânica) — usado pra avisar/bloquear
  // lançamento de atividade dentro do período.
  private _ferias = signal<FeriasTecnico[]>([]);
  ferias = this._ferias.asReadonly();

  // Recursos especiais (Munck/Guindaste/Andaime/Fontebras...) que espelham
  // automaticamente uma OS pro Apoio — no banco (editável por Admin), evita precisar
  // de deploy pra cadastrar uma empresa/pessoa nova.
  private _recursosEspeciais = signal<RecursoEspecialItem[]>([]);
  recursosEspeciais = this._recursosEspeciais.asReadonly();

  // Plano mestre de manutenção preventiva (cadastro nativo, ver migration 028) —
  // alimenta o painel "Preventivas da semana" na Programação.
  private _planosPreventivos = signal<PlanoPreventivo[]>([]);
  planosPreventivos = this._planosPreventivos.asReadonly();

  // Parada da planta (Admin-only, ver migration 029) — enquanto ativa, planos
  // preventivos de ciclo curto são calculados como mensais. `null` = operando normal.
  private _paradaAtual = signal<ParadaPlanta | null>(null);
  paradaAtual = this._paradaAtual.asReadonly();

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
      reuniao_horario: req.reuniaoHorario?.trim() || null,
      reuniao_local: req.reuniaoLocal?.trim() || null,
      plano_preventivo_id: req.planoPreventivoId ?? null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    };

    const { error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload);
    if (error) throw new Error(error.message);

    const acaoLabel = req.tipo === 'folga' ? 'lançou folga'
      : req.tipo === 'treinamento' ? 'lançou treinamento'
      : req.tipo === 'exame_medico' ? 'lançou exame médico'
      : req.tipo === 'reuniao' ? 'lançou reunião'
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

  // Reunião pra toda a equipe (Elétrica + Mecânica) num único insert, igual folga em
  // lote — mas não bloqueia o resto da agenda do dia (só ocupa um horário, não o dia
  // inteiro), então fica com tipo próprio em vez de reaproveitar 'folga'.
  async criarReuniaoEmLote(params: {
    diasPrevistos: string[];
    titulo: string;
    horario: string;
    local: string;
    tecnicos: { nome: string; matricula: string | null; area: ManutencaoArea }[];
  }): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (params.tecnicos.length === 0) throw new Error('Nenhum técnico encontrado.');

    const semanaInicio = this.semanaDoDia(params.diasPrevistos[0]);
    const descricao = params.titulo.trim() || 'Reunião';
    const horario = params.horario.trim() || null;
    const local = params.local.trim() || null;

    const payload = params.tecnicos.map(t => ({
      tipo: 'reuniao',
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
      reuniao_horario: horario,
      reuniao_local: local,
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
      description: `${user.name} lançou reunião "${descricao}" pra ${params.tecnicos.length} técnicos, em ${params.diasPrevistos.join(', ')}`,
      metadata: { tipo: 'reuniao', dias: params.diasPrevistos, tecnicos: params.tecnicos.length, horario, local },
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
        reuniao_horario: updates.reuniaoHorario?.trim() || null,
        reuniao_local: updates.reuniaoLocal?.trim() || null,
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

  // ── Cadastro de recursos especiais (Munck/Guindaste/Andaime/Fontebras...) ───

  async loadRecursosEspeciais(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .select('id, opcao, empresa_apoio')
      .order('opcao');
    if (error) throw new Error(error.message);
    this._recursosEspeciais.set((data ?? []).map(r => ({ id: r.id, opcao: r.opcao, empresaApoio: r.empresa_apoio })));
  }

  async criarRecursoEspecial(opcao: string, empresaApoio: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const opcaoLimpa = opcao.trim().toUpperCase();
    const empresaLimpa = empresaApoio.trim().toUpperCase();
    if (!opcaoLimpa) throw new Error('Informe o rótulo do recurso.');
    if (!empresaLimpa) throw new Error('Informe pra quem esse recurso espelha no Apoio.');

    const { error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .insert({ opcao: opcaoLimpa, empresa_apoio: empresaLimpa, criado_por_id: user.id, criado_por_nome: user.name });
    if (error) throw new Error(error.code === '23505' ? 'Esse recurso já está cadastrado.' : error.message);
    await this.loadRecursosEspeciais();
  }

  async excluirRecursoEspecial(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    await this.loadRecursosEspeciais();
  }

  // ── Planos de manutenção preventiva (cadastro nativo) ────────────────────────

  async loadPlanosPreventivos(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos_preventivos')
      .select('*')
      .eq('ativo', true)
      .order('nome_bem');
    if (error) throw new Error(error.message);
    this._planosPreventivos.set((data ?? []).map(mapPlanoPreventivoRow));
  }

  // Avança a "última execução" do plano — chamada assim que a preventiva é programada
  // pra alguém na Programação (não espera confirmação de apontamento no SIGMA, ver
  // criarOrdem/plano_preventivo_id).
  async avancarPreventiva(id: string, dataExecucaoIso: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('manutencao_planos_preventivos')
      .update({ ultima_execucao: dataExecucaoIso, atualizado_em: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.loadPlanosPreventivos();
  }

  // ── Parada da planta (Admin-only) ────────────────────────────────────────────

  async loadParadaAtual(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_parada_planta')
      .select('id, data_inicio, data_fim')
      .is('data_fim', null)
      .order('data_inicio', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    this._paradaAtual.set(row ? { id: row.id, dataInicio: row.data_inicio, dataFim: row.data_fim } : null);
  }

  async iniciarParadaPlanta(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const { error } = await this.supabaseService.client
      .from('manutencao_parada_planta')
      .insert({ data_inicio: new Date().toISOString().slice(0, 10), criado_por_id: user.id, criado_por_nome: user.name });
    if (error) throw new Error(error.message);
    await this.loadParadaAtual();
  }

  async encerrarParadaPlanta(): Promise<void> {
    const atual = this._paradaAtual();
    if (!atual) return;
    const { error } = await this.supabaseService.client
      .from('manutencao_parada_planta')
      .update({ data_fim: new Date().toISOString().slice(0, 10) })
      .eq('id', atual.id);
    if (error) throw new Error(error.message);
    await this.loadParadaAtual();
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

  // ── Férias ────────────────────────────────────────────────────────────────

  async loadFerias(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_ferias')
      .select('id, tecnico_nome, tecnico_matricula, area, data_inicio, data_fim')
      .order('data_inicio');
    if (error) throw new Error(error.message);
    this._ferias.set((data ?? []).map(r => ({
      id: r.id,
      tecnicoNome: r.tecnico_nome,
      tecnicoMatricula: r.tecnico_matricula,
      area: r.area as ManutencaoArea,
      dataInicio: r.data_inicio,
      dataFim: r.data_fim,
    })));
  }

  async criarFerias(params: {
    tecnicoNome: string; tecnicoMatricula: string | null; area: ManutencaoArea; dataInicio: string; dataFim: string;
  }): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (!params.tecnicoNome.trim()) throw new Error('Selecione o técnico.');
    if (!params.dataInicio || !params.dataFim) throw new Error('Informe início e fim das férias.');
    if (params.dataFim < params.dataInicio) throw new Error('A data final não pode ser antes da inicial.');

    const { error } = await this.supabaseService.client.from('manutencao_ferias').insert({
      tecnico_nome: params.tecnicoNome,
      tecnico_matricula: params.tecnicoMatricula,
      area: params.area,
      data_inicio: params.dataInicio,
      data_fim: params.dataFim,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    });
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_ferias_criada',
      resource_type: 'manutencao_ferias',
      description: `${user.name} cadastrou férias de ${params.tecnicoNome} (${params.dataInicio} a ${params.dataFim})`,
    });

    await this.loadFerias();
  }

  async excluirFerias(id: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const item = this._ferias().find(f => f.id === id);
    const { data, error } = await this.supabaseService.client
      .from('manutencao_ferias')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_ferias_excluida',
      resource_type: 'manutencao_ferias',
      resource_id: id,
      description: `${user.name} excluiu férias de ${item?.tecnicoNome ?? ''}`,
    });

    await this.loadFerias();
  }
}
