import { fetchAllRows } from '../utils/supabase-pagination';
import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import {
  CreateFundoFixoRequest, CreateFundoFixoSaque, FundoFixoFormaPagamento, FundoFixoSaque, FundoFixoSaqueTipo,
  FundoFixoSetor, FundoFixoSolicitacao, FundoFixoStatus,
} from '../models/fundo-fixo.model';
import { calcularSaldoCaixa, calcularTotalComprometidoMes, numeroFundoFixo, proximoMes } from '../utils/fundo-fixo-calc';
import { removerDaLista, upsertNaLista } from '../utils/lista-local';

export const FUNDO_FIXO_LIMITE_MENSAL = 3000;
export const FUNDO_FIXO_LIMITE_POR_COMPRA = 500;
export const FUNDO_FIXO_SETORES: FundoFixoSetor[] = ['Manutenção', 'Operação', 'Infraestrutura', 'Outros'];
// Gestores responsáveis fora do portal — aprovam pelo Teams (Power Automate, ver
// docs/FUNDO-FIXO-TEAMS.md); o Admin também pode aprovar direto no portal.
// A partir de set/2026: Italo Rosse no lugar de Charles Rabelo (registros antigos
// continuam com o nome gravado; setembro em diante corrigido na migration 066).
export const FUNDO_FIXO_GESTORES: string[] = ['Italo Rosse', 'João Nunes'];
// Gestor que recebe a aprovação no Teams, por setor ('Outros' fica com o Admin no portal).
// Precisa ficar em sincronia com GESTOR_POR_SETOR em api/_fundo-fixo-teams-shared.js
export const FUNDO_FIXO_GESTOR_POR_SETOR: Partial<Record<FundoFixoSetor, string>> = {
  'Operação': 'João Nunes',
  'Manutenção': 'Italo Rosse',
  'Infraestrutura': 'Italo Rosse',
};

