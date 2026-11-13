import { Injectable, computed, signal } from '@angular/core';
import { fetchAllRows } from '../utils/supabase-pagination';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { Anexo } from '../models/eletrica-ensaio.model';
import {
  AnaliseVibracao, ColetorInspetor, EquipamentoVibracao, Fundacao, Grandeza, GrupoIso, LeituraVibracao, PontoMedicao, SalvarAnalise,
  SalvarEquipamentoVibracao, SalvarPonto, Situacao, TipoInspecao,
} from '../models/mecanica-vibracao.model';
import { numeroAnalise, statusSugerido } from '../utils/mecanica-vibracao';
import { comprimirImagem } from '../utils/eletrica-reparo';
import { removerDaLista, upsertNaLista } from '../utils/lista-local';

const BUCKET_ANEXOS = 'mecanica-vibracao';

interface EquipamentoRow {
  id: string;
  tag: string;
  descricao: string | null;
  area: string | null;
  tipo_maquina: string | null;
  fabricante: string | null;
  modelo: string | null;
  potencia_kw: number | string | null;
  rotacao_rpm: number | string | null;
  grupo_iso: string | null;
  fundacao: string | null;
  desenho_url: string | null;
  observacoes: string | null;
  criado_por_nome: string | null;
  created_at: string;
  updated_at: string;
}

interface PontoRow {
  id: string;
  equipamento_id: string;
  nome: string;
  descricao: string | null;
  grandeza: string;
  unidade: string;
  alarme_alerta: number | string | null;
  alarme_perigo: number | string | null;
  rolamento: string | null;
  fator_bpfo: number | string | null;
  fator_bpfi: number | string | null;
  fator_bsf: number | string | null;
  fator_ftf: number | string | null;
  ordem: number;
  ativo: boolean;
}

interface AnaliseRow {
  id: string;
  numero: number;
  equipamento_id: string;
  data_coleta: string;
  rotacao_rpm: number | string | null;
  condicao_operacao: string | null;
  os_numero: string | null;
  tipo_inspecao: string | null;
  gestor_area: string | null;
  instrumento: string | null;
  sensor: string | null;
  instrumento_serie: string | null;
  calibracao_validade: string | null;
  leituras: LeituraVibracao[] | null;
  modos_falha: string[] | null;
  diagnostico: string | null;
  recomendacao: string | null;
  conclusao: string | null;
  prazo: string | null;
  situacao: string;
  situacao_sugerida: string | null;
  anexos: Anexo[] | null;
  observacoes: string | null;
  criado_por_id: string | null;
  criado_por_nome: string;
  created_at: string;
  updated_at: string;
}

// NUMERIC chega como string do PostgREST.
const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));
const textoOuNull = (v: string | null | undefined) => v?.trim() || null;

