import { Injectable, computed, signal } from '@angular/core';
import { fetchAllRows } from '../utils/supabase-pagination';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  AtualizarStatusReparo, CreateReparoExterno, ReparoDefeito, ReparoExterno, ReparoFoto, ReparoGarantia,
  ReparoHistorico, ReparoStatus,
} from '../models/eletrica-reparo.model';
import { REPARO_STATUS_LABEL, comprimirImagem, numeroReparo } from '../utils/eletrica-reparo';
import { removerDaLista, upsertNaLista } from '../utils/lista-local';

const BUCKET = 'eletrica-reparos';

interface ReparoRow {
  id: string;
  numero: number;
  solicitante_id: string | null;
  solicitante_nome: string;
  equipamento: string;
  fabricante_modelo: string | null;
  numero_serie: string | null;
  tag_sap: string | null;
  localizacao: string | null;
  tempo_operacao: string | null;
  resumo: string;
  defeitos: ReparoDefeito[] | null;
  verificacoes: string[] | null;
  verificacao_resultado: string | null;
  data_inicio_sintomas: string | null;
  data_falha_total: string | null;
  intervencoes_anteriores: string | null;
  garantia: string | null;
  servico_solicitado: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  fotos: ReparoFoto[] | null;
  status: string;
  status_observacao: string | null;
  status_atualizado_em: string | null;
  status_atualizado_por: string | null;
  fornecedor: string | null;
  valor_orcamento: number | null;
  nf_remessa: string | null;
  previsao_retorno: string | null;
  teams_enviado_em: string | null;
  created_at: string;
}

interface HistoricoRow {
  id: string;
  status: string;
  observacao: string | null;
  usuario_nome: string | null;
  created_at: string;
}

function mapRow(r: ReparoRow): ReparoExterno {
  return {
    id: r.id,
    numero: Number(r.numero) || 0,
    solicitanteId: r.solicitante_id,
    solicitanteNome: r.solicitante_nome,
    equipamento: r.equipamento,
    fabricanteModelo: r.fabricante_modelo,
    numeroSerie: r.numero_serie,
    tagSap: r.tag_sap,
    localizacao: r.localizacao,
    tempoOperacao: r.tempo_operacao,
    resumo: r.resumo,
    defeitos: r.defeitos ?? [],
    verificacoes: r.verificacoes ?? [],
    verificacaoResultado: r.verificacao_resultado,
    dataInicioSintomas: r.data_inicio_sintomas,
    dataFalhaTotal: r.data_falha_total,
    intervencoesAnteriores: r.intervencoes_anteriores,
    garantia: (r.garantia as ReparoGarantia) || null,
    servicoSolicitado: r.servico_solicitado,
    contatoNome: r.contato_nome,
    contatoTelefone: r.contato_telefone,
    contatoEmail: r.contato_email,
    fotos: r.fotos ?? [],
    status: r.status as ReparoStatus,
    statusObservacao: r.status_observacao,
    statusAtualizadoEm: r.status_atualizado_em ? new Date(r.status_atualizado_em) : null,
    statusAtualizadoPor: r.status_atualizado_por,
    fornecedor: r.fornecedor,
    valorOrcamento: r.valor_orcamento !== null ? Number(r.valor_orcamento) : null,
    nfRemessa: r.nf_remessa,
    previsaoRetorno: r.previsao_retorno,
    teamsEnviadoEm: r.teams_enviado_em ? new Date(r.teams_enviado_em) : null,
    createdAt: new Date(r.created_at),
  };
}

const textoOuNull = (v: string | null | undefined) => v?.trim() || null;

// Mesma ordem do load(): created_at desc, desempate por id.
const ordemReparos = (a: ReparoExterno, b: ReparoExterno) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

@Injectable({ providedIn: 'root' })
export class EletricaReparoService {
  private _reparos = signal<ReparoExterno[]>([]);
  readonly reparos = this._reparos.asReadonly();
  readonly isLoading = signal(false);

