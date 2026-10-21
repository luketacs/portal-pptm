import { Injectable, computed, signal } from '@angular/core';
import { fetchAllRows } from '../utils/supabase-pagination';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  ClasseIsolamento, EnsaioIsolamento, Executante, LeituraIsolamento, Motor, ResultadoEnsaio, SalvarEnsaio, SalvarMotor,
  SituacaoEquipamento, TipoBobina,
} from '../models/eletrica-ensaio.model';
import {
  CriterioTrafo, EnsaioTrafo, LeituraIsolamentoTrafo, Ligacao, MaterialEnrolamento, MeioIsolante, OhmicaEnrolamento,
  SalvarEnsaioTrafo, SalvarTransformador, Secundario, Transformador, TtrSecundario,
} from '../models/eletrica-trafo.model';
import { avaliarEnsaio, criterioDoEnsaio, numeroEnsaio } from '../utils/eletrica-ensaio';
import { avaliarTrafo } from '../utils/eletrica-trafo';

// Linha de eletrica_equipamentos — motor e trafo na mesma tabela (colunas do outro tipo vêm null).
interface MotorRow {
  id: string;
  tipo: string;
  tag: string;
  situacao: string | null; // 082
  aplicacao: string | null;
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
  // Transformador (081)
  potencia_kva: number | string | null;
  ligacao_primaria: string | null;
  secundarios: Secundario[] | null;
  meio_isolante: string | null;
  material_enrolamento: string | null;
  relacao_taps: string | null;
  refrigeracao: string | null;
  grau_protecao: string | null;
  classe_ambiental: string | null;
  norma_fabricacao: string | null;
  codigo_produto: string | null;
  elevacao_temperatura_c: number | string | null;
  massa_kg: number | string | null;
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
  // Transformador (081)
  tipo: string;
  ohmica: OhmicaEnrolamento[] | null;
  ttr: TtrSecundario[] | null;
  criterio: CriterioTrafo | null;
}

// NUMERIC chega como string do PostgREST.
const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));