interface FundoFixoRow {
  id: string;
  numero: number;
  solicitante_id: string | null;
  solicitante_nome: string;
  setor: string;
  fornecedor: string | null;
  material: string;
  link_produto: string | null;
  valor_estimado: number;
  valor_final: number | null;
  forma_pagamento: string;
  forma_pagamento_secundaria: string | null;
  valor_final_secundario: number | null;
  orcamento_url: string | null;
  nota_fiscal_urls: string[] | null;
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
  reembolsado: boolean | null;
  data_reembolso: string | null;
  teams_enviado_em: string | null;
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
    numero: Number(r.numero) || 0,
    solicitanteId: r.solicitante_id,
    solicitanteNome: r.solicitante_nome,
    setor: r.setor as FundoFixoSetor,
    fornecedor: r.fornecedor,
    material: r.material,
    linkProduto: r.link_produto,
    valorEstimado: Number(r.valor_estimado) || 0,
    valorFinal: r.valor_final !== null ? Number(r.valor_final) : null,
    formaPagamento: (r.forma_pagamento as FundoFixoFormaPagamento) || 'cartao',
    formaPagamentoSecundaria: (r.forma_pagamento_secundaria as FundoFixoFormaPagamento) || null,
    valorFinalSecundario: r.valor_final_secundario !== null ? Number(r.valor_final_secundario) : null,
    orcamentoUrl: r.orcamento_url,
    notasFiscaisUrls: r.nota_fiscal_urls ?? [],
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
    reembolsado: r.reembolsado ?? false,
    dataReembolso: r.data_reembolso ? new Date(r.data_reembolso) : null,
    teamsEnviadoEm: r.teams_enviado_em ? new Date(r.teams_enviado_em) : null,
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

// Mesma ordem do load(): mais recente primeiro, desempate por id.
const ordenarSolicitacoes = (a: FundoFixoSolicitacao, b: FundoFixoSolicitacao) =>
  b.dataSolicitacao.getTime() - a.dataSolicitacao.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ordenarSaques = (a: FundoFixoSaque, b: FundoFixoSaque) =>
  b.dataSaque.getTime() - a.dataSaque.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
        fetchAllRows((from, to) => this.supabaseService.client
          .from('fundo_fixo_solicitacoes')
          .select('*')
          .order('data_solicitacao', { ascending: false }).order('id').range(from, to)),
        fetchAllRows((from, to) => this.supabaseService.client
          .from('fundo_fixo_saques')
          .select('*')
          .order('data_saque', { ascending: false }).order('id').range(from, to)),
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
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

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
    this._solicitacoes.update(l => removerDaLista(l, id));

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_excluido',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} excluiu solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''}: ${item?.material ?? ''}`,
    });
  }

  async registrarSaque(req: CreateFundoFixoSaque): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

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

    const { data: inserido, error } = await this.supabaseService.client
      .from('fundo_fixo_saques').insert(payload).select('*').single();
    if (error) throw new Error(error.message);
    this._saques.update(l => upsertNaLista(l, mapSaqueRow(inserido as FundoFixoSaqueRow), ordenarSaques));

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
  }

  async atualizarTaxaSaque(id: string, taxa: number): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    const { data, error } = await this.supabaseService.client
      .from('fundo_fixo_saques')
      .update({ taxa })
      .eq('id', id)
      .select('*');
    if (error) throw new Error(error.message);
    // RLS bloqueando o UPDATE não dá erro, só volta 0 linhas.
    if (!data || data.length === 0) {
      throw new Error('Não foi possível salvar a taxa do saque (sem permissão no banco ou o saque foi excluído).');
    }
    this._saques.update(l => upsertNaLista(l, mapSaqueRow(data[0] as FundoFixoSaqueRow), ordenarSaques));

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_saque_registrado',
      resource_type: 'fundo_fixo_saque',
      resource_id: id,
      description: `${admin.name} informou a taxa de R$ ${taxa.toFixed(2)} de um saque do Fundo Fixo`,
      metadata: { taxa },
    });
  }

  async excluirSaque(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    const { data, error } = await this.supabaseService.client
      .from('fundo_fixo_saques')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error('Não foi possível excluir o saque (permissão do banco). Verifique se a migration 013 foi executada no Supabase.');
    }
    this._saques.update(l => removerDaLista(l, id));

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_saque_excluido',
      resource_type: 'fundo_fixo_saque',
      resource_id: id,
      description: `${admin.name} excluiu um saque do Fundo Fixo`,
    });
  }

  // Devolve o número do chamado (FF-001...) pra mostrar pra quem solicitou.
  async criarSolicitacao(req: CreateFundoFixoRequest, orcamento: File | null): Promise<number | null> {
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

    const { data: inserted, error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes').insert(payload).select('*').single();
    if (error) throw new Error(error.message);
    // numero (FF-001...) vem da identity do banco — já chega preenchido na linha devolvida.
    this._solicitacoes.update(l => upsertNaLista(l, mapRow(inserted as FundoFixoRow), ordenarSolicitacoes));

    // Manda pra aprovação no Teams do gestor do setor. Fire-and-forget: se falhar, a
    // solicitação continua pendente no portal pro Admin.
    if (inserted?.id) {
      fetch('/api/fundo-fixo-public-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'teams-notificar', id: inserted.id }),
      }).catch(err => console.error('[fundo-fixo] Falha ao enviar pro Teams:', err));
    }

    const descricaoEmNomeDe = solicitanteId !== user.id ? ` em nome de ${solicitanteNome}` : '';
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_solicitado',
      resource_type: 'fundo_fixo',
      resource_id: inserted?.id,
      description: `${user.name} solicitou compra via Fundo Fixo (${numeroFundoFixo(inserted?.numero)})${descricaoEmNomeDe}: ${req.material} (R$ ${req.valorEstimado.toFixed(2)})`,
      metadata: { setor: req.setor, valor_estimado: req.valorEstimado, comprador_id: payload.comprador_id, numero: inserted?.numero ?? null },
    });
    return inserted?.numero ?? null;
  }

  // UPDATE de uma solicitação devolvendo a linha gravada, que entra direto na lista em
  // memória (sem recarregar a tabela inteira).
  private async gravarSolicitacao(id: string, payload: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('fundo_fixo_solicitacoes')
      .update(payload)
      .eq('id', id)
      .select('*');
    if (error) throw new Error(error.message);
    // RLS bloqueando o UPDATE não dá erro, só volta 0 linhas.
    if (!data || data.length === 0) {
      throw new Error('Não foi possível salvar a solicitação (sem permissão no banco ou ela foi excluída).');
    }
    this._solicitacoes.update(l => upsertNaLista(l, mapRow(data[0] as FundoFixoRow), ordenarSolicitacoes));
  }

  async atribuirComprador(id: string, compradorId: string, compradorNome: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, { comprador_id: compradorId, comprador_nome: compradorNome });

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_comprador_atribuido',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} direcionou a compra de ${item?.material ?? ''} para ${compradorNome}`,
    });
  }

  // Vincula uma solicitação sem dono (veio do link público, solicitante_id null) a um
  // usuário de verdade do Portal — assim ela passa a aparecer na Lista de Compras/Minhas
  // Solicitações dessa pessoa, que antes não enxergava o que pediu por fora do login.
  async vincularSolicitante(id: string, solicitanteId: string, solicitanteNome: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, { solicitante_id: solicitanteId, solicitante_nome: solicitanteNome });

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_solicitante_vinculado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} vinculou a solicitação "${item?.material ?? ''}" (via link público) ao usuário ${solicitanteNome}`,
    });
  }

  // Admin corrige os dados originais da solicitação (link errado, valor digitado errado
  // etc.) — funciona em qualquer status, mesmo depois de comprado, já que isso não mexe
  // no valor_final que já foi registrado na compra.
  async editarSolicitacao(id: string, updates: {
    setor: FundoFixoSetor; fornecedor: string | null; material: string;
    linkProduto: string | null; valorEstimado: number; observacoes: string | null;
    // Só pra compra já registrada: corrige o valor PAGO (lançado errado ao registrar a
    // compra). valorFinalSecundario só quando o pagamento foi dividido em duas formas.
    valorFinal?: number; valorFinalSecundario?: number | null;
  }): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    const anterior = this.getById(id);
    const payload: Record<string, unknown> = {
      setor: updates.setor,
      fornecedor: updates.fornecedor,
      material: updates.material,
      link_produto: updates.linkProduto,
      valor_estimado: updates.valorEstimado,
      observacoes: updates.observacoes,
    };
    const mudouValorPago = anterior?.status === 'comprado' && updates.valorFinal !== undefined
      && (updates.valorFinal !== anterior.valorFinal
        || (anterior.formaPagamentoSecundaria != null && (updates.valorFinalSecundario ?? null) !== anterior.valorFinalSecundario));
    if (mudouValorPago) {
      payload['valor_final'] = updates.valorFinal;
      if (anterior!.formaPagamentoSecundaria != null) payload['valor_final_secundario'] = updates.valorFinalSecundario ?? null;
    }

    await this.gravarSolicitacao(id, payload);

    const fmt = (v: number | null | undefined) => `R$ ${(v ?? 0).toFixed(2)}`;
    const valorPagoAntes = (anterior?.valorFinal ?? 0) + (anterior?.valorFinalSecundario ?? 0);
    const valorPagoDepois = (updates.valorFinal ?? 0) + (anterior?.formaPagamentoSecundaria != null ? (updates.valorFinalSecundario ?? 0) : 0);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_editado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} editou a solicitação "${updates.material}"`
        + (mudouValorPago ? ` — valor pago ${fmt(valorPagoAntes)} → ${fmt(valorPagoDepois)}` : ''),
      metadata: mudouValorPago ? { valor_pago_antes: valorPagoAntes, valor_pago_depois: valorPagoDepois } : undefined,
    });
  }

  async aprovar(id: string, gestorAprovador: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, {
      status: 'aprovado',
      aprovador_id: admin.id,
      aprovador_nome: admin.name,
      gestor_aprovador: gestorAprovador,
      data_aprovacao: new Date().toISOString(),
    });

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
  }

  async recusar(id: string, motivo: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, {
      status: 'recusado',
      aprovador_id: admin.id,
      aprovador_nome: admin.name,
      data_aprovacao: new Date().toISOString(),
      motivo_recusa: motivo.trim() || null,
    });

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_recusado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} recusou solicitação de Fundo Fixo de ${item?.solicitanteNome ?? ''}: ${item?.material ?? ''}`,
    });
  }

  async marcarComprado(
    id: string, notasFiscais: File[], valorFinal: number, formaPagamento: FundoFixoFormaPagamento, fornecedor?: string,
    // Preenchido só quando a compra saiu em duas formas de pagamento (ex.: parte no
    // cartão, parte em dinheiro) — valorFinal é a parte de formaPagamento, isso aqui é a
    // outra parte.
    pagamentoSecundario?: { formaPagamento: FundoFixoFormaPagamento; valorFinal: number } | null,
    // Reembolso: quem pediu já anexou o recibo como "orçamento" na solicitação — true
    // reaproveita esse mesmo arquivo como comprovante, sem precisar subir de novo.
    usarOrcamentoComoNota = false,
  ): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const reaproveitadas = this.urlsOrcamentoReaproveitado(id, usarOrcamentoComoNota);
    const enviadas = await Promise.all(notasFiscais.map(f => this.uploadAnexo(f, 'notas-fiscais')));
    if (enviadas.some(url => !url)) throw new Error('Falha ao enviar uma ou mais notas fiscais. Tente novamente.');
    const notasFiscaisUrls = [...reaproveitadas, ...(enviadas as string[])];
    if (notasFiscaisUrls.length === 0) throw new Error('Anexe a nota fiscal ou use o orçamento/recibo já anexado.');

    const payload: Record<string, unknown> = {
      status: 'comprado',
      nota_fiscal_urls: notasFiscaisUrls,
      valor_final: valorFinal,
      forma_pagamento: formaPagamento,
      forma_pagamento_secundaria: pagamentoSecundario?.formaPagamento ?? null,
      valor_final_secundario: pagamentoSecundario?.valorFinal ?? null,
      data_compra: new Date().toISOString(),
    };
    if (fornecedor?.trim()) payload['fornecedor'] = fornecedor.trim();

    await this.gravarSolicitacao(id, payload);

    const item = this.getById(id);
    const valorTotal = valorFinal + (pagamentoSecundario?.valorFinal ?? 0);
    const descricaoValor = pagamentoSecundario
      ? `R$ ${valorFinal.toFixed(2)} em ${formaPagamento} + R$ ${pagamentoSecundario.valorFinal.toFixed(2)} em ${pagamentoSecundario.formaPagamento}`
      : `R$ ${valorTotal.toFixed(2)}`;
    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_comprado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${user.name} registrou compra via Fundo Fixo: ${item?.material ?? ''} (${descricaoValor})`
        + (reaproveitadas.length ? ' — orçamento/recibo da solicitação usado como comprovante' : ''),
    });
  }

  // Anexa nota(s) fiscal(is) extra a uma compra que já foi registrada (ex.: a compra
  // saiu em mais de uma nota, ou uma nota ficou de fora na hora de registrar a compra).
  async adicionarNotasFiscais(id: string, notasFiscais: File[], usarOrcamentoComoNota = false): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const item = this.getById(id);
    if (!item) throw new Error('Solicitação não encontrada.');

    const reaproveitadas = this.urlsOrcamentoReaproveitado(id, usarOrcamentoComoNota);
    const novasUrls = await Promise.all(notasFiscais.map(f => this.uploadAnexo(f, 'notas-fiscais')));
    if (novasUrls.some(url => !url)) throw new Error('Falha ao enviar uma ou mais notas fiscais. Tente novamente.');
    const novas = [...reaproveitadas, ...(novasUrls as string[])];
    if (novas.length === 0) throw new Error('Nenhum arquivo pra anexar.');

    const urlsFinal = [...item.notasFiscaisUrls, ...novas];

    await this.gravarSolicitacao(id, { nota_fiscal_urls: urlsFinal });

    this.auditLogService.log({
      user_id: user.id,
      user_name: user.name,
      event_type: 'fundo_fixo_nota_adicionada',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${user.name} anexou ${novas.length} nota(s) fiscal(is) adicional(is) a: ${item.material}`
        + (reaproveitadas.length ? ' (orçamento/recibo da solicitação reaproveitado)' : ''),
    });
  }

  // Orçamento/recibo anexado na solicitação, pra entrar como nota fiscal sem novo upload
  // (mesmo arquivo, mesma URL — não duplica no storage). Vazio se não pediu, se não há
  // orçamento, ou se ele já está entre as notas.
  private urlsOrcamentoReaproveitado(id: string, usar: boolean): string[] {
    if (!usar) return [];
    const item = this.getById(id);
    if (!item?.orcamentoUrl) throw new Error('Essa solicitação não tem orçamento/recibo anexado.');
    return item.notasFiscaisUrls.includes(item.orcamentoUrl) ? [] : [item.orcamentoUrl];
  }

  // Não vai dar tempo de entrar na fatura do cartão deste mês — seja porque a compra já foi
  // feita depois que a fatura tinha fechado, ou porque ainda está pendente/aprovada e não vai
  // sair a tempo. Move pro mês seguinte pra contar no limite e no fechamento certos.
  async moverParaProximoMes(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    const item = this.getById(id);
    if (!item) throw new Error('Solicitação não encontrada.');

    const mesAnterior = item.mesReferencia;
    const novoMes = proximoMes(mesAnterior);

    await this.gravarSolicitacao(id, { mes_referencia: novoMes });

    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_editado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} moveu a compra "${item.material}" de ${mesAnterior} para ${novoMes} (não vai entrar na fatura deste mês)`,
      metadata: { mes_anterior: mesAnterior, mes_novo: novoMes },
    });
  }

  // Admin pode corrigir a forma de pagamento mesmo depois da nota fiscal já anexada
  // (ex.: registrou como cartão por engano, mas foi pago em dinheiro do caixa).
  async atualizarFormaPagamento(id: string, formaPagamento: FundoFixoFormaPagamento): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, { forma_pagamento: formaPagamento });

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
  }

  // Marca que a pessoa já recebeu de volta o dinheiro que pagou do próprio bolso.
  // Fica pendente entre meses até ser marcado, independente do mesReferencia da compra.
  async marcarReembolsado(id: string): Promise<void> {
    const admin = this.authService.currentUser();
    if (!admin) throw new Error('Sessão expirada.');
    if (admin.role !== 'Admin') throw new Error('Apenas administradores podem executar esta ação.');

    await this.gravarSolicitacao(id, { reembolsado: true, data_reembolso: new Date().toISOString() });

    const item = this.getById(id);
    this.auditLogService.log({
      user_id: admin.id,
      user_name: admin.name,
      event_type: 'fundo_fixo_reembolsado',
      resource_type: 'fundo_fixo',
      resource_id: id,
      description: `${admin.name} marcou como reembolsado: ${item?.material ?? ''} (${item?.solicitanteNome ?? ''})`,
    });
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