function mapEquipamento(r: EquipamentoRow): EquipamentoVibracao {
  return {
    id: r.id,
    tag: r.tag,
    descricao: r.descricao,
    area: r.area,
    tipoMaquina: r.tipo_maquina,
    fabricante: r.fabricante,
    modelo: r.modelo,
    potenciaKw: num(r.potencia_kw),
    rotacaoRpm: num(r.rotacao_rpm),
    grupoIso: r.grupo_iso as GrupoIso | null,
    fundacao: r.fundacao as Fundacao | null,
    desenhoUrl: r.desenho_url ?? null,
    observacoes: r.observacoes,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function mapPonto(r: PontoRow): PontoMedicao {
  return {
    id: r.id,
    equipamentoId: r.equipamento_id,
    nome: r.nome,
    descricao: r.descricao,
    grandeza: r.grandeza as Grandeza,
    unidade: r.unidade,
    alarmeAlerta: num(r.alarme_alerta),
    alarmePerigo: num(r.alarme_perigo),
    rolamento: r.rolamento,
    fatores: { bpfo: num(r.fator_bpfo), bpfi: num(r.fator_bpfi), bsf: num(r.fator_bsf), ftf: num(r.fator_ftf) },
    ordem: r.ordem,
    ativo: r.ativo,
  };
}

function mapAnalise(r: AnaliseRow): AnaliseVibracao {
  return {
    id: r.id,
    numero: Number(r.numero) || 0,
    equipamentoId: r.equipamento_id,
    dataColeta: r.data_coleta,
    rotacaoRpm: num(r.rotacao_rpm),
    condicaoOperacao: r.condicao_operacao,
    osNumero: r.os_numero,
    tipoInspecao: (r.tipo_inspecao === 'emergencia' ? 'emergencia' : 'programada') as TipoInspecao,
    gestorArea: r.gestor_area,
    instrumento: r.instrumento,
    sensor: r.sensor,
    instrumentoSerie: r.instrumento_serie,
    calibracaoValidade: r.calibracao_validade,
    leituras: r.leituras ?? [],
    modosFalha: r.modos_falha ?? [],
    diagnostico: r.diagnostico,
    recomendacao: r.recomendacao,
    conclusao: r.conclusao,
    prazo: r.prazo,
    situacao: r.situacao as Situacao,
    situacaoSugerida: r.situacao_sugerida as Situacao | null,
    anexos: r.anexos ?? [],
    observacoes: r.observacoes,
    criadoPorId: r.criado_por_id,
    criadoPorNome: r.criado_por_nome,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function payloadEquipamento(e: SalvarEquipamentoVibracao) {
  return {
    tag: e.tag.trim().toUpperCase(),
    descricao: textoOuNull(e.descricao),
    area: textoOuNull(e.area),
    tipo_maquina: textoOuNull(e.tipoMaquina),
    fabricante: textoOuNull(e.fabricante),
    modelo: textoOuNull(e.modelo),
    potencia_kw: e.potenciaKw,
    rotacao_rpm: e.rotacaoRpm,
    grupo_iso: e.grupoIso,
    fundacao: e.fundacao,
    desenho_url: e.desenhoUrl,
    observacoes: textoOuNull(e.observacoes),
  };
}

function payloadPonto(p: SalvarPonto, ordem: number) {
  return {
    nome: p.nome.trim(),
    descricao: textoOuNull(p.descricao),
    grandeza: p.grandeza,
    unidade: p.unidade.trim(),
    alarme_alerta: p.alarmeAlerta,
    alarme_perigo: p.alarmePerigo,
    rolamento: textoOuNull(p.rolamento),
    fator_bpfo: p.fatores.bpfo,
    fator_bpfi: p.fatores.bpfi,
    fator_bsf: p.fatores.bsf,
    fator_ftf: p.fatores.ftf,
    ordem,
    ativo: true,
    updated_at: new Date().toISOString(),
  };
}

// Status escolhido pelo inspetor + a sugestão do portal recalculada aqui (grava as duas).
function payloadAnalise(a: SalvarAnalise, eq: Pick<EquipamentoVibracao, 'grupoIso' | 'fundacao'>) {
  const leituras = a.leituras.filter(l => l.valor !== null);
  if (!leituras.length) throw new Error('Informe o valor de pelo menos um ponto.');
  return {
    equipamento_id: a.equipamentoId,
    data_coleta: a.dataColeta,
    rotacao_rpm: a.rotacaoRpm,
    condicao_operacao: textoOuNull(a.condicaoOperacao),
    os_numero: textoOuNull(a.osNumero),
    tipo_inspecao: a.tipoInspecao,
    gestor_area: textoOuNull(a.gestorArea),
    instrumento: textoOuNull(a.instrumento),
    sensor: textoOuNull(a.sensor),
    instrumento_serie: textoOuNull(a.instrumentoSerie),
    calibracao_validade: a.calibracaoValidade || null,
    leituras: leituras.map(l => ({ ...l, observacao: textoOuNull(l.observacao) })),
    modos_falha: a.modosFalha,
    diagnostico: textoOuNull(a.diagnostico),
    recomendacao: textoOuNull(a.recomendacao),
    conclusao: textoOuNull(a.conclusao),
    prazo: a.prazo || null,
    situacao: a.situacao,
    situacao_sugerida: statusSugerido(leituras, eq.grupoIso, eq.fundacao).situacao,
    anexos: a.anexos,
    observacoes: textoOuNull(a.observacoes),
  };
}

const cmpTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ordemEquipamento = (a: { tag: string; id: string }, b: { tag: string; id: string }) => cmpTexto(a.tag, b.tag) || cmpTexto(a.id, b.id);
const ordemAnalise = (a: { dataColeta: string; numero: number }, b: { dataColeta: string; numero: number }) =>
  cmpTexto(b.dataColeta, a.dataColeta) || b.numero - a.numero;

function mensagemErro(message: string): string {
  if (message.includes('uq_mecanica_equipamentos_tag')) return 'Já existe um equipamento cadastrado com essa TAG.';
  if (message.includes('uq_mecanica_pontos_nome')) return 'Há dois pontos com o mesmo nome neste equipamento.';
  if (message.includes('mecanica_pontos_alarmes_check')) return 'O alarme de perigo tem que ser maior que o de alerta.';
  if (message.includes('row-level security')) return 'Só o inspetor de vibração (ou Admin) pode gravar.';
  return message;
}

@Injectable({ providedIn: 'root' })
export class MecanicaVibracaoService {
  private _equipamentos = signal<EquipamentoVibracao[]>([]);
  private _analises = signal<AnaliseVibracao[]>([]);
  readonly equipamentos = this._equipamentos.asReadonly();
  readonly analises = this._analises.asReadonly();
  readonly isLoading = signal(false);

  readonly isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');
  // Só o inspetor (flag no perfil) ou Admin cadastra e lança.
  readonly podeLancar = computed(() => {
    const u = this.authService.currentUser();
    return !!u && (u.role === 'Admin' || !!u.inspetor_vibracao);
  });

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  private get db() {
    return this.supabaseService.client;
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [equipamentos, analises] = await Promise.all([
        fetchAllRows<EquipamentoRow>((from, to) => this.db.from('mecanica_equipamentos').select('*').order('tag').order('id').range(from, to)),
        fetchAllRows<AnaliseRow>((from, to) => this.db.from('mecanica_analises').select('*')
          .order('data_coleta', { ascending: false }).order('numero', { ascending: false }).range(from, to)),
      ]);
      if (equipamentos.error) throw new Error(equipamentos.error.message);
      if (analises.error) throw new Error(analises.error.message);
      this._equipamentos.set(equipamentos.data.map(mapEquipamento));
      this._analises.set(analises.data.map(mapAnalise));
    } finally {
      this.isLoading.set(false);
    }
  }

  async buscarEquipamento(id: string): Promise<EquipamentoVibracao | null> {
    const { data, error } = await this.db.from('mecanica_equipamentos').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapEquipamento(data as EquipamentoRow) : null;
  }

  // Ativos por padrão; a tendência e a correção de análise antiga precisam dos inativos também.
  async pontosDo(equipamentoId: string, incluirInativos = false): Promise<PontoMedicao[]> {
    let q = this.db.from('mecanica_pontos').select('*').eq('equipamento_id', equipamentoId);
    if (!incluirInativos) q = q.eq('ativo', true);
    const { data, error } = await q.order('ordem').order('nome');
    if (error) throw new Error(error.message);
    return ((data ?? []) as PontoRow[]).map(mapPonto);
  }

  // Do mais antigo pro mais novo (ordem da tendência).
  async analisesDo(equipamentoId: string): Promise<AnaliseVibracao[]> {
    const { data, error } = await this.db.from('mecanica_analises').select('*').eq('equipamento_id', equipamentoId)
      .order('data_coleta').order('numero');
    if (error) throw new Error(error.message);
    return ((data ?? []) as AnaliseRow[]).map(mapAnalise);
  }

  async buscarAnalise(id: string): Promise<AnaliseVibracao | null> {
    const { data, error } = await this.db.from('mecanica_analises').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapAnalise(data as AnaliseRow) : null;
  }

  podeCorrigir(a: Pick<AnaliseVibracao, 'criadoPorId'>): boolean {
    const u = this.authService.currentUser();
    return !!u && (u.role === 'Admin' || (!!u.inspetor_vibracao && a.criadoPorId === u.id));
  }

  // Equipamento + pontos. Ponto tirado da lista: apaga se nunca foi medido; se já tem
  // leitura, só desativa (a tendência antiga continua achando o ponto).
  async salvarEquipamento(dados: SalvarEquipamentoVibracao, pontos: SalvarPonto[], id?: string): Promise<string> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadEquipamento(dados);

    const query = id
      ? this.db.from('mecanica_equipamentos').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('*')
      : this.db.from('mecanica_equipamentos').insert({ ...payload, criado_por_id: user.id, criado_por_nome: user.name }).select('*');
    const { data, error } = await query;
    if (error) throw new Error(mensagemErro(error.message));
    if (!data?.length) throw new Error('Só o inspetor de vibração (ou Admin) pode salvar o equipamento.');
    const equipId = (data[0] as EquipamentoRow).id;

    const existentes = id ? await this.pontosDo(equipId, true) : [];
    const mantidos = new Set(pontos.map(p => p.id).filter((x): x is string => !!x));
    const removidos = existentes.filter(p => p.ativo && !mantidos.has(p.id));
    if (removidos.length) {
      const medidos = new Set((await this.analisesDo(equipId)).flatMap(a => a.leituras.map(l => l.pontoId)));
      const apagar = removidos.filter(p => !medidos.has(p.id)).map(p => p.id);
      const desativar = removidos.filter(p => medidos.has(p.id)).map(p => p.id);
      if (apagar.length) {
        const { error: e } = await this.db.from('mecanica_pontos').delete().in('id', apagar);
        if (e) throw new Error(mensagemErro(e.message));
      }
      if (desativar.length) {
        const { error: e } = await this.db.from('mecanica_pontos').update({ ativo: false, updated_at: new Date().toISOString() }).in('id', desativar);
        if (e) throw new Error(mensagemErro(e.message));
      }
    }
    // Ponto reativado com o mesmo nome de um inativo: reaproveita o inativo (índice único por nome).
    const inativosPorNome = new Map(existentes.filter(p => !p.ativo).map(p => [p.nome.trim().toUpperCase(), p.id]));
    for (const [i, p] of pontos.entries()) {
      const linha = payloadPonto(p, i + 1);
      const alvo = p.id ?? inativosPorNome.get(linha.nome.toUpperCase()) ?? null;
      const { error: e } = alvo
        ? await this.db.from('mecanica_pontos').update(linha).eq('id', alvo)
        : await this.db.from('mecanica_pontos').insert({ ...linha, equipamento_id: equipId });
      if (e) throw new Error(mensagemErro(e.message));
    }

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'vibracao_equipamento_editado' : 'vibracao_equipamento_cadastrado',
      resource_type: 'mecanica_equipamento',
      resource_id: equipId,
      description: `${user.name} ${id ? 'editou' : 'cadastrou'} o equipamento ${payload.tag} (${pontos.length} pontos)`,
    });
    this._equipamentos.update(l => upsertNaLista(l, mapEquipamento(data[0] as EquipamentoRow), ordemEquipamento));
    return equipId;
  }

  async salvarAnalise(dados: SalvarAnalise, equip: Pick<EquipamentoVibracao, 'grupoIso' | 'fundacao'>, id?: string): Promise<{ id: string; numero: number }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    const payload = payloadAnalise(dados, equip);

    const query = id
      ? this.db.from('mecanica_analises').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select('*')
      : this.db.from('mecanica_analises').insert({ ...payload, criado_por_id: user.id, criado_por_nome: user.name }).select('*');
    const { data, error } = await query;
    if (error) throw new Error(mensagemErro(error.message));
    // RLS barra sem erro: 0 linhas = sem permissão.
    if (!data?.length) throw new Error('Só quem lançou a análise (ou Admin) pode corrigi-la.');
    const r = data[0] as AnaliseRow;

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: id ? 'vibracao_analise_editada' : 'vibracao_analise_registrada',
      resource_type: 'mecanica_analise',
      resource_id: r.id,
      description: `${user.name} ${id ? 'corrigiu' : 'registrou'} a análise de vibração ${numeroAnalise(r.numero)} (status ${payload.situacao})`,
      metadata: { numero: r.numero, situacao: payload.situacao, sugerida: payload.situacao_sugerida },
    });
    this._analises.update(l => upsertNaLista(l, mapAnalise(r), ordemAnalise));
    return { id: r.id, numero: Number(r.numero) };
  }

  async excluirAnalise(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');
    const { data, error } = await this.db.from('mecanica_analises').delete().eq('id', id).select('numero');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'vibracao_analise_excluida',
      resource_type: 'mecanica_analise',
      resource_id: id,
      description: `${admin.name} excluiu a análise de vibração ${numeroAnalise(data[0].numero)}`,
    });
    this._analises.update(l => removerDaLista(l, id));
  }

  // Pontos e análises saem junto (ON DELETE CASCADE).
  async excluirEquipamento(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');
    const { data, error } = await this.db.from('mecanica_equipamentos').delete().eq('id', id).select('tag');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'vibracao_equipamento_excluido',
      resource_type: 'mecanica_equipamento',
      resource_id: id,
      description: `${admin.name} excluiu o equipamento ${data[0].tag} e as análises de vibração dele`,
    });
    this._equipamentos.update(l => removerDaLista(l, id));
    this._analises.update(l => l.filter(a => a.equipamentoId !== id));
  }

  // ── Coletor do inspetor (089) ──
  async meuColetor(): Promise<ColetorInspetor | null> {
    const u = this.authService.currentUser();
    if (!u) return null;
    const { data, error } = await this.db.from('mecanica_coletores').select('*').eq('usuario_id', u.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as { coletor: string; sensor: string | null; numero_serie: string | null; calibracao_validade: string | null };
    return { coletor: r.coletor, sensor: r.sensor, numeroSerie: r.numero_serie, calibracaoValidade: r.calibracao_validade };
  }

  async salvarMeuColetor(c: ColetorInspetor): Promise<void> {
    const u = this.authService.currentUser();
    if (!u) throw new Error('Sessão expirada.');
    if (!c.coletor.trim()) throw new Error('Informe o coletor.');
    const { data, error } = await this.db.from('mecanica_coletores').upsert({
      usuario_id: u.id,
      coletor: c.coletor.trim(),
      sensor: textoOuNull(c.sensor),
      numero_serie: textoOuNull(c.numeroSerie),
      calibracao_validade: c.calibracaoValidade || null,
      updated_at: new Date().toISOString(),
    }).select('usuario_id');
    if (error) throw new Error(mensagemErro(error.message));
    if (!data?.length) throw new Error('Só o inspetor de vibração pode salvar o coletor.');
  }

  // Desenho do conjunto com os pontos de coleta (vai no relatório). Devolve a URL pública.
  async subirDesenho(file: File): Promise<string> {
    const uid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    const corpo = await comprimirImagem(file, 2000, 0.9);
    const path = `desenhos/${uid}.jpg`;
    const { error } = await this.db.storage.from(BUCKET_ANEXOS).upload(path, corpo, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Falha ao enviar o desenho: ${error.message}`);
    return this.db.storage.from(BUCKET_ANEXOS).getPublicUrl(path).data.publicUrl;
  }

  // Imagem reduzida antes de subir (print do @ptitude ou foto); PDF vai como está.
  async subirAnexos(lista: { file?: File | null; url?: string | null; nome: string; tipo: Anexo['tipo']; legenda: string }[]): Promise<Anexo[]> {
    const saida: Anexo[] = [];
    for (const a of lista) {
      if (a.url && !a.file) {
        saida.push({ url: a.url, nome: a.nome, tipo: a.tipo, legenda: a.legenda.trim() });
        continue;
      }
      if (!a.file) continue;
      const uid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      const ehPdf = a.tipo === 'pdf';
      // Print de tela tem texto miúdo: lado maior 2400 e qualidade alta.
      const corpo: Blob = ehPdf ? a.file : await comprimirImagem(a.file, 2400, 0.9);
      const path = `anexos/${uid}.${ehPdf ? 'pdf' : 'jpg'}`;
      const { error } = await this.db.storage.from(BUCKET_ANEXOS).upload(path, corpo, { contentType: ehPdf ? 'application/pdf' : 'image/jpeg' });
      if (error) throw new Error(`Falha ao enviar o anexo "${a.nome}": ${error.message}`);
      saida.push({
        url: this.db.storage.from(BUCKET_ANEXOS).getPublicUrl(path).data.publicUrl,
        nome: a.nome, tipo: a.tipo, legenda: a.legenda.trim(),
      });
    }
    return saida;
  }
}