function mapMotor(r: MotorRow): Motor {
  return {
    id: r.id,
    tag: r.tag,
    situacao: (r.situacao ?? 'instalado') as SituacaoEquipamento,
    aplicacao: r.aplicacao,
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

function mapTrafo(r: MotorRow): Transformador {
  return {
    id: r.id,
    tag: r.tag,
    situacao: (r.situacao ?? 'instalado') as SituacaoEquipamento,
    aplicacao: r.aplicacao,
    descricao: r.descricao,
    localInstalacao: r.local_instalacao,
    fabricante: r.fabricante,
    modelo: r.modelo,
    numeroSerie: r.numero_serie,
    codigoProduto: r.codigo_produto,
    normaFabricacao: r.norma_fabricacao,
    potenciaKva: num(r.potencia_kva),
    tensaoPrimariaV: Number(r.tensao_v),
    ligacaoPrimaria: (r.ligacao_primaria ?? 'D') as Ligacao,
    secundarios: (r.secundarios ?? []).map(x => ({ ...x, tensaoV: Number(x.tensaoV) })),
    frequenciaHz: num(r.frequencia_hz),
    relacaoTaps: r.relacao_taps,
    meioIsolante: (r.meio_isolante ?? 'seco') as MeioIsolante,
    materialEnrolamento: (r.material_enrolamento ?? 'cobre') as MaterialEnrolamento,
    classeIsolamento: r.classe_isolamento as ClasseIsolamento,
    elevacaoTemperaturaC: num(r.elevacao_temperatura_c),
    refrigeracao: r.refrigeracao,
    grauProtecao: r.grau_protecao,
    classeAmbiental: r.classe_ambiental,
    massaKg: num(r.massa_kg),
    observacoes: r.observacoes,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function mapEnsaioTrafo(r: EnsaioRow): EnsaioTrafo {
  return {
    id: r.id,
    numero: Number(r.numero) || 0,
    equipamentoId: r.equipamento_id,
    dataEnsaio: r.data_ensaio,
    osNumero: r.os_numero,
    instrumento: r.instrumento,
    instrumentoModelo: r.instrumento_modelo,
    temperaturaAmbienteC: Number(r.temperatura_ambiente_c),
    temperaturaEnrolamentoC: num(r.temperatura_enrolamento_c),
    umidadePct: num(r.umidade_pct),
    criterio: r.criterio as CriterioTrafo,
    isolamento: (r.medicoes ?? []) as unknown as LeituraIsolamentoTrafo[],
    ohmica: r.ohmica ?? [],
    ttr: r.ttr ?? [],
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

function payloadTrafo(t: SalvarTransformador) {
  return {
    tag: t.tag.trim().toUpperCase(),
    situacao: t.situacao,
    aplicacao: textoOuNull(t.aplicacao),
    descricao: textoOuNull(t.descricao),
    local_instalacao: textoOuNull(t.localInstalacao),
    fabricante: textoOuNull(t.fabricante),
    modelo: textoOuNull(t.modelo),
    numero_serie: textoOuNull(t.numeroSerie),
    codigo_produto: textoOuNull(t.codigoProduto),
    norma_fabricacao: textoOuNull(t.normaFabricacao),
    potencia_kva: t.potenciaKva,
    tensao_v: t.tensaoPrimariaV,
    ligacao_primaria: t.ligacaoPrimaria,
    secundarios: t.secundarios.map(s => ({ nome: s.nome.trim().toUpperCase(), tensaoV: s.tensaoV, ligacao: s.ligacao })),
    frequencia_hz: t.frequenciaHz,
    relacao_taps: textoOuNull(t.relacaoTaps),
    meio_isolante: t.meioIsolante,
    material_enrolamento: t.materialEnrolamento,
    classe_isolamento: t.classeIsolamento,
    elevacao_temperatura_c: t.elevacaoTemperaturaC,
    refrigeracao: textoOuNull(t.refrigeracao),
    grau_protecao: textoOuNull(t.grauProtecao),
    classe_ambiental: textoOuNull(t.classeAmbiental),
    massa_kg: t.massaKg,
    observacoes: textoOuNull(t.observacoes),
  };
}

// Resultado recalculado aqui pela norma, como no motor.
function payloadEnsaioTrafo(e: SalvarEnsaioTrafo) {
  const { resultado } = avaliarTrafo(e);
  if (!resultado) throw new Error('Faltam leituras obrigatórias para concluir o ensaio.');
  const tensoes = e.isolamento.map(l => l.tensaoV ?? 0);
  return {
    tipo: 'transformador',
    equipamento_id: e.equipamentoId,
    data_ensaio: e.dataEnsaio,
    os_numero: textoOuNull(e.osNumero),
    instrumento: textoOuNull(e.instrumento),
    instrumento_modelo: textoOuNull(e.instrumentoModelo),
    // Coluna da 080 (obrigatória): a maior tensão aplicada no isolamento; cada circuito
    // tem a sua em medicoes[].tensaoV.
    tensao_aplicada_v: Math.max(...tensoes, 0) || e.criterio.tensaoPrimariaV,
    temperatura_ambiente_c: e.temperaturaAmbienteC,
    temperatura_enrolamento_c: e.temperaturaEnrolamentoC,
    umidade_pct: e.umidadePct,
    tensao_nominal_v: e.criterio.tensaoPrimariaV,
    classe_isolamento: e.criterio.classeIsolamento,
    tipo_bobina: null,
    criterio: e.criterio,
    medicoes: e.isolamento,
    ohmica: e.ohmica,
    ttr: e.ttr,
    resultado,
    executantes: e.executantes.filter(x => x.nome.trim()).map(x => ({ nome: x.nome.trim(), matricula: x.matricula.trim() })),
    observacoes: textoOuNull(e.observacoes),
  };
}

function payloadMotor(m: SalvarMotor) {
  return {
    tag: m.tag.trim().toUpperCase(),
    situacao: m.situacao,
    aplicacao: textoOuNull(m.aplicacao),
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
  if (message.includes('uq_eletrica_equipamentos_tag')) return 'Já existe um equipamento cadastrado com essa TAG.';
  return message;
}

@Injectable({ providedIn: 'root' })
export class EletricaEnsaioService {
  private _motores = signal<Motor[]>([]);
  private _ensaios = signal<EnsaioIsolamento[]>([]);
  private _trafos = signal<Transformador[]>([]);
  private _ensaiosTrafo = signal<EnsaioTrafo[]>([]);
  readonly motores = this._motores.asReadonly();
  readonly ensaios = this._ensaios.asReadonly();
  readonly trafos = this._trafos.asReadonly();
  readonly ensaiosTrafo = this._ensaiosTrafo.asReadonly();
  readonly isLoading = signal(false);

  readonly isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  // Equipamentos + todos os ensaios (a lista mostra o último de cada TAG; são poucos por ano).
  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [motores, ensaios] = await Promise.all([
        fetchAllRows<MotorRow>((from, to) => this.supabaseService.client
          .from('eletrica_equipamentos').select('*')
          .order('tag').order('id').range(from, to)),
        fetchAllRows<EnsaioRow>((from, to) => this.supabaseService.client
          .from('eletrica_ensaios').select('*')
          .order('data_ensaio', { ascending: false }).order('numero', { ascending: false }).range(from, to)),
      ]);
      if (motores.error) throw new Error(motores.error.message);
      if (ensaios.error) throw new Error(ensaios.error.message);
      this._motores.set(motores.data.filter(r => r.tipo === 'motor').map(mapMotor));
      this._trafos.set(motores.data.filter(r => r.tipo === 'transformador').map(mapTrafo));
      this._ensaios.set(ensaios.data.filter(r => r.tipo !== 'transformador').map(mapEnsaio));
      this._ensaiosTrafo.set(ensaios.data.filter(r => r.tipo === 'transformador').map(mapEnsaioTrafo));
    } finally {
      this.isLoading.set(false);
    }
  }

  async buscarMotor(id: string): Promise<Motor | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_equipamentos').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data && (data as MotorRow).tipo === 'motor' ? mapMotor(data as MotorRow) : null;
  }

  async buscarTrafo(id: string): Promise<Transformador | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_equipamentos').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data && (data as MotorRow).tipo === 'transformador' ? mapTrafo(data as MotorRow) : null;
  }

  async ensaiosDoTrafo(equipamentoId: string): Promise<EnsaioTrafo[]> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').select('*').eq('equipamento_id', equipamentoId)
      .order('data_ensaio').order('numero');
    if (error) throw new Error(error.message);
    return ((data ?? []) as EnsaioRow[]).map(mapEnsaioTrafo);
  }

  async buscarEnsaioTrafo(id: string): Promise<EnsaioTrafo | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data && (data as EnsaioRow).tipo === 'transformador' ? mapEnsaioTrafo(data as EnsaioRow) : null;
  }

  // Link genérico ou antigo cai na tela certa.
  async tipoDoEnsaio(id: string): Promise<'motor' | 'transformador' | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_ensaios').select('tipo').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return (data as { tipo: string }).tipo === 'transformador' ? 'transformador' : 'motor';
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
    return data && (data as EnsaioRow).tipo !== 'transformador' ? mapEnsaio(data as EnsaioRow) : null;
  }

  podeCorrigir(e: Pick<EnsaioIsolamento, 'criadoPorId'>): boolean {
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

  async salvarTrafo(dados: SalvarTransformador, id?: string): Promise<string> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadTrafo(dados);

    const query = id
      ? this.supabaseService.client.from('eletrica_equipamentos')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('id')
      : this.supabaseService.client.from('eletrica_equipamentos')
        .insert({ ...payload, tipo: 'transformador', criado_por_id: user.id, criado_por_nome: user.name }).select('id');
    const { data, error } = await query;
    if (error) throw new Error(mensagemErro(error.message));
    if (!data?.length) throw new Error('Sem permissão para salvar o transformador.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'eletrica_trafo_editado' : 'eletrica_trafo_cadastrado',
      resource_type: 'eletrica_equipamento',
      resource_id: data[0].id,
      description: `${user.name} ${id ? 'editou' : 'cadastrou'} o transformador ${payload.tag}`,
    });
    return data[0].id;
  }

  async salvarEnsaioTrafo(dados: SalvarEnsaioTrafo, id?: string): Promise<{ id: string; numero: number }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadEnsaioTrafo(dados);

    const query = id
      ? this.supabaseService.client.from('eletrica_ensaios')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('id, numero')
      : this.supabaseService.client.from('eletrica_ensaios')
        .insert({ ...payload, criado_por_id: user.id, criado_por_nome: user.name }).select('id, numero');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Só quem lançou o ensaio (ou Admin) pode corrigi-lo.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'eletrica_ensaio_editado' : 'eletrica_ensaio_registrado',
      resource_type: 'eletrica_ensaio',
      resource_id: data[0].id,
      description: `${user.name} ${id ? 'corrigiu' : 'registrou'} o ensaio de transformador ${numeroEnsaio(data[0].numero)} (${payload.resultado})`,
      metadata: { numero: data[0].numero, resultado: payload.resultado, tipo: 'transformador' },
    });
    return { id: data[0].id, numero: Number(data[0].numero) };
  }

  // Só Admin (RLS portal_admin_excluir). Os ensaios do equipamento saem junto (ON DELETE CASCADE).
  async excluirEquipamento(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');
    const { data, error } = await this.supabaseService.client
      .from('eletrica_equipamentos').delete().eq('id', id).select('tag, tipo');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: data[0].tipo === 'transformador' ? 'eletrica_trafo_excluido' : 'eletrica_motor_excluido',
      resource_type: 'eletrica_equipamento',
      resource_id: id,
      description: `${admin.name} excluiu o ${data[0].tipo === 'transformador' ? 'transformador' : 'motor'} ${data[0].tag} e os ensaios dele`,
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
