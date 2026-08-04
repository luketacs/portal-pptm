import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  CreateFundoFixoRequest, CreateFundoFixoSaque, FundoFixoFormaPagamento, FundoFixoSaque, FundoFixoSaqueTipo,
  FundoFixoSetor, FundoFixoSolicitacao, FundoFixoStatus,
} from '../models/fundo-fixo.model';
import { calcularSaldoCaixa, calcularTotalComprometidoMes } from '../utils/fundo-fixo-calc';

export const FUNDO_FIXO_LIMITE_MENSAL = 3000;
export const FUNDO_FIXO_LIMITE_POR_COMPRA = 500;
export const FUNDO_FIXO_SETORES: FundoFixoSetor[] = ['Manutenção', 'Operação', 'Infraestrutura', 'Outros'];
// Gestores responsáveis fora do portal — só informativo (aparece em listas/relatórios).
// A aprovação de fato no sistema é feita só pelo Admin, por enquanto.
export const FUNDO_FIXO_GESTORES: string[] = ['Charles Rabelo', 'João Nunes'];

interface FundoFixoRow {
  id: string;
  solicitante_id: string | null;
  solicitante_nome: string;
  setor: string;
  fornecedor: string | null;
  material: string;
  link_produto: string | null;
  valor_estimado: number;
  valor_final: number | null;
  forma_pagamento: string;
  orcamento_url: string | null;
  nota_fiscal_url: string | null;
  observacoes: string | null;
  status: string;
  aprovador_id: string | null;
  aprovador_nome: string | null;
  motivo_recusa: string | null;
  comprador_id: string | null;
  comprador_nome: string | null;
  gestor_aprovador: string | null;
  mes_referencia: string;
  data_solicitacao: string;
  data_aprovacao: string | null;
  data_compra: string | null;
}

interface FundoFixoSaqueRow {
  id: string;
  valor: number;
  taxa: number | null;
  tipo: string;
  data_saque: string;
  mes_referencia: string;
  observacoes: string | null;
  registrado_por_id: string | null;
  registrado_por_nome: string;
  created_at: string;
}

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mapRow(r: FundoFixoRow): FundoFixoSolicitacao {
  return {
    id: r.id,
    solicitanteId: r.solicitante_id,
    solicitanteNome: r.solicitante_nome,
    setor: r.setor as FundoFixoSetor,
    fornecedor: r.fornecedor,
    material: r.material,
    linkProduto: r.link_produto,
    valorEstimado: Number(r.valor_estimado) || 0,
    valorFinal: r.valor_final !== null ? Number(r.valor_final) : null,
    formaPagamento: (r.forma_pagamento as FundoFixoFormaPagamento) || 'cartao',
    orcamentoUrl: r.orcamento_url,
    notaFiscalUrl: r.nota_fiscal_url,
    observacoes: r.observacoes,
    status: r.status as FundoFixoStatus,
    aprovadorId: r.aprovador_id,
    aprovadorNome: r.aprovador_nome,
    motivoRecusa: r.motivo_recusa,
    compradorId: r.comprador_id,
    compradorNome: r.comprador_nome,
    gestorAprovador: r.gestor_aprovador,
    mesReferencia: r.mes_referencia,
    dataSolicitacao: new Date(r.data_solicitacao),
    dataAprovacao: r.data_aprovacao ? new Date(r.data_aprovacao) : null,
    dataCompra: r.data_compra ? new Date(r.data_compra) : null,
  };
}

function mapSaqueRow(r: FundoFixoSaqueRow): FundoFixoSaque {
  return {
    id: r.id,
    valor: Number(r.valor) || 0,
    taxa: r.taxa !== null ? Number(r.taxa) : null,
    tipo: (r.tipo as FundoFixoSaqueTipo) || 'saque',
    dataSaque: new Date(r.data_saque + 'T00:00:00'),
    mesReferencia: r.mes_referencia,
    observacoes: r.observacoes,
    registradoPorId: r.registrado_por_id,
    registradoPorNome: r.registrado_por_nome,
    createdAt: new Date(r.created_at),
  };
}

@Injectable({ providedIn: 'root' })
export class FundoFixoService {
  private _solicitacoes = signal<FundoFixoSolicitacao[]>([]);
  solicitacoes = this._solicitacoes.asReadonly();
  private _saques = signal<FundoFixoSaque[]>([]);
  saques = this._saques.asReadonly();
  isLoading = signal(false);

  mesAtual = computed(() => mesAtual());

