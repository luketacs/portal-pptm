import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  CreateFundoFixoRequest, FundoFixoSetor, FundoFixoSolicitacao, FundoFixoStatus,
} from '../models/fundo-fixo.model';

export const FUNDO_FIXO_LIMITE_MENSAL = 3000;
export const FUNDO_FIXO_SETORES: FundoFixoSetor[] = ['Manutenção', 'Operação', 'Infraestrutura', 'Outros'];

interface FundoFixoRow {
  id: string;
  solicitante_id: string | null;
  solicitante_nome: string;
  setor: string;
  fornecedor: string | null;
  material: string;
  valor_estimado: number;
  valor_final: number | null;
  orcamento_url: string | null;
  nota_fiscal_url: string | null;
  observacoes: string | null;
  status: string;
  aprovador_id: string | null;
  aprovador_nome: string | null;
  motivo_recusa: string | null;
  mes_referencia: string;
  data_solicitacao: string;
  data_aprovacao: string | null;
  data_compra: string | null;
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
    valorEstimado: Number(r.valor_estimado) || 0,
    valorFinal: r.valor_final !== null ? Number(r.valor_final) : null,
    orcamentoUrl: r.orcamento_url,
    notaFiscalUrl: r.nota_fiscal_url,
    observacoes: r.observacoes,
    status: r.status as FundoFixoStatus,
    aprovadorId: r.aprovador_id,
    aprovadorNome: r.aprovador_nome,
    motivoRecusa: r.motivo_recusa,
    mesReferencia: r.mes_referencia,
    dataSolicitacao: new Date(r.data_solicitacao),
    dataAprovacao: r.data_aprovacao ? new Date(r.data_aprovacao) : null,
    dataCompra: r.data_compra ? new Date(r.data_compra) : null,
  };
}

@Injectable({ providedIn: 'root' })
export class FundoFixoService {
  private _solicitacoes = signal<FundoFixoSolicitacao[]>([]);
  solicitacoes = this._solicitacoes.asReadonly();
  isLoading = signal(false);

  mesAtual = computed(() => mesAtual());

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService,
  ) {}

  async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabaseService.client
        .from('fundo_fixo_solicitacoes')
        .select('*')
        .order('data_solicitacao', { ascending: false });
      if (error) throw new Error(error.message);
      this._solicitacoes.set((data ?? []).map(mapRow));
    } finally {
      this.isLoading.set(false);
    }
  }

  getById(id: string): FundoFixoSolicitacao | undefined {
    return this._solicitacoes().find(s => s.id === id);
  }

  // Total comprometido no mês (aprovado + comprado) — o que já saiu ou vai sair do limite.
  // Usa valorFinal quando já disponível (nota fiscal anexada), senão o valor estimado.
  totalComprometidoMes(mes: string): number {
    return this._solicitacoes()
      .filter(s => s.mesReferencia === mes && (s.status === 'aprovado' || s.status === 'comprado'))
      .reduce((sum, s) => sum + (s.valorFinal ?? s.valorEstimado), 0);
  }

  async criarSolicitacao(req: CreateFundoFixoRequest, orcamento: File | null): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    let orcamentoUrl: string | null = null;
    if (orcamento) {
      orcamentoUrl = await this.uploadAnexo(orcamento, 'orcamentos');
      if (!orcamentoUrl) throw new Error('Falha ao enviar o orçamento. Tente novamente.');
    }

    const payload = {
      solicitante_id: user.id,
      solicitante_nome: user.name,
      setor: req.setor,
      fornecedor: req.fornecedor?.trim() || null,
      material: req.material.trim(),
      valor_estimado: req.valorEstimado,
      orcamento_url: orcamentoUrl,
      observacoes: req.observacoes?.trim() || null,
      status: 'pendente',
      mes_referencia: mesAtual(),
    };

    const { error } = await this.supabaseService.client.from('fundo_fixo_solicitacoes').insert(payload);
    if (error) throw new Error(error.message);

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_solicitado',
      resource_type: 'fundo_fixo',
      description: `${user.name} solicitou compra via Fundo Fixo: ${req.material} (R$ ${req.valorEstimado.toFixed(2)})`,
      metadata: { setor: req.setor, valor_estimado: req.valorEstimado },
    });

    await this.load();
  }

  async aprovar(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');

    const { error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update({
        status: 'aprovado',
        aprovador_id: admin.id,
        aprovador_nome: admin.name,
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
      description: `${admin.name} aprovou solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''}: ${item?.material ?? ''}`,
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

  async marcarComprado(id: string, notaFiscal: File, valorFinal: number, fornecedor?: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const notaFiscalUrl = await this.uploadAnexo(notaFiscal, 'notas-fiscais');
    if (!notaFiscalUrl) throw new Error('Falha ao enviar a nota fiscal. Tente novamente.');

    const payload: Record<string, unknown> = {
      status: 'comprado',
      nota_fiscal_url: notaFiscalUrl,
      valor_final: valorFinal,
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