  // Supervisor de elétrica (flag no perfil) ou Admin: atualiza status no Controle de Reparos.
  readonly podeControlar = computed(() => {
    const u = this.authService.currentUser();
    return !!u && (u.role === 'Admin' || !!u.supervisor_eletrica);
  });

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const res = await fetchAllRows<ReparoRow>((from, to) => this.supabaseService.client
        .from('eletrica_reparos')
        .select('*')
        .order('created_at', { ascending: false }).order('id').range(from, to));
      if (res.error) throw new Error(res.error.message);
      this._reparos.set(res.data.map(mapRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  async buscar(id: string): Promise<ReparoExterno | null> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_reparos').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRow(data as ReparoRow) : null;
  }

  async historico(id: string): Promise<ReparoHistorico[]> {
    const { data, error } = await this.supabaseService.client
      .from('eletrica_reparos_historico').select('*').eq('reparo_id', id).order('created_at');
    if (error) throw new Error(error.message);
    return ((data ?? []) as HistoricoRow[]).map(h => ({
      id: h.id,
      status: h.status as ReparoStatus,
      observacao: h.observacao,
      usuarioNome: h.usuario_nome,
      createdAt: new Date(h.created_at),
    }));
  }

  // Sobe as fotos (já comprimidas), grava e avisa o supervisor no Teams. Devolve o id.
  async criar(req: CreateReparoExterno, fotos: { file: File; legenda: string }[]): Promise<{ id: string; numero: number }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const fotosSalvas: ReparoFoto[] = [];
    for (const f of fotos) {
      const url = await this.uploadFoto(f.file);
      if (!url) throw new Error('Falha ao enviar uma das fotos. Tente novamente.');
      fotosSalvas.push({ url, legenda: f.legenda.trim() });
    }

    const payload = {
      solicitante_id: user.id,
      solicitante_nome: user.name,
      equipamento: req.equipamento.trim(),
      fabricante_modelo: textoOuNull(req.fabricanteModelo),
      numero_serie: textoOuNull(req.numeroSerie),
      tag_sap: textoOuNull(req.tagSap),
      localizacao: textoOuNull(req.localizacao),
      tempo_operacao: textoOuNull(req.tempoOperacao),
      resumo: req.resumo.trim(),
      defeitos: req.defeitos,
      verificacoes: req.verificacoes,
      verificacao_resultado: textoOuNull(req.verificacaoResultado),
      data_inicio_sintomas: req.dataInicioSintomas || null,
      data_falha_total: req.dataFalhaTotal || null,
      intervencoes_anteriores: textoOuNull(req.intervencoesAnteriores),
      garantia: req.garantia,
      servico_solicitado: req.servicoSolicitado.trim(),
      contato_nome: textoOuNull(req.contatoNome),
      contato_telefone: textoOuNull(req.contatoTelefone),
      contato_email: textoOuNull(req.contatoEmail),
      fotos: fotosSalvas,
    };

    const { data: inserted, error } = await this.supabaseService.client
      .from('eletrica_reparos').insert(payload).select('*').single();
    if (error) throw new Error(error.message);

    // Aviso no Teams do supervisor. Fire-and-forget: se falhar, o reparo continua aberto
    // e aparece no Controle de Reparos do mesmo jeito.
    fetch('/api/fundo-fixo-public-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'eletrica-reparo-notificar', id: inserted.id }),
    }).catch(err => console.error('[eletrica-reparo] Falha ao avisar no Teams:', err));

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'eletrica_reparo_aberto',
      resource_type: 'eletrica_reparo',
      resource_id: inserted.id,
      description: `${user.name} solicitou reparo externo ${numeroReparo(inserted.numero)}: ${payload.equipamento}`,
      metadata: { numero: inserted.numero },
    });

    // Linha devolvida já tem número e defaults do banco; o histórico (trigger) é lido à parte.
    this._reparos.update(l => upsertNaLista(l, mapRow(inserted as ReparoRow), ordemReparos));
    return { id: inserted.id, numero: inserted.numero };
  }

  async atualizarStatus(id: string, dados: AtualizarStatusReparo): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');
    if (!this.podeControlar()) throw new Error('Apenas o supervisor de elétrica pode alterar o status.');

    const { data, error } = await this.supabaseService.client
      .from('eletrica_reparos')
      .update({
        status: dados.status,
        status_observacao: textoOuNull(dados.observacao),
        status_atualizado_em: new Date().toISOString(),
        status_atualizado_por: user.name,
        fornecedor: textoOuNull(dados.fornecedor),
        valor_orcamento: dados.valorOrcamento ?? null,
        nf_remessa: textoOuNull(dados.nfRemessa),
        previsao_retorno: dados.previsaoRetorno || null,
      })
      .eq('id', id)
      .select('*');
    if (error) throw new Error(error.message);
    // RLS barra sem erro: 0 linhas = sem permissão no banco.
    if (!data?.length) throw new Error('Sem permissão para alterar este reparo.');

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'eletrica_reparo_status',
      resource_type: 'eletrica_reparo',
      resource_id: id,
      description: `${user.name} mudou o reparo ${numeroReparo(data[0].numero)} para "${REPARO_STATUS_LABEL[dados.status]}"`,
      metadata: { status: dados.status, observacao: dados.observacao || null },
    });

    this._reparos.update(l => upsertNaLista(l, mapRow(data[0] as ReparoRow), ordemReparos));
  }

  // Só Admin (RLS portal_admin_excluir). O histórico sai junto (ON DELETE CASCADE).
  async excluir(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem excluir.');

    const { data, error } = await this.supabaseService.client
      .from('eletrica_reparos').delete().eq('id', id).select('numero, equipamento');
    if (error) throw new Error(error.message);
    // RLS barra sem erro: 0 linhas = nada foi excluído.
    if (!data?.length) throw new Error('Não foi possível excluir (permissão do banco).');

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'eletrica_reparo_excluido',
      resource_type: 'eletrica_reparo',
      resource_id: id,
      description: `${admin.name} excluiu o reparo externo ${numeroReparo(data[0].numero)}: ${data[0].equipamento}`,
    });

    this._reparos.update(l => removerDaLista(l, id));
  }

  private async uploadFoto(file: File): Promise<string | null> {
    try {
      const blob = await comprimirImagem(file);
      const uid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      const path = `fotos/${uid}.jpg`;
      const { error } = await this.supabaseService.client.storage
        .from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (error) {
        console.error('[EletricaReparoService] Upload error:', error.message);
        return null;
      }
      return this.supabaseService.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    } catch (err) {
      console.error('[EletricaReparoService] Upload exception:', err);
      return null;
    }
  }
}
