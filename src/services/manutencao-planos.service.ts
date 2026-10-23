import { fetchAllRows } from '../utils/supabase-pagination';
import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  AtividadeChecklist, CicloManutencao, CreatePlanoManutencaoRequest, EditarPlanoManutencaoRequest,
  ManutencaoArea, PeriodicidadeUnidade, PlanoManutencao,
} from '../models/manutencao-programacao.model';
import { AlteracaoCampo, diferencasPlano } from '../utils/manutencao-planos-saude';
import { AdiamentosPorPlano } from '../utils/manutencao-planos';
import { removerDaLista, upsertNaLista, upsertVariosNaLista } from '../utils/lista-local';

interface PlanoManutencaoRow {
  id: string;
  codigo: string;
  nome: string;
  equipamento: string;
  tag_kks: string | null;
  area: string;
  especialidade: string | null;
  descricao: string;
  atividades: AtividadeChecklist[] | null;
  periodicidade_valor: number;
  periodicidade_unidade: string;
  data_inicial: string;
  responsavel: string | null;
  tempo_estimado_horas: number | null;
  hh_estimado: number | null;
  observacoes: string | null;
  ativo: boolean;
  numero_os_reservado: string | null;
  loto_padrao: string | null;
  equipamentos_relacionados: string | null;
  recursos_apoio?: string | null;
  agenda_rigida?: boolean | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
  atualizado_por_id: string | null;
  atualizado_por_nome: string | null;
  atualizado_em: string;
}

export interface AlteracaoCadastroPlano {
  quando: Date;
  quem: string;
  evento: string;
  descricao: string;
  alteracoes: AlteracaoCampo[];
}

interface CicloManutencaoRow {
  id: string;
  plano_id: string;
  data_prevista: string;
  ordem_id: string;
  created_at: string;
}

function mapPlanoRow(r: PlanoManutencaoRow): PlanoManutencao {
  return {
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    equipamento: r.equipamento,
    tagKks: r.tag_kks,
    area: r.area as ManutencaoArea,
    especialidade: r.especialidade,
    descricao: r.descricao,
    atividades: r.atividades ?? [],
    periodicidadeValor: Number(r.periodicidade_valor),
    periodicidadeUnidade: r.periodicidade_unidade as PeriodicidadeUnidade,
    dataInicial: r.data_inicial,
    responsavel: r.responsavel,
    tempoEstimadoHoras: r.tempo_estimado_horas !== null ? Number(r.tempo_estimado_horas) : null,
    hhEstimado: r.hh_estimado !== null ? Number(r.hh_estimado) : null,
    observacoes: r.observacoes,
    ativo: r.ativo,
    numeroOsReservado: r.numero_os_reservado,
    lotoPadrao: r.loto_padrao,
    equipamentosRelacionados: r.equipamentos_relacionados,
    recursosApoio: r.recursos_apoio ?? null,
    agendaRigida: r.agenda_rigida ?? false,
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    atualizadoPorId: r.atualizado_por_id,
    atualizadoPorNome: r.atualizado_por_nome,
    atualizadoEm: new Date(r.atualizado_em),
  };
}

// Mesma ordem do load (ORDER BY codigo, id) — códigos são 'PM-0001', comparação simples.
const compararCodigo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const porCodigo = (a: PlanoManutencao, b: PlanoManutencao): number =>
  compararCodigo(a.codigo, b.codigo) || compararCodigo(a.id, b.id);

// UPDATE barrado pelo RLS não dá erro, só volta 0 linhas — .single() acusa PGRST116.
function erroGravacaoPlano(error: { message: string; code?: string }): Error {
  return new Error(error.code === 'PGRST116' ? 'Não foi possível salvar o plano (sem permissão no banco).' : error.message);
}

function mapCicloRow(r: CicloManutencaoRow): CicloManutencao {
  return {
    id: r.id,
    planoId: r.plano_id,
    dataPrevista: r.data_prevista,
    ordemId: r.ordem_id,
    createdAt: new Date(r.created_at),
  };
}

@Injectable({ providedIn: 'root' })
export class ManutencaoPlanosService {
  private _planos = signal<PlanoManutencao[]>([]);
  planos = this._planos.asReadonly();

  // Ledger de ciclos já programados (ver migration 032) — carregado inteiro, igual
  // ordens() na Programação, sem paginação em lugar nenhum do app. UNIQUE(plano_id,
  // data_prevista) no banco é o que impede duplicidade; isso aqui só alimenta o
  // "última execução" derivado (ver proximaExecucaoPlano em utils/manutencao-planos.ts).
  private _ciclos = signal<CicloManutencao[]>([]);
  ciclos = this._ciclos.asReadonly();

