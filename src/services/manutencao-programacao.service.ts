import { bloqueioDoTecnico, ordemDuplicada } from '../utils/manutencao-regras';
import { fetchAllRows } from '../utils/supabase-pagination';
import { Injectable, signal } from '@angular/core';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { avaliarGravacao, podeEditarSemanaFechada } from '../utils/manutencao-regras';
import { comLimiteDeTempo } from '../utils/retry';
import { cicloCoerenteComOrdem } from '../utils/manutencao-planos-saude';
import { removerDaLista, upsertNaLista } from '../utils/lista-local';
import {
  AtestadoTecnico, AtividadeChecklist, CategoriaIndicador, ConsultaSigmaResultado, CreateManutencaoOrdemRequest, EditarManutencaoOrdemRequest,
  EquipeApoioItem, FeriasTecnico, ManutencaoArea, ManutencaoOrdem, ManutencaoTipo, OperadorEscalaApoio, ParadaPlanta,
  RecursoEspecialItem, SigmaApontamentoPeriodo, SigmaBacklogItem,
  SigmaPreventivaPendente,
  OsApontadaPeriodo,
} from '../models/manutencao-programacao.model';

// Timeout do AbortSignal vira um erro genérico ("AbortError"/"signal is aborted") — troca
// por uma mensagem que diz o que fazer: a OS pode ter gravado sim, e tentar de novo é
// seguro (mesmo id, ver criarOrdem).
export function mensagemErroGravacao(error: { message: string; name?: string; code?: string }): string {
  const msg = error.message ?? '';
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || /abort|timeout|timed out|Failed to fetch|NetworkError/i.test(msg)) {
    return 'O servidor não respondeu a tempo. Confira a lista — se a OS não aparecer, clique em Adicionar de novo (não duplica).';
  }
  // update/insert com .single() que não devolveu linha: o RLS barrou sem erro explícito
  // (sem permissão, ou semana fechada pra quem não é Admin). Antes a tela seguia como se
  // tivesse salvo.
  if (error.code === 'PGRST116') {
    return 'Não foi possível salvar: sem permissão pra alterar esse lançamento (ou a semana está fechada).';
  }
  return msg;
}

interface ManutencaoOrdemRow {
  id: string;
  tipo: string;
  area: string;
  categoria_indicador: string | null;
  semana_inicio: string;
  numero_os: string | null;
  sem_os: boolean;
  descricao: string;
  equipamento: string | null;
  equipamentos_relacionados: string | null;
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
  ciclo_data_prevista: string | null;
  checklist: AtividadeChecklist[] | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
  // Migration 076 — preenchido por trigger. Fica fora do mapRow (não entra na comparação
  // da lista local, ver avaliarAlteracao), só serve pra dizer quem alterou.
  atualizado_por_nome?: string | null;
}

// Alteração de outro usuário ainda não carregada na tela. semana '*' = não dá pra saber
// qual (a conexão caiu e voltou, eventos podem ter se perdido no meio). nome null =
// gravação sem usuário identificado (SQL Editor, ou migration 076 ainda não rodada).
export interface AlteracaoExterna {
  semana: string;
  nome: string | null;
  em: Date;
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
    categoriaIndicador: r.categoria_indicador as CategoriaIndicador | null,
    semanaInicio: r.semana_inicio,
    numeroOs: r.numero_os,
    semOs: r.sem_os,
    descricao: r.descricao,
    equipamento: r.equipamento,
    equipamentosRelacionados: r.equipamentos_relacionados,
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
    cicloDataPrevista: r.ciclo_data_prevista,
    checklist: r.checklist,
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
  };
}

// createdAt fica de fora: o mesmo timestamp pode vir formatado diferente pela API e pelo realtime.
function mesmoConteudo(a: ManutencaoOrdem, b: ManutencaoOrdem): boolean {
  return JSON.stringify({ ...a, createdAt: null }) === JSON.stringify({ ...b, createdAt: null });
}

// Comparadores que reproduzem o ORDER BY de cada load — a linha devolvida pela gravação
// entra na lista local na mesma posição em que o load a colocaria.
const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'pt-BR');
const compararCodigo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const porNome = (a: { nome: string }, b: { nome: string }): number => compararTexto(a.nome, b.nome);
const porPeriodo = (a: { dataInicio: string; id: string }, b: { dataInicio: string; id: string }): number =>
  compararCodigo(a.dataInicio, b.dataInicio) || compararCodigo(a.id, b.id);

// Férias e atestados têm o mesmo formato de linha.
const CAMPOS_PERIODO = 'id, tecnico_nome, tecnico_matricula, area, data_inicio, data_fim';
interface PeriodoTecnicoRow {
  id: string; tecnico_nome: string; tecnico_matricula: string | null; area: string; data_inicio: string; data_fim: string;
}
function mapPeriodoRow(r: PeriodoTecnicoRow): FeriasTecnico & AtestadoTecnico {
  return {
    id: r.id,
    tecnicoNome: r.tecnico_nome,
    tecnicoMatricula: r.tecnico_matricula,
    area: r.area as ManutencaoArea,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
  };
}

function mapRecursoEspecialRow(r: { id: string; opcao: string; empresa_apoio: string }): RecursoEspecialItem {
  return { id: r.id, opcao: r.opcao, empresaApoio: r.empresa_apoio };
}

// Queda de conexão (o pedido nem chegou/voltou), não recusa do banco.
function falhaDeRede(erro: { message: string }): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(erro.message);
}

