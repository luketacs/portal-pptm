import { Injectable, computed, signal } from '@angular/core';
import { fetchAllRows } from '../utils/supabase-pagination';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  ClasseIsolamento, EnsaioIsolamento, Executante, LeituraIsolamento, Motor, ResultadoEnsaio, SalvarEnsaio, SalvarMotor,
  TipoBobina,
} from '../models/eletrica-ensaio.model';
import { avaliarEnsaio, criterioDoEnsaio, numeroEnsaio } from '../utils/eletrica-ensaio';

interface MotorRow {
  id: string;
  tag: string;
  descricao: string | null;
  local_instalacao: string | null;
  fabricante: string | null;
  modelo: string | null;
  numero_serie: string | null;
  potencia_kw: number | string | null;
  potencia_cv: number | string | null;
  tensao_v: number | string;
  corrente_a: number | string | null;
  frequencia_hz: number | string | null;
  fator_servico: number | string | null;
  rotacao_rpm: number | null;
  classe_isolamento: string;
  tipo_bobina: string;
  observacoes: string | null;
  criado_por_nome: string | null;
  created_at: string;
  updated_at: string;
}

interface EnsaioRow {
  id: string;
  numero: number;
  equipamento_id: string;
  data_ensaio: string;
  os_numero: string | null;
  instrumento: string | null;
  instrumento_modelo: string | null;
  tensao_aplicada_v: number | string;
  temperatura_ambiente_c: number | string;
  temperatura_enrolamento_c: number | string | null;
  umidade_pct: number | string | null;
  tensao_nominal_v: number | string;
  classe_isolamento: string;
  tipo_bobina: string;
  medicoes: LeituraIsolamento[] | null;
  resultado: string;
  executantes: Executante[] | null;
  observacoes: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
  updated_at: string;
}

// NUMERIC chega como string do PostgREST.
const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));

