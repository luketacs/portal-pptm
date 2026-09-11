import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  CicloManutencao, CreatePlanoManutencaoRequest, EditarPlanoManutencaoRequest,
  ManutencaoArea, PeriodicidadeUnidade, PlanoManutencao,
} from '../models/manutencao-programacao.model';

interface PlanoManutencaoRow {
  id: string;
  codigo: string;
  nome: string;
  equipamento: string;
  tag_kks: string | null;
  area: string;
  especialidade: string | null;
  descricao: string;
  atividades: string[] | null;
  periodicidade_valor: number;
  periodicidade_unidade: string;
  data_inicial: string;
  responsavel: string | null;
  tempo_estimado_horas: number | null;
  hh_estimado: number | null;
  observacoes: string | null;
  ativo: boolean;
  numero_os_reservado: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
  atualizado_por_id: string | null;
  atualizado_por_nome: string | null;
  atualizado_em: string;
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
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    atualizadoPorId: r.atualizado_por_id,
    atualizadoPorNome: r.atualizado_por_nome,
    atualizadoEm: new Date(r.atualizado_em),
  };
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

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [planosRes, ciclosRes] = await Promise.all([
        this.supabaseService.client.from('manutencao_planos').select('*').order('codigo'),
        this.supabaseService.client.from('manutencao_ciclos').select('*'),
      ]);
      if (planosRes.error) throw new Error(planosRes.error.message);
      if (ciclosRes.error) throw new Error(ciclosRes.error.message);
      this._planos.set((planosRes.data ?? []).map(mapPlanoRow));
      this._ciclos.set((ciclosRes.data ?? []).map(mapCicloRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  getById(id: string): PlanoManutencao | undefined {
    return this._planos().find(p => p.id === id);
  }

  // Data do ciclo mais recente já registrado pro plano, ou null se nunca foi
  // programado — insumo de proximaExecucaoPlano().
  ultimoCicloDoPlano(planoId: string): string | null {
    const datas = this._ciclos().filter(c => c.planoId === planoId).map(c => c.dataPrevista);
    return datas.length > 0 ? datas.sort().at(-1)! : null;
  }

  private garantirAdmin(mensagem: string): { id: string; name: string } {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (user.role !== 'Admin') throw new Error(mensagem);
    return user;
  }

  async criar(req: CreatePlanoManutencaoRequest): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode cadastrar plano de manutenção.');

    const { error } = await this.supabaseService.client.from('manutencao_planos').insert({
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
      criado_por_id: user.id,
      criado_por_nome: user.name,
    });
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_criado',
      resource_type: 'manutencao_planos',
      description: `${user.name} cadastrou o plano de manutenção "${req.nome}" (${req.equipamento})`,
      metadata: { area: req.area, periodicidade: `${req.periodicidadeValor} ${req.periodicidadeUnidade}` },
    });

    await this.load();
  }

  async editar(id: string, req: EditarPlanoManutencaoRequest): Promise<void> {
    const user = this.garantirAdmin('Só Admin pode editar plano de manutenção.');

    const { error } = await this.supabaseService.client
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
        atualizado_por_id: user.id,
        atualizado_por_nome: user.name,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'manutencao_plano_editado',
      resource_type: 'manutencao_planos',
      resource_id: id,
      description: `${user.name} editou o plano de manutenção "${req.nome}" (${req.equipamento})`,
    });

    await this.load();
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

    const { error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({ ativo, atualizado_por_id: user.id, atualizado_por_nome: user.name, atualizado_em: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: ativo ? 'manutencao_plano_ativado' : 'manutencao_plano_desativado',
      resource_type: 'manutencao_planos',
      resource_id: id,
      description: `${user.name} ${ativo ? 'ativou' : 'desativou'} o plano de manutenção "${plano?.nome ?? ''}"`,
    });

    await this.load();
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

    await this.load();
  }

  // Anota (ou limpa, se numeroOs vier vazio) o número da OS já aberta/reservada no
  // SIGMA pra esse plano, antes dele ser efetivamente programado — ver
  // programarDaPreventiva, que usa isso pra pré-preencher o formulário. Não é
  // Admin-only: quem já pode criar OS, pode anotar o número reservado.
  async salvarNumeroOsReservado(id: string, numeroOs: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('manutencao_planos')
      .update({ numero_os_reservado: numeroOs.trim() || null, atualizado_em: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  // Registra o ciclo depois que a ordem já foi criada com sucesso (ver
  // programarDaPreventiva/criarOrdem na Programação) — não é Admin-only, pelo mesmo
  // motivo de salvarNumeroOsReservado. UNIQUE(plano_id, data_prevista) no banco
  // garante que duas programações da mesma ocorrência não geram dois ciclos; um
  // conflito aqui não desfaz a ordem já criada (mesma filosofia best-effort que o
  // fluxo antigo já tinha pra "avançar" o plano).
  async registrarCiclo(planoId: string, dataPrevista: string, ordemId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('manutencao_ciclos')
      .insert({ plano_id: planoId, data_prevista: dataPrevista, ordem_id: ordemId });
    if (error && error.code !== '23505') throw new Error(error.message);
    await this.load();
  }

  // Usado só quando a pessoa reprograma uma ordem e marca "recalcular as próximas
  // datas" (ver reprogramarOrdem/confirmarReprogramar na Programação) — sem isso, o
  // default (não marcar) já funciona sozinho: o ciclo mantém a data_prevista original,
  // então a cadência do plano não muda por causa de uma reprogramação pontual. Não é
  // Admin-only, mesmo motivo de registrarCiclo/salvarNumeroOsReservado.
  async recalcularCiclo(cicloId: string, novaDataPrevista: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('manutencao_ciclos')
      .update({ data_prevista: novaDataPrevista })
      .eq('id', cicloId);
    if (error) throw new Error(error.message);
    await this.load();
  }
}