@Injectable({ providedIn: 'root' })
export class ManutencaoProgramacaoService {
  private readonly TIMEOUT_GRAVACAO_MS = 20_000;
  // Limite da gravação INTEIRA (ver comLimiteDeTempo): cobre também a espera pela sessão/
  // renovação do token, que acontece antes do fetch e não tem limite no supabase-js.
  private readonly LIMITE_TOTAL_GRAVACAO_MS = 25_000;

  private _ordens = signal<ManutencaoOrdem[]>([]);
  ordens = this._ordens.asReadonly();
  isLoading = signal(false);

  // Alterações de outros usuários desde o último load() — a tela mostra o aviso
  // "tela desatualizada" quando alguma é da semana em exibição.
  private _alteracoesExternas = signal<readonly AlteracaoExterna[]>([]);
  alteracoesExternas = this._alteracoesExternas.asReadonly();
  private canalAlteracoes: RealtimeChannel | null = null;
  private carregadoEm: number | null = null;
  // Quando o canal ficou SUBSCRIBED; null = desligado/caído (ver loadSeNecessario).
  private inscritoEm: number | null = null;
  private readonly IDADE_MAXIMA_CARGA_MS = 30 * 60 * 1000;
  // Resultado do SIGMA por OS: o proxy já guarda o export por 3 min, então reconsultar
  // antes disso só repete a mesma resposta — e a tela reconsultava a cada troca de aba.
  private readonly CACHE_SIGMA_MS = 3 * 60 * 1000;
  private sigmaPorOs = new Map<string, { em: number; resultado: ConsultaSigmaResultado }>();
  private preventivasPendentesCache: { em: number; dados: Promise<SigmaPreventivaPendente[]> } | null = null;
  // Espera antes de comparar o evento com a lista local: o evento da própria gravação
  // pode chegar antes da resposta HTTP que atualiza a lista (incluirNaLista).
  private readonly ESPERA_COMPARACAO_MS = 2_000;

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
  private _atestados = signal<AtestadoTecnico[]>([]);
  atestados = this._atestados.asReadonly();

  // Recursos especiais (Munck/Guindaste/Andaime/Fontebras...) que espelham
  // automaticamente uma OS pro Apoio — no banco (editável por Admin), evita precisar
  // de deploy pra cadastrar uma empresa/pessoa nova.
  private _recursosEspeciais = signal<RecursoEspecialItem[]>([]);
  recursosEspeciais = this._recursosEspeciais.asReadonly();

  // Parada da planta (Admin-only, ver migration 029) — enquanto ativa, planos
  // preventivos de ciclo curto são calculados como mensais. `null` = operando normal.
  private _paradaAtual = signal<ParadaPlanta | null>(null);
  paradaAtual = this._paradaAtual.asReadonly();