function mapMotor(r: MotorRow): Motor {
  return {
    id: r.id,
    tag: r.tag,
    descricao: r.descricao,
    localInstalacao: r.local_instalacao,
    fabricante: r.fabricante,
    modelo: r.modelo,
    numeroSerie: r.numero_serie,
    potenciaKw: num(r.potencia_kw),
    potenciaCv: num(r.potencia_cv),
    tensaoV: Number(r.tensao_v),
    correnteA: num(r.corrente_a),
    frequenciaHz: num(r.frequencia_hz),
    fatorServico: num(r.fator_servico),
    rotacaoRpm: r.rotacao_rpm,
    classeIsolamento: r.classe_isolamento as ClasseIsolamento,
    tipoBobina: r.tipo_bobina as TipoBobina,
    observacoes: r.observacoes,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function mapEnsaio(r: EnsaioRow): EnsaioIsolamento {
  return {
    id: r.id,
    numero: Number(r.numero) || 0,
    equipamentoId: r.equipamento_id,
    dataEnsaio: r.data_ensaio,
    osNumero: r.os_numero,
    instrumento: r.instrumento,
    instrumentoModelo: r.instrumento_modelo,
    tensaoAplicadaV: Number(r.tensao_aplicada_v),
    temperaturaAmbienteC: Number(r.temperatura_ambiente_c),
    temperaturaEnrolamentoC: num(r.temperatura_enrolamento_c),
    umidadePct: num(r.umidade_pct),
    tensaoNominalV: Number(r.tensao_nominal_v),
    classeIsolamento: r.classe_isolamento as ClasseIsolamento,
    tipoBobina: r.tipo_bobina as TipoBobina,
    medicoes: r.medicoes ?? [],
    resultado: r.resultado as ResultadoEnsaio,
    executantes: r.executantes ?? [],
    observacoes: r.observacoes,
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

const textoOuNull = (v: string | null | undefined) => v?.trim() || null;

function payloadMotor(m: SalvarMotor) {
  return {
    tag: m.tag.trim().toUpperCase(),
    descricao: textoOuNull(m.descricao),
    local_instalacao: textoOuNull(m.localInstalacao),
    fabricante: textoOuNull(m.fabricante),
    modelo: textoOuNull(m.modelo),
    numero_serie: textoOuNull(m.numeroSerie),
    potencia_kw: m.potenciaKw,
    potencia_cv: m.potenciaCv,
    tensao_v: m.tensaoV,
    corrente_a: m.correnteA,
    frequencia_hz: m.frequenciaHz,
    fator_servico: m.fatorServico,
    rotacao_rpm: m.rotacaoRpm,
    classe_isolamento: m.classeIsolamento,
    tipo_bobina: m.tipoBobina,
    observacoes: textoOuNull(m.observacoes),
  };
}

// O resultado é sempre recalculado aqui pela norma — a tela não manda o dela.
function payloadEnsaio(e: SalvarEnsaio) {
  const { resultado } = avaliarEnsaio(e.medicoes, criterioDoEnsaio(e));
  if (!resultado) throw new Error('Faltam leituras obrigatórias para concluir o ensaio.');
  return {
    equipamento_id: e.equipamentoId,
    data_ensaio: e.dataEnsaio,
    os_numero: textoOuNull(e.osNumero),
    instrumento: textoOuNull(e.instrumento),
    instrumento_modelo: textoOuNull(e.instrumentoModelo),
    tensao_aplicada_v: e.tensaoAplicadaV,
    temperatura_ambiente_c: e.temperaturaAmbienteC,
    temperatura_enrolamento_c: e.temperaturaEnrolamentoC,
    umidade_pct: e.umidadePct,
    tensao_nominal_v: e.tensaoNominalV,
    classe_isolamento: e.classeIsolamento,
    tipo_bobina: e.tipoBobina,
    medicoes: e.medicoes,
    resultado,
    executantes: e.executantes.filter(x => x.nome.trim()).map(x => ({ nome: x.nome.trim(), matricula: x.matricula.trim() })),
    observacoes: textoOuNull(e.observacoes),
  };
}

function mensagemErro(message: string): string {
  if (message.includes('uq_eletrica_equipamentos_tag')) return 'Já existe um motor cadastrado com essa TAG.';
  return message;
}

@Injectable({ providedIn: 'root' })
export class EletricaEnsaioService {
  private _motores = signal<Motor[]>([]);
  private _ensaios = signal<EnsaioIsolamento[]>([]);
  readonly motores = this._motores.asReadonly();
  readonly ensaios = this._ensaios.asReadonly();
  readonly isLoading = signal(false);

  readonly isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  // Motores + todos os ensaios (a lista mostra o último de cada TAG; são poucos por ano).
  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [motores, ensaios] = await Promise.all([
        fetchAllRows<MotorRow>((from, to) => this.supabaseService.client
          .from('eletrica_equipamentos').select('*').eq('tipo', 'motor')
          .order('tag').order('id').range(from, to)),
        fetchAllRows<EnsaioRow>((from, to) => this.supabaseService.client
          .from('eletrica_ensaios').select('*')
          .order('data_ensaio', { ascending: false }).order('numero', { ascending: false }).range(from, to)),
      ]);
      if (motores.error) throw new Error(motores.error.message);
      if (ensaios.error) throw new Error(ensaios.error.message);
      this._motores.set(motores.data.map(mapMotor));
      this._ensaios.set(ensaios.data.map(mapEnsaio));
    } finally {
      this.isLoading.set(false);
    }
  }

  async buscarMotor(id: string): Promise<Motor | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_equipamentos').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapMotor(data as MotorRow) : null;
  }

  // Do mais antigo pro mais novo (ordem da tendência).
  async ensaiosDoMotor(equipamentoId: string): Promise<EnsaioIsolamento[]> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').select('*').eq('equipamento_id', equipamentoId)
      .order('data_ensaio').order('numero');
    if (error) throw new Error(error.message);
    return ((data ?? []) as EnsaioRow[]).map(mapEnsaio);
  }

  async buscarEnsaio(id: string): Promise<EnsaioIsolamento | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapEnsaio(data as EnsaioRow) : null;
  }

  podeCorrigir(e: EnsaioIsolamento): boolean {
    const u = this.authService.currentUser();
    return !!u && (u.role === 'Admin' || e.criadoPorId === u.id);
  }

  async salvarMotor(dados: SalvarMotor, id?: string): Promise<string> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadMotor(dados);

    const query = id
      ? this.supabaseService.client.from('eletrica_equipamentos')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('id')
      : this.supabaseService.client.from('eletrica_equipamentos')
        .insert({ ...payload, tipo: 'motor', criado_por_id: user.id, criado_por_nome: user.name }).select('id');
    const { data, error } = await query;
    if (error) throw new Error(mensagemErro(error.message));
    if (!data?.length) throw new Error('Sem permissão para salvar o motor.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'eletrica_motor_editado' : 'eletrica_motor_cadastrado',
      resource_type: 'eletrica_equipamento',
      resource_id: data[0].id,
      description: `${user.name} ${id ? 'editou' : 'cadastrou'} o motor ${payload.tag}`,
    });
    return data[0].id;
  }

  // Só Admin (RLS portal_admin_excluir). Os ensaios do motor saem junto (ON DELETE CASCADE).
  async excluirMotor(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');
    const { data, error } = await this.supabaseService.client
      .from('eletrica_equipamentos').delete().eq('id', id).select('tag');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'eletrica_motor_excluido',
      resource_type: 'eletrica_equipamento',
      resource_id: id,
      description: `${admin.name} excluiu o motor ${data[0].tag} e os ensaios dele`,
    });
  }

  async salvarEnsaio(dados: SalvarEnsaio, id?: string): Promise<{ id: string; numero: number }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadEnsaio(dados);

    const query = id
      ? this.supabaseService.client.from('eletrica_ensaios')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('id, numero')
      : this.supabaseService.client.from('eletrica_ensaios')
        .insert({ ...payload, criado_por_id: user.id, criado_por_nome: user.name }).select('id, numero');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    // RLS barra sem erro: 0 linhas = sem permissão.
    if (!data?.length) throw new Error('Só quem lançou o ensaio (ou Admin) pode corrigi-lo.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'eletrica_ensaio_editado' : 'eletrica_ensaio_registrado',
      resource_type: 'eletrica_ensaio',
      resource_id: data[0].id,
      description: `${user.name} ${id ? 'corrigiu' : 'registrou'} o ensaio ${numeroEnsaio(data[0].numero)} (${payload.resultado})`,
      metadata: { numero: data[0].numero, resultado: payload.resultado },
    });
    return { id: data[0].id, numero: Number(data[0].numero) };
  }

  async excluirEnsaio(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').delete().eq('id', id).select('numero');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'eletrica_ensaio_excluido',
      resource_type: 'eletrica_ensaio',
      resource_id: id,
      description: `${admin.name} excluiu o ensaio ${numeroEnsaio(data[0].numero)}`,
    });
  }
}