  isLoading = signal(false);

  // OS já abertas no SIGMA pra cada ocorrência (migration 067 — planilha anual da
  // Operação): chave `${planoId}|${data}` → número da OS daquela semana.
  private _osPrevistas = signal<ReadonlyMap<string, string>>(new Map());

  // Ocorrências adiadas pelo Admin (migration 084): plano -> (ocorrência -> nova data).
  private _adiamentos = signal<AdiamentosPorPlano>(new Map());
  adiamentosPorPlano = this._adiamentos.asReadonly();

  /** Número da OS já aberta pra essa ocorrência do plano (null se não houver). */
  osPrevista(planoId: string, data: string | null | undefined): string | null {
    return data ? this._osPrevistas().get(`${planoId}|${data}`) ?? null : null;
  }

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [planosRes, ciclosRes, osPrevistasRes, adiamentosRes] = await Promise.all([
        fetchAllRows((from, to) => this.supabaseService.client.from('manutencao_planos').select('*').order('codigo').order('id').range(from, to)),
        fetchAllRows((from, to) => this.supabaseService.client.from('manutencao_ciclos').select('*').order('id').range(from, to)),
        fetchAllRows<{ plano_id: string; data_prevista: string; numero_os: string }>((from, to) => this.supabaseService.client
          .from('manutencao_os_previstas').select('plano_id, data_prevista, numero_os').order('id').range(from, to)),
        fetchAllRows<{ plano_id: string; data_ocorrencia: string; nova_data: string }>((from, to) => this.supabaseService.client
          .from('manutencao_adiamentos').select('plano_id, data_ocorrencia, nova_data').order('id').range(from, to)),
      ]);
      if (planosRes.error) throw new Error(planosRes.error.message);
      if (ciclosRes.error) throw new Error(ciclosRes.error.message);
      this._planos.set((planosRes.data ?? []).map(mapPlanoRow));
      this._ciclos.set((ciclosRes.data ?? []).map(mapCicloRow));
      // Best-effort: sem a tabela (migration 067 ainda não rodada) a programação só não
      // preenche o número da semana sozinha — não trava o resto.
      if (osPrevistasRes.error) console.warn('[ManutencaoPlanos] OS previstas indisponíveis:', osPrevistasRes.error.message);
      this._osPrevistas.set(new Map((osPrevistasRes.data ?? []).map(r => [`${r.plano_id}|${r.data_prevista}`, r.numero_os])));
      // Best-effort também: sem a migration 084 só não aparece nada adiado.
      if (adiamentosRes.error) console.warn('[ManutencaoPlanos] Adiamentos indisponíveis:', adiamentosRes.error.message);
      const adiamentos = new Map<string, Map<string, string>>();
      for (const r of adiamentosRes.data ?? []) {
        const doPlano = adiamentos.get(r.plano_id) ?? new Map<string, string>();
        doPlano.set(r.data_ocorrencia, r.nova_data);
        adiamentos.set(r.plano_id, doPlano);
      }
      this._adiamentos.set(adiamentos);
      this.carregadoEm = Date.now();
    } finally {
      this.isLoading.set(false);
    }
  }

  // A Programação (cada aba) relia planos + ciclos + OS previstas + adiamentos ao abrir.
  // Gravações deste app já atualizam a memória; o que muda por fora (outro usuário, ou
  // ciclos gravados por trigger) entra na próxima releitura após 5 min.
  private carregadoEm: number | null = null;
  private readonly IDADE_MAXIMA_CARGA_MS = 5 * 60 * 1000;
  async loadSeNecessario(): Promise<void> {
    if (this.carregadoEm === null || Date.now() - this.carregadoEm >= this.IDADE_MAXIMA_CARGA_MS) {
      await this.load();
    }
  }

  // Só o ledger de ciclos — é o que muda (via trigger da migration 057) quando uma OS de
  // preventiva é criada/editada/excluída/reprogramada. Não precisa reler planos, OS
  // previstas e adiamentos junto.
  async loadCiclos(): Promise<void> {
    const { data, error } = await fetchAllRows((from, to) => this.supabaseService.client
      .from('manutencao_ciclos').select('*').order('id').range(from, to));
    if (error) throw new Error(error.message);
    this._ciclos.set((data ?? []).map(mapCicloRow));
  }

  // Indexado: a Programação chama getById várias vezes por linha (selo KKS) a cada
  // atualização da tela — com ~830 planos, o find linear pesava.
  private planosPorId = computed(() => new Map(this._planos().map(p => [p.id, p])));
  getById(id: string): PlanoManutencao | undefined {
    return this.planosPorId().get(id);
  }

  // Data do ciclo mais recente já registrado pro plano, ou null se nunca foi
  // programado — insumo de proximaExecucaoPlano()/proximaDataFixa (ambas usam isso pra
  // saber se uma ocorrência já foi coberta). Exige ordemId preenchido: reportado — 36
  // linhas de manutencao_ciclos (35 Apoio + 1 Elétrica, todas data_prevista=2026-09-21,
  // ver auditoria) tinham ordem_id NULO — sobra de um script/teste anterior que inseriu
  // ciclo direto sem nunca criar OS nenhuma (registrarCiclo, abaixo, sempre exige um
  // ordemId real). Sem esse filtro, planosComProximaExecucaoFixa tratava essas linhas
  // como "já programado" e pulava a ocorrência de verdade pro mês seguinte — sintoma:
  // SERVPLEX/OPERAÇÃO da semana 39 sumiam inteiros da lista de sugestões sem nenhuma OS
  // ter sido criada.
  ultimoCicloDoPlano(planoId: string): string | null {
    return this.ciclosPorPlano().get(planoId)?.at(-1) ?? null;
  }

  // Datas dos ciclos COM OS (mesmo filtro de ultimoCicloDoPlano), ordenadas, por plano —
  // insumo do controle de não programadas (planosAtrasados). Indexado uma vez: antes
  // ultimoCicloDoPlano varria o ledger inteiro pra cada um dos ~750 planos.
  ciclosPorPlano = computed(() => {
    const mapa = new Map<string, string[]>();
    for (const c of this._ciclos()) {
      if (!c.ordemId) continue;
      const lista = mapa.get(c.planoId);
      if (lista) lista.push(c.dataPrevista);
      else mapa.set(c.planoId, [c.dataPrevista]);
    }
    mapa.forEach(lista => lista.sort());
    return mapa;
  });

  // Aplica na lista as linhas devolvidas pela gravação, em vez de recarregar planos +
  // ciclos + OS previstas + adiamentos inteiros. Gravar plano não mexe em outra tabela
  // (os triggers de manutencao_planos são BEFORE e só tocam a própria linha).
  private aplicarPlanos(linhas: PlanoManutencaoRow[]): void {
    const planos = linhas.map(mapPlanoRow);
    this._planos.update(lista => planos.length === 1
      ? upsertNaLista(lista, planos[0], porCodigo)
      : upsertVariosNaLista(lista, planos, porCodigo));
  }

  // Excluir o plano apaga em cascata (ON DELETE CASCADE) ciclos, OS previstas e
  // adiamentos dele — limpa o mesmo aqui. As OS da programação só perdem o vínculo
  // (SET NULL) e são estado do ManutencaoProgramacaoService, não daqui.
  private removerPlanoLocal(id: string): void {
    this._planos.update(lista => removerDaLista(lista, id));
    this._ciclos.update(lista => lista.filter(c => c.planoId !== id));
    this._osPrevistas.update(mapa => new Map([...mapa].filter(([chave]) => !chave.startsWith(`${id}|`))));
    this._adiamentos.update(mapa => {
      if (!mapa.has(id)) return mapa;
      const novo = new Map(mapa);
      novo.delete(id);
      return novo;
    });
  }

  private garantirAdmin(mensagem: string): { id: string; name: string } {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error(mensagem);
    return user;
  }

  async criar(req: CreatePlanoManutencaoRequest): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode cadastrar plano de manutenção.');

    // select('*'): volta com o código gerado pelo trigger (PM-xxxx), entra direto na lista.
    const { data, error } = await this.supabaseService.client.from('manutencao_planos').insert({
      nome: req.nome.trim(),
      equipamento: req.equipamento.trim(),
      tag_kks: req.tagKks?.trim() || null,
      area: req.area,
      especialidade: req.especialidade?.trim() || null,
      descricao: req.descricao.trim(),
      atividades: req.atividades ?? [],
      periodicidade_valor: req.periodicidadeValor,
      periodicidade_unidade: req.periodicidadeUnidade,
      data_inicial: req.dataInicial,
      responsavel: req.responsavel?.trim() || null,
      tempo_estimado_horas: req.tempoEstimadoHoras ?? null,
      hh_estimado: req.hhEstimado ?? null,
      observacoes: req.observacoes?.trim() || null,
      ativo: req.ativo ?? true,
      loto_padrao: req.lotoPadrao?.trim() || null,
      equipamentos_relacionados: req.equipamentosRelacionados?.trim() || null,
      recursos_apoio: req.recursosApoio?.trim() || null,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    }).select('*').single();
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_criado',
      resource_type: 'manutencao_planos',
      description: `${user.name} cadastrou o plano de manutenção "${req.nome}" (${req.equipamento})`,
      metadata: { area: req.area, periodicidade: `${req.periodicidadeValor} ${req.periodicidadeUnidade}` },
    });

    this.aplicarPlanos([data as PlanoManutencaoRow]);
  }

  async editar(id: string, req: EditarPlanoManutencaoRequest): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode editar plano de manutenção.');
    // Versão antes de salvar — vira o "antes → depois" do histórico de alterações.
    const anterior = this.getById(id);

    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({
        nome: req.nome.trim(),
        equipamento: req.equipamento.trim(),
        tag_kks: req.tagKks?.trim() || null,
        area: req.area,
        especialidade: req.especialidade?.trim() || null,
        descricao: req.descricao.trim(),
        atividades: req.atividades,
        periodicidade_valor: req.periodicidadeValor,
        periodicidade_unidade: req.periodicidadeUnidade,
        data_inicial: req.dataInicial,
        responsavel: req.responsavel?.trim() || null,
        tempo_estimado_horas: req.tempoEstimadoHoras,
        hh_estimado: req.hhEstimado,
        observacoes: req.observacoes?.trim() || null,
        ativo: req.ativo,
        loto_padrao: req.lotoPadrao?.trim() || null,
        equipamentos_relacionados: req.equipamentosRelacionados?.trim() || null,
      recursos_apoio: req.recursosApoio?.trim() || null,
        atualizado_por_id: user.id,
        atualizado_por_nome: user.name,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw erroGravacaoPlano(error);

    const alteracoes = anterior ? diferencasPlano(anterior, req) : [];
    const resumo = alteracoes.length > 0 ? `: ${alteracoes.map(a => a.campo).join(', ')}` : '';
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_editado',
      resource_type: 'manutencao_planos',
      resource_id: id,
      description: `${user.name} editou o plano de manutenção "${req.nome}" (${req.equipamento})${resumo}`,
      metadata: { codigo: anterior?.codigo ?? null, alteracoes },
    });

    this.aplicarPlanos([data as PlanoManutencaoRow]);
  }

  // Histórico de alterações do cadastro de um plano (quem, quando, campo antes → depois),
  // lido do audit_logs — só Admin lê essa tabela (RLS, migration 005). Edições feitas
  // antes do diff existir aparecem sem a lista de campos. Inclui as replicações de
  // checklist em que o plano foi DESTINO (o log fica com resource_id da origem).
  async historicoAlteracoes(planoId: string): Promise<AlteracaoCadastroPlano[]> {
    const campos = 'id, created_at, user_name, event_type, description, metadata';
    const [proprios, replicados] = await Promise.all([
      this.supabaseService.client.from('audit_logs').select(campos)
        .eq('resource_type', 'manutencao_planos').eq('resource_id', planoId)
        .order('created_at', { ascending: false }).limit(200),
      this.supabaseService.client.from('audit_logs').select(campos)
        .eq('event_type', 'manutencao_plano_checklist_replicado').contains('metadata', { destinos: [planoId] })
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (proprios.error) throw new Error(proprios.error.message);
    if (replicados.error) throw new Error(replicados.error.message);
    const porId = new Map([...(proprios.data ?? []), ...(replicados.data ?? [])].map(r => [r.id, r]));
    return [...porId.values()]
      .map(r => ({
        quando: new Date(r.created_at),
        quem: r.user_name,
        evento: r.event_type,
        descricao: r.description,
        alteracoes: ((r.metadata as { alteracoes?: AlteracaoCampo[] } | null)?.alteracoes) ?? [],
      }))
      .sort((a, b) => b.quando.getTime() - a.quando.getTime());
  }

  // Replica o checklist de um plano pra vários outros de uma vez (equipamentos gêmeos:
  // Stacker 01/02, TC 05/06/07, ECA 45..50...). Cópia de verdade — cada plano fica com o
  // seu, editar um depois não muda os outros. Uma requisição só pra todos os destinos.
  async replicarChecklist(origemId: string, destinoIds: string[]): Promise<number> {
    const user = this.garantirAdmin('Só Admin pode alterar o checklist dos planos.');
    const origem = this.getById(origemId);
    if (!origem) throw new Error('Plano de origem não encontrado.');
    const ids = destinoIds.filter(id => id !== origemId);
    if (ids.length === 0) return 0;

    const atividades = origem.atividades.map(a => ({ texto: a.texto, subPassos: [...a.subPassos] }));
    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({ atividades, atualizado_por_id: user.id, atualizado_por_nome: user.name, atualizado_em: new Date().toISOString() })
      .in('id', ids)
      .select('*');
    if (error) throw new Error(error.message);
    const alterados = data?.length ?? 0;
    if (alterados === 0) throw new Error('Nenhum plano foi alterado (sem permissão no banco).');

    const nomes = ids.map(id => this.getById(id)).filter((p): p is PlanoManutencao => !!p)
      .map(p => `${p.codigo} ${p.equipamento}`);
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_checklist_replicado',
      resource_type: 'manutencao_planos',
      resource_id: origemId,
      description: `${user.name} replicou o checklist de "${origem.nome}" (${origem.codigo}) pra ${alterados} plano(s): ${nomes.join(', ')}`,
      metadata: { origem: origemId, destinos: ids, passos: atividades.length },
    });

    this.aplicarPlanos(data as PlanoManutencaoRow[]);
    return alterados;
  }

  async ativar(id: string): Promise<void> {
    await this.definirAtivo(id, true);
  }

  async desativar(id: string): Promise<void> {
    await this.definirAtivo(id, false);
  }

  private async definirAtivo(id: string, ativo: boolean): Promise<void> {
    const user = this.garantirAdmin(`Só Admin pode ${ativo ? 'ativar' : 'desativar'} plano de manutenção.`);
    const plano = this.getById(id);

    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({ ativo, atualizado_por_id: user.id, atualizado_por_nome: user.name, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw erroGravacaoPlano(error);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: ativo ? 'manutencao_plano_ativado' : 'manutencao_plano_desativado',
      resource_type: 'manutencao_planos',
      resource_id: id,
      description: `${user.name} ${ativo ? 'ativou' : 'desativou'} o plano de manutenção "${plano?.nome ?? ''}"`,
    });

    this.aplicarPlanos([data as PlanoManutencaoRow]);
  }

  // Excluir não apaga ordens já geradas nem o histórico de ciclos que já viraram
  // ordem — ON DELETE SET NULL em manutencao_programacao.plano_preventivo_id preserva
  // a OS (só perde o vínculo com o plano); ON DELETE CASCADE em manutencao_ciclos só
  // limpa o ledger de duplicidade, que não tem valor histórico próprio sem o plano.
  async excluir(id: string): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode excluir plano de manutenção.');
    const plano = this.getById(id);

    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Não foi possível excluir (permissão do banco).');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_excluido',
      resource_type: 'manutencao_planos',
      resource_id: id,
      description: `${user.name} excluiu o plano de manutenção "${plano?.nome ?? ''}"`,
    });

    this.removerPlanoLocal(id);
  }

  // Anota (ou limpa, se numeroOs vier vazio) o número da OS já aberta/reservada no
  // SIGMA pra esse plano, antes dele ser efetivamente programado — ver
  // programarDaPreventiva, que usa isso pra pré-preencher o formulário. Não é
  // Admin-only: quem já pode criar OS, pode anotar o número reservado.
  async salvarNumeroOsReservado(id: string, numeroOs: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({ numero_os_reservado: numeroOs.trim() || null, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw erroGravacaoPlano(error);
    this.aplicarPlanos([data as PlanoManutencaoRow]);
  }

  // Adia uma ocorrência do plano (só Admin). `ocorrencia` é a data REAL (o ciclo continua
  // nela ao programar); adiar de novo a mesma ocorrência só troca a nova data.
  async adiarOcorrencia(plano: PlanoManutencao, ocorrencia: string, novaData: string): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode adiar preventiva.');
    const { error } = await this.supabaseService.client.from('manutencao_adiamentos').upsert({
      plano_id: plano.id,
      data_ocorrencia: ocorrencia,
      nova_data: novaData,
      criado_por_id: user.id,
      criado_por_nome: user.name,
    }, { onConflict: 'plano_id,data_ocorrencia' });
    if (error) throw new Error(error.message);
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_preventiva_adiada',
      resource_type: 'manutencao_planos',
      resource_id: plano.id,
      description: `${user.name} adiou ${plano.codigo} ${plano.nome} (ocorrência ${ocorrencia}) para ${novaData}`,
      metadata: { data_ocorrencia: ocorrencia, nova_data: novaData },
    });
    this._adiamentos.update(atual => {
      const novo = new Map(atual);
      novo.set(plano.id, new Map(atual.get(plano.id) ?? []).set(ocorrencia, novaData));
      return novo;
    });
  }

  // Ciclos são gravados pelo trigger da programação, na mesma transação da ordem.
}