  saldoCaixa = computed(() => calcularSaldoCaixa(this._saques(), this._solicitacoes()));

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [solicitacoesRes, saquesRes] = await Promise.all([
        this.supabaseService.client
          .from('fundo_fixo_solicitacoes')
          .select('*')
          .order('data_solicitacao', { ascending: false }),
        this.supabaseService.client
          .from('fundo_fixo_saques')
          .select('*')
          .order('data_saque', { ascending: false }),
      ]);
      if (solicitacoesRes.error) throw new Error(solicitacoesRes.error.message);
      if (saquesRes.error) throw new Error(saquesRes.error.message);
      this._solicitacoes.set((solicitacoesRes.data ?? []).map(mapRow));
      this._saques.set((saquesRes.data ?? []).map(mapSaqueRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  getById(id: string): FundoFixoSolicitacao | undefined {
    return this._solicitacoes().find(s => s.id === id);
  }

  totalComprometidoMes(mes: string): number {
    return calcularTotalComprometidoMes(this._solicitacoes(), this._saques(), mes);
  }

  async excluir(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const item = this.getById(id);
    const { data, error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    // Sem a política de DELETE no banco, o RLS bloqueia a exclusão sem retornar erro —
    // 0 linhas afetadas é o único sinal de que nada foi realmente excluído.
    if (!data || data.length === 0) {
      throw new Error('Não foi possível excluir (permissão do banco). Verifique se a migration 012_fundo_fixo_caixa.sql foi executada no Supabase.');
    }

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_excluido',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} excluiu solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''}: ${item?.material ?? ''}`,
    });

    await this.load();
  }

  async registrarSaque(req: CreateFundoFixoSaque): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const dataSaque = req.dataSaque || new Date().toISOString().slice(0, 10);
    const payload = {
      valor: req.valor,
      taxa: req.tipo === 'ajuste_inicial' ? null : (req.taxa ?? null),
      tipo: req.tipo ?? 'saque',
      data_saque: dataSaque,
      mes_referencia: dataSaque.slice(0, 7),
      observacoes: req.observacoes?.trim() || null,
      registrado_por_id: admin.id,
      registrado_por_nome: admin.name,
    };

    const { error } = await this.supabaseService.client.from('fundo_fixo_saques').insert(payload);
    if (error) throw new Error(error.message);

    const descricao = req.tipo === 'ajuste_inicial'
      ? `${admin.name} registrou saldo inicial em caixa de R$ ${req.valor.toFixed(2)} no Fundo Fixo`
      : `${admin.name} registrou saque de R$ ${req.valor.toFixed(2)}${req.taxa != null ? ` (taxa R$ ${req.taxa.toFixed(2)})` : ' (taxa a definir)'} no Fundo Fixo`;
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_saque_registrado',
      resource_type: 'fundo_fixo_saque',
      description: descricao,
      metadata: { valor: req.valor, taxa: req.taxa ?? null, tipo: req.tipo ?? 'saque' },
    });

    await this.load();
  }

  async atualizarTaxaSaque(id: string, taxa: number): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_saques')
      .update({ taxa })
      .eq('id', id);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_saque_registrado',
      resource_type: 'fundo_fixo_saque',
      resource_id: id,
      description: `${admin.name} informou a taxa de R$ ${taxa.toFixed(2)} de um saque do Fundo Fixo`,
      metadata: { taxa },
    });

    await this.load();
  }

  async excluirSaque(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { data, error } = await this.supabaseService.client
      .from('fundo_fixo_saques')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error('Não foi possível excluir o saque (permissão do banco). Verifique se a migration 013 foi executada no Supabase.');
    }

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_saque_excluido',
      resource_type: 'fundo_fixo_saque',
      resource_id: id,
      description: `${admin.name} excluiu um saque do Fundo Fixo`,
    });

    await this.load();
  }

  async criarSolicitacao(req: CreateFundoFixoRequest, orcamento: File | null): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    let orcamentoUrl: string | null = null;
    if (orcamento) {
      orcamentoUrl = await this.uploadAnexo(orcamento, 'orcamentos');
      if (!orcamentoUrl) throw new Error('Falha ao enviar o orçamento. Tente novamente.');
    }

    // Só Admin pode registrar em nome de outra pessoa ou direcionar o comprador.
    const podeDirecionar = user.role === 'Admin';
    const solicitanteId = podeDirecionar && req.solicitanteId ? req.solicitanteId : user.id;
    const solicitanteNome = podeDirecionar && req.solicitanteNome ? req.solicitanteNome : user.name;

    const payload = {
      solicitante_id: solicitanteId,
      solicitante_nome: solicitanteNome,
      setor: req.setor,
      fornecedor: req.fornecedor?.trim() || null,
      material: req.material.trim(),
      link_produto: req.linkProduto?.trim() || null,
      valor_estimado: req.valorEstimado,
      orcamento_url: orcamentoUrl,
      observacoes: req.observacoes?.trim() || null,
      status: 'pendente',
      gestor_aprovador: req.gestorAprovador?.trim() || null,
      comprador_id: podeDirecionar ? (req.compradorId ?? null) : null,
      comprador_nome: podeDirecionar ? (req.compradorNome ?? null) : null,
      mes_referencia: mesAtual(),
    };

    const { error } = await this.supabaseService.client.from('fundo_fixo_solicitacoes').insert(payload);
    if (error) throw new Error(error.message);

    const descricaoEmNomeDe = solicitanteId !== user.id ? ` em nome de ${solicitanteNome}` : '';
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_solicitado',
      resource_type: 'fundo_fixo',
      description: `${user.name} solicitou compra via Fundo Fixo${descricaoEmNomeDe}: ${req.material} (R$ ${req.valorEstimado.toFixed(2)})`,
      metadata: { setor: req.setor, valor_estimado: req.valorEstimado, comprador_id: payload.comprador_id },
    });

    await this.load();
  }

  async atribuirComprador(id: string, compradorId: string, compradorNome: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update({ comprador_id: compradorId, comprador_nome: compradorNome })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_comprador_atribuido',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} direcionou a compra de ${item?.material ?? ''} para ${compradorNome}`,
    });

    await this.load();
  }

  async aprovar(id: string, gestorAprovador: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update({
        status: 'aprovado',
        aprovador_id: admin.id,
        aprovador_nome: admin.name,
        gestor_aprovador: gestorAprovador,
        data_aprovacao: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_aprovado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} aprovou solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''} (gestor: ${gestorAprovador}): ${item?.material ?? ''}`,
      metadata: { gestor_aprovador: gestorAprovador },
    });

    await this.load();
  }

  async recusar(id: string, motivo: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update({
        status: 'recusado',
        aprovador_id: admin.id,
        aprovador_nome: admin.name,
        data_aprovacao: new Date().toISOString(),
        motivo_recusa: motivo.trim() || null,
      })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_recusado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} recusou solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''}: ${item?.material ?? ''}`,
    });

    await this.load();
  }

  async marcarComprado(
    id: string, notaFiscal: File, valorFinal: number, formaPagamento: FundoFixoFormaPagamento, fornecedor?: string,
  ): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const notaFiscalUrl = await this.uploadAnexo(notaFiscal, 'notas-fiscais');
    if (!notaFiscalUrl) throw new Error('Falha ao enviar a nota fiscal. Tente novamente.');

    const payload: Record<string, unknown> = {
      status: 'comprado',
      nota_fiscal_url: notaFiscalUrl,
      valor_final: valorFinal,
      forma_pagamento: formaPagamento,
      data_compra: new Date().toISOString(),
    };
    if (fornecedor?.trim()) payload['fornecedor'] = fornecedor.trim();

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_comprado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${user.name} registrou compra via Fundo Fixo: ${item?.material ?? ''} (R$ ${valorFinal.toFixed(2)})`,
    });

    await this.load();
  }

  // Admin pode corrigir a forma de pagamento mesmo depois da nota fiscal já anexada
  // (ex.: registrou como cartão por engano, mas foi pago em dinheiro do caixa).
  async atualizarFormaPagamento(id: string, formaPagamento: FundoFixoFormaPagamento): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update({ forma_pagamento: formaPagamento })
      .eq('id', id);
    if (error) throw new Error(error.message);

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_comprado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} alterou a forma de pagamento de ${item?.material ?? ''} para ${formaPagamento}`,
      metadata: { forma_pagamento: formaPagamento },
    });

    await this.load();
  }

  private async uploadAnexo(file: File, subpasta: 'orcamentos' | 'notas-fiscais'): Promise<string | null> {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const uid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      const path = `${subpasta}/${uid}.${ext}`;

      const { error } = await this.supabaseService.client.storage
        .from('fundo-fixo-anexos')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });

      if (error) {
        console.error('[FundoFixoService] Upload error:', error.message);
        return null;
      }

      const { data } = this.supabaseService.client.storage.from('fundo-fixo-anexos').getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      console.error('[FundoFixoService] Upload exception:', err);
      return null;
    }
  }
}