  // Semanas fechadas (Admin-only, ver migration 031 e "Fechar programação da semana") —
  // enquanto uma semana está nesse mapa, só Admin consegue criar/editar/excluir
  // lançamento nela (garantirSemanaAberta, chamado no início de toda mutação de
  // manutencao_programacao). Chave = semana_inicio ('YYYY-MM-DD'); valor guarda quem/
  // quando fechou, pro banner da tela poder mostrar isso.
  private _semanasFechadas = signal<Map<string, { fechadoPorNome: string; fechadoEm: string }>>(new Map());
  semanasFechadas = this._semanasFechadas.asReadonly();

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
      const { data, error } = await fetchAllRows((from, to) => this.supabaseService.client
        .from('manutencao_programacao')
        .select('*')
        .order('semana_inicio', { ascending: false }).order('id').range(from, to));
      if (error) throw new Error(error.message);
      this._ordens.set((data ?? []).map(mapRow));
      this._alteracoesExternas.set([]);
      this.carregadoEm = Date.now();
    } finally {
      this.isLoading.set(false);
    }
  }

  // Trocar de aba (Elétrica/Mecânica/Apoio) recria a tela, e cada abertura relia as
  // ~1,4 mil OS. Com o canal de alterações ligado desde ANTES da última carga, a lista
  // em memória só fica velha se chegou alteração externa — aí sim relê. Sem canal (ou
  // canal que caiu), ou carga velha demais, relê como antes.
  async loadSeNecessario(): Promise<void> {
    const confiavel = this.carregadoEm !== null
      && this.inscritoEm !== null && this.inscritoEm <= this.carregadoEm
      && this._alteracoesExternas().length === 0
      && Date.now() - this.carregadoEm < this.IDADE_MAXIMA_CARGA_MS;
    if (!confiavel) await this.load();
  }

  // Avisa (sem recarregar sozinho — quem está no meio de um lançamento não perde nada)
  // quando outro usuário cria/edita/exclui algo em manutencao_programacao. Não existe
  // coluna de "quem alterou": o evento conta como externo quando não bate com a lista
  // local, já que toda gravação feita por esta tela atualiza a lista com a linha
  // devolvida pelo banco. Precisa da tabela na publicação supabase_realtime (migration 075);
  // quem alterou vem de atualizado_por_nome (migration 076). O DELETE do realtime só traz
  // o id, então quem exclui avisa o próprio nome por broadcast (ver excluir).
  iniciarMonitoramentoAlteracoes(): void {
    if (this.canalAlteracoes) return;
    let jaConectou = false;
    this.canalAlteracoes = this.supabaseService.client
      .channel('manutencao-programacao-alteracoes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manutencao_programacao' },
        (payload: RealtimePostgresChangesPayload<ManutencaoOrdemRow>) =>
          setTimeout(() => this.avaliarAlteracao(payload), this.ESPERA_COMPARACAO_MS))
      .on('broadcast', { event: 'exclusao' }, ({ payload }) => {
        const { semana, nome } = (payload ?? {}) as { semana?: string; nome?: string };
        if (semana) this.registrarAlteracoes([semana], nome ?? null);
      })
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') { this.inscritoEm = null; return; }
        this.inscritoEm = Date.now();
        // Reconexão (rede caiu, aba ficou suspensa): o que mudou nesse meio-tempo não
        // chega como evento — melhor avisar à toa do que deixar a tela velha calada.
        if (jaConectou) this.registrarAlteracoes(['*'], null);
        jaConectou = true;
      });
  }

  pararMonitoramentoAlteracoes(): void {
    if (!this.canalAlteracoes) return;
    void this.supabaseService.client.removeChannel(this.canalAlteracoes);
    this.canalAlteracoes = null;
    this.inscritoEm = null;
  }

  private avaliarAlteracao(payload: RealtimePostgresChangesPayload<ManutencaoOrdemRow>): void {
    if (this.isLoading()) return; // o load() em andamento já vai trazer a mudança
    if (payload.eventType === 'DELETE') {
      // Com RLS o DELETE só traz a PK. Já fora da lista = foi esta tela que excluiu.
      const local = this.getById((payload.old as Partial<ManutencaoOrdemRow>).id ?? '');
      // O nome de quem excluiu chega pelo broadcast; este aqui cobre exclusão feita
      // fora da tela (fica como "Outro usuário" se o broadcast não vier).
      if (local) this.registrarAlteracoes([local.semanaInicio], null);
      return;
    }
    const linha = payload.new as ManutencaoOrdemRow;
    const remota = mapRow(linha);
    const local = this.getById(remota.id);
    if (local && mesmoConteudo(local, remota)) return;
    this.registrarAlteracoes(local ? [remota.semanaInicio, local.semanaInicio] : [remota.semanaInicio], linha.atualizado_por_nome ?? null);
  }

  private registrarAlteracoes(semanas: string[], nome: string | null): void {
    const em = new Date();
    const novas = [...new Set(semanas)].map(semana => ({ semana, nome, em }));
    this._alteracoesExternas.update(atual => [...atual, ...novas]);
  }

  getById(id: string): ManutencaoOrdem | undefined {
    return this._ordens().find(o => o.id === id);
  }

  // `id` (opcional): gerado pela tela na 1ª tentativa e reaproveitado se a pessoa tentar
  // de novo (ver confirmarForm). Reportado: "às vezes trava, fica carregando, às vezes
  // grava duas vezes" — o insert chegava ao banco, a resposta demorava/perdia, a pessoa
  // clicava de novo e nascia uma OS duplicada. Com o mesmo id, a 2ª tentativa bate na
  // PK e é tratada como sucesso (a OS já existe), nunca duplica.
  async criarOrdem(req: CreateManutencaoOrdemRequest, id?: string): Promise<string> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    this.garantirSemanaAberta(req.semanaInicio);

    const payload = this.montarLinhaNova(req, user, id);

    // Timeout: sem ele, uma requisição que nunca responde deixava o botão girando pra
    // sempre. `select('*')` devolve a linha já com o que os triggers preencheram
    // (ciclo_data_prevista etc.), pra entrar direto na lista sem recarregar tudo.
    const { data, error } = await this.executarGravacao('criar', async () => {
      const inserida = await this.supabaseService.client
        .from('manutencao_programacao')
        .insert(payload)
        .select('*')
        .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS))
        .single();
      if (inserida.error && id && inserida.error.code === '23505' && inserida.error.message.includes('manutencao_programacao_pkey')) {
        // Já gravada numa tentativa anterior — busca a linha e segue como sucesso.
        return await this.supabaseService.client
          .from('manutencao_programacao').select('*').eq('id', id)
          .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS)).single();
      }
      return inserida;
    });
    if (error) throw new Error(mensagemErroGravacao(error));

    this.logCriacao(req, user);
    // Entra direto na lista, em vez de recarregar o histórico inteiro de todas as
    // semanas a cada OS (e de novo pra cada espelho de apoio) — era isso que deixava o
    // "Adicionar" girando por muito tempo.
    const [ordem] = this.incluirNaLista([data as ManutencaoOrdemRow]);
    return ordem.id;
  }

  // Várias OS numa requisição só — usado pros espelhos de apoio (ajudantes/empresas em
  // "Recursos"). Antes era um criarOrdem por pessoa, em sequência, cada um atualizando a
  // tela: com 2+ pessoas o formulário "carregava duas vezes". Tudo ou nada.
  async criarOrdensEmLote(reqs: CreateManutencaoOrdemRequest[]): Promise<ManutencaoOrdem[]> {
    if (reqs.length === 0) return [];
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    for (const req of reqs) this.garantirSemanaAberta(req.semanaInicio);

    const { data, error } = await this.executarGravacao('apoio', () => this.supabaseService.client
      .from('manutencao_programacao')
      .insert(reqs.map(req => this.montarLinhaNova(req, user)))
      .select('*')
      .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS)));
    if (error) throw new Error(mensagemErroGravacao(error));

    for (const req of reqs) this.logCriacao(req, user);
    return this.incluirNaLista((data ?? []) as ManutencaoOrdemRow[]);
  }

  // Toda gravação da Programação passa por aqui: limite de tempo total (o botão nunca
  // fica girando pra sempre) + telemetria na auditoria quando demora ou falha — pra achar
  // a causa do "às vezes trava / às vezes não salva" relatado pelos usuários.
  private async executarGravacao<R extends { error: { message: string; name?: string; code?: string } | null }>(
    operacao: 'criar' | 'editar' | 'apoio', chamada: () => PromiseLike<R>,
  ): Promise<R> {
    const t0 = performance.now();
    // Edição é um UPDATE pelo id — repetir não duplica nada. A telemetria de 08 e 15/10
    // mostrou "Failed to fetch" ao editar com a aba aberta há horas (conexão velha que
    // caiu): uma segunda tentativa abre conexão nova e costuma passar.
    const tentativas = operacao === 'editar' ? 2 : 1;
    for (let tentativa = 1; ; tentativa++) {
      try {
        const resultado = await comLimiteDeTempo(chamada(), this.LIMITE_TOTAL_GRAVACAO_MS);
        if (resultado.error && tentativa < tentativas && falhaDeRede(resultado.error)) continue;
        this.registrarTelemetria(operacao, performance.now() - t0, resultado.error, tentativa);
        return resultado;
      } catch (e: unknown) {
        const erro = e instanceof Error ? { name: e.name, message: e.message } : { message: String(e) };
        if (tentativa < tentativas && falhaDeRede(erro)) continue;
        this.registrarTelemetria(operacao, performance.now() - t0, erro, tentativa);
        throw new Error(mensagemErroGravacao(erro));
      }
    }
  }

  private registrarTelemetria(
    operacao: 'criar' | 'editar' | 'apoio', ms: number, erro: { message: string; name?: string; code?: string } | null,
    tentativas = 1,
  ): void {
    const registro = avaliarGravacao({
      operacao, ms, erro, tentativas,
      msDesdeAbertura: performance.now(),
      visivel: typeof document === 'undefined' || document.visibilityState === 'visible',
      online: typeof navigator === 'undefined' || navigator.onLine !== false,
    });
    if (!registro) return;
    console.warn('[ManutencaoProgramacao] telemetria de gravação:', registro);
    const user = this.authService.currentUser();
    if (!user) return;
    this.auditLogService.log({ user_id: user.id, user_name: user.name, resource_type: 'manutencao_programacao', ...registro });
  }

  private incluirNaLista(linhas: ManutencaoOrdemRow[]): ManutencaoOrdem[] {
    const novas = linhas.map(mapRow);
    const ids = new Set(novas.map(o => o.id));
    this._ordens.update(lista => [...novas, ...lista.filter(o => !ids.has(o.id))]);
    return novas;
  }

  private logCriacao(req: CreateManutencaoOrdemRequest, user: { id: string; name: string }): void {
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
  }

  private montarLinhaNova(req: CreateManutencaoOrdemRequest, user: { id: string; name: string }, id?: string) {
    return {
      ...(id ? { id } : {}),
      tipo: req.tipo ?? 'ordem',
      area: req.area,
      // Mecânica/Elétrica não têm ambiguidade — categoria = área, sem depender do
      // formulário mandar nada. Apoio só grava o que vier explicitamente escolhido.
      categoria_indicador: req.categoriaIndicador ?? (req.area === 'APOIO' ? null : req.area),
      semana_inicio: req.semanaInicio,
      numero_os: req.semOs ? null : (req.numeroOs?.trim() || null),
      sem_os: req.semOs ?? false,
      descricao: req.descricao.trim(),
      equipamento: req.equipamento?.trim() || null,
      equipamentos_relacionados: req.equipamentosRelacionados?.trim() || null,
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
      ciclo_data_prevista: cicloCoerenteComOrdem(req.cicloDataPrevista, req.semanaInicio, req.diasPrevistos),
      checklist: req.checklist ?? null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    };
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
    this.garantirSemanaAberta(semanaInicio);
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

    const { data, error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload)
      .select('*').abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS));
    if (error) throw new Error(mensagemErroGravacao(error));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_criada',
      resource_type: 'manutencao_programacao',
      description: `${user.name} lançou "${descricao}" pra ${params.tecnicos.length} técnicos, em ${params.diasPrevistos.join(', ')}`,
      metadata: { tipo: 'folga', dias: params.diasPrevistos, tecnicos: params.tecnicos.length },
    });

    this.incluirNaLista((data ?? []) as ManutencaoOrdemRow[]);
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
    this.garantirSemanaAberta(semanaInicio);
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

    const { data, error } = await this.supabaseService.client.from('manutencao_programacao').insert(payload)
      .select('*').abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS));
    if (error) throw new Error(mensagemErroGravacao(error));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_criada',
      resource_type: 'manutencao_programacao',
      description: `${user.name} lançou reunião "${descricao}" pra ${params.tecnicos.length} técnicos, em ${params.diasPrevistos.join(', ')}`,
      metadata: { tipo: 'reuniao', dias: params.diasPrevistos, tecnicos: params.tecnicos.length, horario, local },
    });

    this.incluirNaLista((data ?? []) as ManutencaoOrdemRow[]);
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
    const existente = this.getById(id);
    if (existente) this.garantirSemanaAberta(existente.semanaInicio);

    const { data, error } = await this.executarGravacao('editar', () => this.supabaseService.client
      .from('manutencao_programacao')
      .update({
        tipo: updates.tipo,
        area: updates.area,
        categoria_indicador: updates.categoriaIndicador ?? (updates.area === 'APOIO' ? null : updates.area),
        numero_os: updates.semOs ? null : (updates.numeroOs?.trim() || null),
        sem_os: updates.semOs,
        descricao: updates.descricao.trim(),
        equipamento: updates.equipamento?.trim() || null,
        equipamentos_relacionados: updates.equipamentosRelacionados?.trim() || null,
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
        plano_preventivo_id: updates.planoPreventivoId,
        // undefined = "não mexe no ciclo" (plano não mudou) — fica fora do UPDATE. Antes
        // passava por cicloCoerenteComOrdem, que devolvia null: toda edição de OS de
        // preventiva apagava a data do ciclo e o banco recalculava pelo 1º dia previsto.
        ciclo_data_prevista: updates.cicloDataPrevista === undefined ? undefined
          : existente ? cicloCoerenteComOrdem(updates.cicloDataPrevista, existente.semanaInicio, updates.diasPrevistos)
          : updates.cicloDataPrevista,
        checklist: updates.checklist,
      })
      .eq('id', id)
      .select('*')
      .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS))
      .single());
    if (error) throw new Error(mensagemErroGravacao(error));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_editada',
      resource_type: 'manutencao_programacao',
      resource_id: id,
      description: `${user.name} editou "${updates.descricao}" da programação (${updates.tecnicoNome})`,
    });

    // Atualiza só a linha editada, em vez de recarregar o histórico inteiro.
    this.incluirNaLista([data as ManutencaoOrdemRow]);
  }

  // Leva o número de OS da linha do responsável pros espelhos de apoio dela (ver
  // planejarEspelhos/ordensVinculadas no componente) — sem isso, pôr o número depois
  // deixava o espelho antigo "sem OS" órfão (reportado S40: OS 035688 do Daniel, cópia
  // da Fontebras ficou sem número e contava como não executada).
  async atualizarNumeroOsEspelhos(ids: string[], numeroOs: string | null): Promise<void> {
    if (ids.length === 0) return;
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const { data, error } = await this.executarGravacao('editar', () => this.supabaseService.client
      .from('manutencao_programacao')
      .update({ numero_os: numeroOs, ...(numeroOs ? { sem_os: false } : {}) })
      .in('id', ids)
      .select('*')
      .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS)));
    if (error) throw new Error(mensagemErroGravacao(error));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_editada',
      resource_type: 'manutencao_programacao',
      resource_id: ids[0],
      description: `${user.name} atualizou o nº da OS para ${numeroOs ?? '(sem número)'} em ${ids.length} apoio(s) vinculado(s)`,
    });

    this.incluirNaLista((data ?? []) as ManutencaoOrdemRow[]);
  }

  // Ajusta os dias dos espelhos de apoio que já existiam quando o responsável muda os dias
  // de um recurso na própria OS (ver planejarEspelhos no componente). Reportado S43: OS
  // 048013 do Micael, apoio do Romário (Fontebras) de TER → TER+QUA; salvava sem erro,
  // mas o espelho continuava só com TER — o espelho existente era só pulado.
  async atualizarDiasEspelhos(ajustes: { id: string; dias: string[] }[]): Promise<void> {
    if (ajustes.length === 0) return;
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const resultados = await Promise.all(ajustes.map(a => this.executarGravacao('editar', () => this.supabaseService.client
      .from('manutencao_programacao')
      .update({ dias_previstos: a.dias })
      .eq('id', a.id)
      .select('*')
      .abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS)))));
    const erro = resultados.find(r => r.error)?.error;
    this.incluirNaLista(resultados.flatMap(r => (r.data ?? []) as ManutencaoOrdemRow[]));
    if (erro) throw new Error(mensagemErroGravacao(erro));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_editada',
      resource_type: 'manutencao_programacao',
      resource_id: ajustes[0].id,
      description: `${user.name} ajustou os dias de ${ajustes.length} apoio(s) vinculado(s)`,
    });
  }

  async excluir(id: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const item = this.getById(id);
    if (item) this.garantirSemanaAberta(item.semanaInicio);
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

    this._ordens.update(lista => lista.filter(o => o.id !== id));
    if (item && this.canalAlteracoes) {
      void this.canalAlteracoes.send({ type: 'broadcast', event: 'exclusao', payload: { semana: item.semanaInicio, nome: user.name } });
    }
  }

  // Leva o ciclo de um plano pra data da ordem que o cobre (painel Saúde dos planos).
  // Atualiza TODAS as OS do plano com aquela data de ciclo de uma vez (cópias do mesmo
  // ciclo pra técnicos diferentes) — atualizar só uma faria o trigger da migration 057
  // passar o ciclo antigo pra outra cópia em vez de movê-lo.
  async realinharCiclo(planoId: string, dataAtual: string, dataNova: string): Promise<number> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error('Só Admin pode ajustar ciclo de plano.');
    const { data, error } = await this.supabaseService.client
      .from('manutencao_programacao')
      .update({ ciclo_data_prevista: dataNova })
      .eq('plano_preventivo_id', planoId)
      .eq('ciclo_data_prevista', dataAtual)
      .select('*');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Nenhuma OS foi alterada (sem permissão ou já ajustada). Atualize a tela.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_ciclo_realinhado',
      resource_type: 'manutencao_planos',
      resource_id: planoId,
      description: `${user.name} ajustou o ciclo do plano de ${dataAtual} para ${dataNova} (data da OS)`,
      metadata: { ordens: data.map(r => r.id), alteracoes: [{ campo: 'Ciclo', antes: dataAtual, depois: dataNova }] },
    });

    this.incluirNaLista(data as ManutencaoOrdemRow[]);
    return data.length;
  }

  // Move uma ordem pra outra semana — diferente de editarOrdem, que nunca mexe em
  // semana_inicio (a tela inteira opera sobre a semana filtrada no momento). Barra as
  // DUAS semanas (origem e destino): nenhuma pode estar fechada pra reprogramação
  // valer.
  async reprogramarOrdem(id: string, novaSemanaInicio: string, novosDiasPrevistos: string[], recalcularCiclo = false): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    // Releitura proposital ANTES de validar: conflito/férias/semana fechada precisam
    // enxergar o que outros usuários gravaram desde que a tela abriu.
    await Promise.all([this.load(), this.loadFerias(), this.loadAtestados(), this.loadSemanasFechadas()]);
    const item = this.getById(id);
    if (!item) throw new Error('Ordem não encontrada. Atualize a programação.');
    if (!novosDiasPrevistos.length || novosDiasPrevistos.some(d => this.semanaDoDia(d) !== novaSemanaInicio)) {
      throw new Error('Selecione dias dentro da semana de destino.');
    }
    const bloqueio = bloqueioDoTecnico(this._ferias(), this._atestados(), this._ordens(), item.tecnicoNome, novosDiasPrevistos, id);
    if (bloqueio) throw new Error(bloqueio.motivo);
    if (ordemDuplicada(this._ordens(), item.numeroOs ?? '', item.tecnicoNome, novosDiasPrevistos, id)) {
      throw new Error('Esta OS já está programada para o técnico nos dias selecionados.');
    }
    this.garantirSemanaAberta(item.semanaInicio);
    this.garantirSemanaAberta(novaSemanaInicio);

    const { data, error } = await this.supabaseService.client
      .from('manutencao_programacao')
      .update({ semana_inicio: novaSemanaInicio, dias_previstos: novosDiasPrevistos,
        ...(recalcularCiclo && item.planoPreventivoId ? { ciclo_data_prevista: novaSemanaInicio } : {}),
      })
      .eq('id', id).select('*').abortSignal(AbortSignal.timeout(this.TIMEOUT_GRAVACAO_MS)).single();
    if (error) throw new Error(mensagemErroGravacao(error));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_programacao_reprogramada',
      resource_type: 'manutencao_programacao',
      resource_id: id,
      description: `${user.name} reprogramou "${item?.descricao ?? ''}" (${item?.tecnicoNome ?? ''}) de ${item?.semanaInicio ?? '?'} pra ${novaSemanaInicio}`,
      metadata: { semana_origem: item?.semanaInicio, semana_destino: novaSemanaInicio },
    });

    this.incluirNaLista([data as ManutencaoOrdemRow]);
  }

  // Consulta as exportações do SIGMA (descrição da OS + apontamentos/execução) via
  // /api/sigma-ordens-proxy — usado tanto pra preencher a descrição sozinha quando a
  // pessoa digita o número da OS, quanto pra conferir se ela foi executada dentro da
  // semana programada. Aceita várias OS de uma vez (batch) pra não disparar uma
  // consulta por linha da tela.
  async consultarOrdensSigma(numerosOs: string[], forcar = false): Promise<Record<string, ConsultaSigmaResultado>> {
    const todos = [...new Set(numerosOs.map(n => n.trim()).filter(Boolean))];
    const agora = Date.now();
    const doCache: Record<string, ConsultaSigmaResultado> = {};
    const numeros = forcar ? todos : todos.filter(n => {
      const guardado = this.sigmaPorOs.get(n);
      if (!guardado || agora - guardado.em >= this.CACHE_SIGMA_MS) return true;
      doCache[n] = guardado.resultado;
      return false;
    });
    if (numeros.length === 0) return doCache;

    const token = await this.authService.getValidAccessToken();
    const resp = await fetch(`/api/sigma-ordens-proxy?numeros_os=${encodeURIComponent(numeros.join(','))}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.success) {
      throw new Error(body?.error || 'Falha ao consultar o SIGMA.');
    }
    const novos = body.data as Record<string, ConsultaSigmaResultado>;
    for (const [numero, resultado] of Object.entries(novos)) this.sigmaPorOs.set(numero, { em: agora, resultado });
    return { ...doCache, ...novos };
  }

  // OS preventivas pendentes (PEND) do SIGMA, todas as áreas — ver osSigmaDosPlanos.
  async consultarPreventivasPendentesSigma(): Promise<SigmaPreventivaPendente[]> {
    const guardado = this.preventivasPendentesCache;
    if (guardado && Date.now() - guardado.em < this.CACHE_SIGMA_MS) return guardado.dados;
    const dados = this.buscarPreventivasPendentesSigma();
    this.preventivasPendentesCache = { em: Date.now(), dados };
    dados.catch(() => { if (this.preventivasPendentesCache?.dados === dados) this.preventivasPendentesCache = null; });
    return dados;
  }

  private async buscarPreventivasPendentesSigma(): Promise<SigmaPreventivaPendente[]> {
    const token = await this.authService.getValidAccessToken();
    const resp = await fetch('/api/sigma-ordens-proxy?preventivas_pendentes=1', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.success) {
      throw new Error(body?.error || 'Falha ao consultar as preventivas pendentes do SIGMA.');
    }
    return (body.preventivas as [string, string, string, string][]).map(([numeroOs, descricao, bem, data]) => ({ numeroOs, descricao, bem, data }));
  }

  // Apontamentos do SIGMA num período, de QUALQUER OS (não só as programadas) — usado
  // pelos Indicadores pra mostrar hora apontada fora da programação do técnico.
  async consultarApontamentosSigmaPeriodo(de: string, ate: string, executantes: string[]): Promise<{ apontamentos: SigmaApontamentoPeriodo[]; osApontadas: OsApontadaPeriodo[] }> {
    const token = await this.authService.getValidAccessToken();
    const params = new URLSearchParams({ apontamentos_de: de, apontamentos_ate: ate, executantes: executantes.join(',') });
    const resp = await fetch(`/api/sigma-ordens-proxy?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.success) {
      throw new Error(body?.error || 'Falha ao consultar os apontamentos do SIGMA.');
    }
    return { apontamentos: body.apontamentos as SigmaApontamentoPeriodo[], osApontadas: (body.osApontadas ?? []) as OsApontadaPeriodo[] };
  }

  // Backlog do SIGMA: OS abertas de uma área, ainda não lançadas na nossa programação —
  // ajuda a montar a semana a partir do que já existe no ERP. `atualizadoEm` reflete
  // quando o proxy buscou os dados do SIGMA por último (cache de até 3min lá) — não é
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

    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_equipes')
      .insert({ nome: nomeLimpo, criado_por_id: user.id, criado_por_nome: user.name })
      .select('id, nome')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Essa equipe/empresa já está cadastrada.' : error.message);
    // Linha devolvida pelo insert entra direto na lista (mesma ordem do load: nome).
    this._equipesApoio.update(lista => upsertNaLista(lista, data as EquipeApoioItem, porNome));
  }

  async excluirEquipeApoio(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_equipes')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    this._equipesApoio.update(lista => removerDaLista(lista, id));
  }

  // ── Cadastro de recursos especiais (Munck/Guindaste/Andaime/Fontebras...) ───

  async loadRecursosEspeciais(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .select('id, opcao, empresa_apoio')
      .order('opcao');
    if (error) throw new Error(error.message);
    this._recursosEspeciais.set((data ?? []).map(mapRecursoEspecialRow));
  }

  async criarRecursoEspecial(opcao: string, empresaApoio: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const opcaoLimpa = opcao.trim().toUpperCase();
    const empresaLimpa = empresaApoio.trim().toUpperCase();
    if (!opcaoLimpa) throw new Error('Informe o rótulo do recurso.');
    if (!empresaLimpa) throw new Error('Informe pra quem esse recurso espelha no Apoio.');

    const { data, error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .insert({ opcao: opcaoLimpa, empresa_apoio: empresaLimpa, criado_por_id: user.id, criado_por_nome: user.name })
      .select('id, opcao, empresa_apoio')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Esse recurso já está cadastrado.' : error.message);
    this._recursosEspeciais.update(lista => upsertNaLista(lista, mapRecursoEspecialRow(data), (a, b) => compararTexto(a.opcao, b.opcao)));
  }

  async excluirRecursoEspecial(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_recursos_especiais')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    this._recursosEspeciais.update(lista => removerDaLista(lista, id));
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
    const { data, error } = await this.supabaseService.client
      .from('manutencao_parada_planta')
      .insert({ data_inicio: new Date().toISOString().slice(0, 10), criado_por_id: user.id, criado_por_nome: user.name })
      .select('id, data_inicio, data_fim')
      .single();
    if (error) throw new Error(error.message);
    // A recém-criada é a aberta mais recente (início = hoje) — é o que o load acharia.
    this._paradaAtual.set({ id: data.id, dataInicio: data.data_inicio, dataFim: data.data_fim });
  }

  async encerrarParadaPlanta(): Promise<void> {
    const atual = this._paradaAtual();
    if (!atual) return;
    const { data, error } = await this.supabaseService.client
      .from('manutencao_parada_planta')
      .update({ data_fim: new Date().toISOString().slice(0, 10) })
      .eq('id', atual.id)
      .select('id');
    if (error) throw new Error(error.message);
    // RLS barra o UPDATE sem erro — 0 linhas = nada foi encerrado.
    if (!data || data.length === 0) throw new Error('Não foi possível encerrar a parada (permissão do banco).');
    // Pode haver outra parada aberta mais antiga (o load pega a mais recente); nesse
    // caso raro relê só a parada atual, que é uma linha.
    this._paradaAtual.set(null);
    await this.loadParadaAtual();
  }

  // ── Semanas fechadas (Admin-only) ────────────────────────────────────────────

  async loadSemanasFechadas(): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_semanas_fechadas')
      .select('semana_inicio, fechado_por_nome, fechado_em');
    if (error) throw new Error(error.message);
    this._semanasFechadas.set(new Map((data ?? []).map(r => [
      r.semana_inicio as string,
      { fechadoPorNome: r.fechado_por_nome as string, fechadoEm: r.fechado_em as string },
    ])));
  }

  semanaEstaFechada(semanaInicio: string): boolean {
    return this._semanasFechadas().has(semanaInicio);
  }

  infoSemanaFechada(semanaInicio: string): { fechadoPorNome: string; fechadoEm: string } | null {
    return this._semanasFechadas().get(semanaInicio) ?? null;
  }

  // Chamado no início de toda mutação de manutencao_programacao (criar/editar/excluir)
  // — único ponto de checagem, em vez de repetir a trava em cada botão da tela (mais
  // fácil de esquecer um lugar do que garantir aqui uma vez só). Quem já é Admin passa
  // direto mesmo com a semana fechada — é exatamente quem pode alterar.
  private garantirSemanaAberta(semanaInicio: string): void {
    const ehAdmin = this.authService.currentUser()?.role === 'Admin';
    if (podeEditarSemanaFechada(this.semanaEstaFechada(semanaInicio), ehAdmin)) return;
    throw new Error('Essa semana está fechada. Só um Admin pode alterar.');
  }

  async fecharSemana(semanaInicio: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error('Só Admin pode fechar a semana.');
    const { data, error } = await this.supabaseService.client
      .from('manutencao_semanas_fechadas')
      .insert({ semana_inicio: semanaInicio, fechado_por_id: user.id, fechado_por_nome: user.name })
      .select('semana_inicio, fechado_por_nome, fechado_em')
      .single();
    if (error) throw new Error(error.message);
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_semana_fechada',
      resource_type: 'manutencao_semanas_fechadas',
      description: `${user.name} fechou a programação da semana de ${semanaInicio}`,
      metadata: { semana_inicio: semanaInicio },
    });
    this._semanasFechadas.update(atual => new Map(atual).set(data.semana_inicio as string, {
      fechadoPorNome: data.fechado_por_nome as string, fechadoEm: data.fechado_em as string,
    }));
  }

  async reabrirSemana(semanaInicio: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error('Só Admin pode reabrir a semana.');
    const { data, error } = await this.supabaseService.client
      .from('manutencao_semanas_fechadas')
      .delete()
      .eq('semana_inicio', semanaInicio)
      .select('semana_inicio');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      // 0 linhas: ou outro Admin já reabriu, ou o RLS barrou sem erro — o banco decide.
      await this.loadSemanasFechadas();
      if (this.semanaEstaFechada(semanaInicio)) throw new Error('Não foi possível reabrir a semana (permissão do banco).');
    }
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_semana_reaberta',
      resource_type: 'manutencao_semanas_fechadas',
      description: `${user.name} reabriu a programação da semana de ${semanaInicio}`,
      metadata: { semana_inicio: semanaInicio },
    });
    this._semanasFechadas.update(atual => {
      const novo = new Map(atual);
      novo.delete(semanaInicio);
      return novo;
    });
  }

  async criarOperadorEscala(nome: string, equipe: 'A' | 'B' | 'C' | 'D'): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) throw new Error('Informe o nome do operador.');

    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_escala')
      .insert({ nome: nomeLimpo, equipe, criado_por_id: user.id, criado_por_nome: user.name })
      .select('id, nome, equipe')
      .single();
    if (error) throw new Error(error.message);
    // Mesma ordem do load: equipe, depois nome.
    this._escalaApoio.update(lista => upsertNaLista(lista, data as OperadorEscalaApoio,
      (a, b) => compararTexto(a.equipe, b.equipe) || porNome(a, b)));
  }

  async excluirOperadorEscala(id: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_apoio_escala')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');
    this._escalaApoio.update(lista => removerDaLista(lista, id));
  }

  // ── Férias ────────────────────────────────────────────────────────────────

  async loadFerias(): Promise<void> {
    const { data, error } = await fetchAllRows((from, to) => this.supabaseService.client
      .from('manutencao_ferias')
      .select(CAMPOS_PERIODO)
      .order('data_inicio').order('id').range(from, to));
    if (error) throw new Error(error.message);
    this._ferias.set((data ?? []).map(mapPeriodoRow));
  }

  async criarFerias(params: {
    tecnicoNome: string; tecnicoMatricula: string | null; area: ManutencaoArea; dataInicio: string; dataFim: string;
  }): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (!params.tecnicoNome.trim()) throw new Error('Selecione o técnico.');
    if (!params.dataInicio || !params.dataFim) throw new Error('Informe início e fim das férias.');
    if (params.dataFim < params.dataInicio) throw new Error('A data final não pode ser antes da inicial.');

    const { data, error } = await this.supabaseService.client.from('manutencao_ferias').insert({
      tecnico_nome: params.tecnicoNome,
      tecnico_matricula: params.tecnicoMatricula,
      area: params.area,
      data_inicio: params.dataInicio,
      data_fim: params.dataFim,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    }).select(CAMPOS_PERIODO).single();
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_ferias_criada',
      resource_type: 'manutencao_ferias',
      description: `${user.name} cadastrou férias de ${params.tecnicoNome} (${params.dataInicio} a ${params.dataFim})`,
    });

    this._ferias.update(lista => upsertNaLista(lista, mapPeriodoRow(data), porPeriodo));
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

    this._ferias.update(lista => removerDaLista(lista, id));
  }

  // ── Atestado médico ──────────────────────────────────────────────────────────

  async loadAtestados(): Promise<void> {
    const { data, error } = await fetchAllRows((from, to) => this.supabaseService.client
      .from('manutencao_atestados')
      .select(CAMPOS_PERIODO)
      .order('data_inicio').order('id').range(from, to));
    if (error) throw new Error(error.message);
    this._atestados.set((data ?? []).map(mapPeriodoRow));
  }

  async criarAtestado(params: {
    tecnicoNome: string; tecnicoMatricula: string | null; area: ManutencaoArea; dataInicio: string; dataFim: string;
  }): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (!params.tecnicoNome.trim()) throw new Error('Selecione o técnico.');
    if (!params.dataInicio || !params.dataFim) throw new Error('Informe início e fim do atestado.');
    if (params.dataFim < params.dataInicio) throw new Error('A data final não pode ser antes da inicial.');

    const { data, error } = await this.supabaseService.client.from('manutencao_atestados').insert({
      tecnico_nome: params.tecnicoNome,
      tecnico_matricula: params.tecnicoMatricula,
      area: params.area,
      data_inicio: params.dataInicio,
      data_fim: params.dataFim,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    }).select(CAMPOS_PERIODO).single();
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_atestado_criado',
      resource_type: 'manutencao_atestados',
      description: `${user.name} cadastrou atestado médico de ${params.tecnicoNome} (${params.dataInicio} a ${params.dataFim})`,
    });

    this._atestados.update(lista => upsertNaLista(lista, mapPeriodoRow(data), porPeriodo));
  }

  async excluirAtestado(id: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const item = this._atestados().find(a => a.id === id);
    const { data, error } = await this.supabaseService.client
      .from('manutencao_atestados')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_atestado_excluido',
      resource_type: 'manutencao_atestados',
      resource_id: id,
      description: `${user.name} excluiu atestado médico de ${item?.tecnicoNome ?? ''}`,
    });

    this._atestados.update(lista => removerDaLista(lista, id));
  }
}
