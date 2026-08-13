import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import JSZip from 'jszip';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FundoFixoService, FUNDO_FIXO_GESTORES, FUNDO_FIXO_LIMITE_MENSAL, FUNDO_FIXO_LIMITE_POR_COMPRA, FUNDO_FIXO_SETORES } from '../../../services/fundo-fixo.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { UserService } from '../../../services/user.service';
import { ExcelExportService, FechamentoFundoFixoLinha } from '../../../services/excel-export.service';
import { FundoFixoFormaPagamento, FundoFixoSaque, FundoFixoSolicitacao, FundoFixoStatus } from '../../../models/fundo-fixo.model';

type StatusFiltro = 'todos' | FundoFixoStatus;

const FORMA_PAGAMENTO_LABEL: Record<FundoFixoFormaPagamento, string> = {
  cartao: 'Cartão',
  dinheiro_caixa: 'Dinheiro (caixa)',
  reembolso: 'Reembolso',
};

const STATUS_LABEL: Record<FundoFixoStatus, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  comprado: 'Comprado',
};

const STATUS_BADGE: Record<FundoFixoStatus, string> = {
  pendente: 'bg-amber-100 text-amber-700',
  aprovado: 'bg-blue-100 text-blue-700',
  recusado: 'bg-red-100 text-red-700',
  comprado: 'bg-green-100 text-green-700',
};

@Component({
  selector: 'app-fundo-fixo-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe],
  templateUrl: './fundo-fixo-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoListComponent implements OnInit {
  readonly limiteMensal = FUNDO_FIXO_LIMITE_MENSAL;
  readonly limitePorCompra = FUNDO_FIXO_LIMITE_POR_COMPRA;
  readonly setores = FUNDO_FIXO_SETORES;
  readonly gestores = FUNDO_FIXO_GESTORES;
  readonly statusLabel = STATUS_LABEL;
  readonly statusBadge = STATUS_BADGE;
  readonly formaPagamentoLabel = FORMA_PAGAMENTO_LABEL;

  // 'gestao' (Admin, /fundo-fixo): KPIs + aprovar/recusar. 'compras' (/fundo-fixo/lista): lista
  // operacional — usuário comum vê só as próprias, Admin vê todas, sem ações de aprovação.
  mode: 'gestao' | 'compras' = 'compras';
  pageTitle = 'Lista de Compras';

  errorMessage = signal('');

  // Filtros
  mesFiltro = signal(this.fundoFixoService.mesAtual());
  statusFiltro = signal<StatusFiltro>('todos');
  setorFiltro = signal<'todos' | string>('todos');
  searchTerm = signal('');

  readonly meses = (() => {
    const result: { value: string; label: string }[] = [];
    const hoje = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return result;
  })();

  // Modais
  aprovarAlvo = signal<FundoFixoSolicitacao | null>(null);
  aprovarGestor = signal('');
  recusarAlvo = signal<FundoFixoSolicitacao | null>(null);
  motivoRecusa = signal('');
  comprarAlvo = signal<FundoFixoSolicitacao | null>(null);
  comprarValorFinal = signal<number | null>(null);
  comprarFornecedor = signal('');
  comprarFormaPagamento = signal<FundoFixoFormaPagamento>('cartao');
  formaPagamentoAlvo = signal<FundoFixoSolicitacao | null>(null);
  formaPagamentoEscolhida = signal<FundoFixoFormaPagamento>('cartao');
  comprarNotaFiscal = signal<File | null>(null);
  isProcessando = signal(false);

  // Modal: ver detalhes completos da solicitação (material/observações sem corte)
  detalheAlvo = signal<FundoFixoSolicitacao | null>(null);

  abrirDetalhe(s: FundoFixoSolicitacao): void {
    this.detalheAlvo.set(s);
  }

  fecharDetalhe(): void {
    this.detalheAlvo.set(null);
  }

  // Modal: registrar saque
  saqueModalAberto = signal(false);
  saqueValor = signal<number | null>(null);
  saqueTaxa = signal<number | null>(null); // null = ainda não sei (só se descobre no fechamento da fatura)
  saqueEhSaldoInicial = signal(false);
  saqueData = signal(new Date().toISOString().slice(0, 10));
  saqueObservacoes = signal('');

  // Modal: informar taxa de um saque já registrado
  taxaAlvo = signal<FundoFixoSaque | null>(null);
  taxaValor = signal<number | null>(null);

  // Modal: atribuir/reatribuir comprador responsável
  compradorAlvo = signal<FundoFixoSolicitacao | null>(null);
  compradorEscolhidoId = signal<string>('');
  admins = computed(() => this.userService.users().filter(u => u.role === 'Admin'));

  isLoading = this.fundoFixoService.isLoading;
  currentUser = this.authService.currentUser;
  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');
  podeSolicitar = computed(() => this.authService.currentUser()?.role !== 'Visualizador');

  solicitacoesDoMes = computed(() => {
    const user = this.currentUser();
    let lista = this.fundoFixoService.solicitacoes().filter(s => s.mesReferencia === this.mesFiltro());
    // Na Lista de Compras, quem não é Admin só enxerga as próprias solicitações.
    if (this.mode === 'compras' && !this.isAdmin() && user) {
      lista = lista.filter(s => s.solicitanteId === user.id);
    }
    return lista;
  });

  totalComprometido = computed(() => this.fundoFixoService.totalComprometidoMes(this.mesFiltro()));
  saldoRestante = computed(() => Math.max(0, this.limiteMensal - this.totalComprometido()));
  percentualUsado = computed(() => Math.min(100, (this.totalComprometido() / this.limiteMensal) * 100));

  // Saques do cartão no mês (valor + taxa) — é o que realmente aparece na fatura,
  // então entra na conta de "No cartão" junto com as compras diretas.
  totalSaquesFaturaMes = computed(() =>
    this.fundoFixoService.saques()
      .filter(s => s.mesReferencia === this.mesFiltro() && s.tipo === 'saque')
      .reduce((sum, s) => sum + s.valor + (s.taxa ?? 0), 0)
  );

  // Compras já finalizadas no mês, separadas por origem do dinheiro: no cartão
  // (compras no cartão + saques, que aparecem direto na fatura) vs reembolso/caixa
  // (já saiu como saque antes — não aparece de novo na fatura quando a compra é registrada).
  totalCartao = computed(() =>
    this.solicitacoesDoMes()
      .filter(s => s.status === 'comprado' && s.formaPagamento === 'cartao')
      .reduce((sum, s) => sum + (s.valorFinal ?? 0), 0)
    + this.totalSaquesFaturaMes()
  );
  totalReembolsoCaixa = computed(() =>
    this.solicitacoesDoMes()
      .filter(s => s.status === 'comprado' && (s.formaPagamento === 'dinheiro_caixa' || s.formaPagamento === 'reembolso'))
      .reduce((sum, s) => sum + (s.valorFinal ?? 0), 0)
  );
  countPendentes = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'pendente').length);
  countAguardandoNota = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'aprovado').length);

  // ── Fechamento do mês (relatório para os gestores) ────────────────────
  itensCartaoDoMes = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'comprado' && s.formaPagamento === 'cartao'));
  itensReembolsoDoMes = computed(() => this.solicitacoesDoMes().filter(s => s.status === 'comprado' && (s.formaPagamento === 'dinheiro_caixa' || s.formaPagamento === 'reembolso')));

  // Quem pagou do próprio bolso e ainda não recebeu de volta — de propósito NÃO filtra
  // pelo mês selecionado (mesFiltro), senão some da tela assim que o mês vira e ninguém
  // lembra de reembolsar quem comprou no mês anterior.
  reembolsosPendentes = computed(() =>
    this.fundoFixoService.solicitacoes()
      .filter(s => s.status === 'comprado' && s.formaPagamento === 'reembolso' && !s.reembolsado)
      .sort((a, b) => (a.dataCompra?.getTime() ?? 0) - (b.dataCompra?.getTime() ?? 0))
  );
  totalReembolsosPendentes = computed(() =>
    this.reembolsosPendentes().reduce((sum, s) => sum + (s.valorFinal ?? s.valorEstimado), 0)
  );
  totalSacadoMes = computed(() =>
    this.fundoFixoService.saques()
      .filter(s => s.mesReferencia === this.mesFiltro() && s.tipo === 'saque')
      .reduce((sum, s) => sum + s.valor, 0)
  );
  mesFiltroLabel = computed(() => this.meses.find(m => m.value === this.mesFiltro())?.label ?? this.mesFiltro());
  isExportandoFechamento = signal(false);

  listaFiltrada = computed(() => {
    const status = this.statusFiltro();
    const setor = this.setorFiltro();
    const termo = this.searchTerm().trim().toLowerCase();

    return this.solicitacoesDoMes().filter(s => {
      if (status !== 'todos' && s.status !== status) return false;
      if (setor !== 'todos' && s.setor !== setor) return false;
      if (termo) {
        const texto = `${s.material} ${s.solicitanteNome} ${s.fornecedor ?? ''} ${s.gestorAprovador ?? ''} ${s.compradorNome ?? ''}`.toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  });

  constructor(
    private route: ActivatedRoute,
    private fundoFixoService: FundoFixoService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private userService: UserService,
    private excelExportService: ExcelExportService,
  ) {
    if (this.route.snapshot.data['mode'] === 'gestao') {
      this.mode = 'gestao';
      this.pageTitle = 'Fundo Fixo';
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.fundoFixoService.load();
      if (this.mode === 'gestao') {
        this.userService.loadUsers().catch(() => {});
      }
    } catch {
      this.errorMessage.set('Erro ao carregar solicitações do Fundo Fixo.');
    }
  }

  podeAnexarNota(s: FundoFixoSolicitacao): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return s.status === 'aprovado' && (this.isAdmin() || s.solicitanteId === user.id);
  }

  // ── Aprovar ────────────────────────────────────────────────────────────
  abrirAprovar(s: FundoFixoSolicitacao): void {
    this.aprovarAlvo.set(s);
    this.aprovarGestor.set('');
  }

  fecharAprovar(): void {
    this.aprovarAlvo.set(null);
  }

  async confirmarAprovacao(): Promise<void> {
    const alvo = this.aprovarAlvo();
    const gestor = this.aprovarGestor();
    if (!alvo || !gestor || this.isProcessando()) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.aprovar(alvo.id, gestor);
      this.notificationService.showSuccess(`Solicitação de ${alvo.solicitanteNome} aprovada.`);
      this.fecharAprovar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao aprovar.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Recusar ────────────────────────────────────────────────────────────
  abrirRecusar(s: FundoFixoSolicitacao): void {
    this.recusarAlvo.set(s);
    this.motivoRecusa.set('');
  }

  fecharRecusar(): void {
    this.recusarAlvo.set(null);
  }

  async confirmarRecusa(): Promise<void> {
    const alvo = this.recusarAlvo();
    if (!alvo || this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.recusar(alvo.id, this.motivoRecusa());
      this.notificationService.showSuccess('Solicitação recusada.');
      this.fecharRecusar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao recusar.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Marcar como comprado (anexar nota fiscal) ─────────────────────────
  abrirComprar(s: FundoFixoSolicitacao): void {
    this.comprarAlvo.set(s);
    this.comprarValorFinal.set(s.valorEstimado);
    this.comprarFornecedor.set(s.fornecedor ?? '');
    this.comprarFormaPagamento.set('cartao');
    this.comprarNotaFiscal.set(null);
  }

  fecharComprar(): void {
    this.comprarAlvo.set(null);
  }

  onNotaFiscalSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.comprarNotaFiscal.set(input.files?.[0] ?? null);
  }

  canConfirmarCompra(): boolean {
    const valor = this.comprarValorFinal() ?? 0;
    return !!this.comprarNotaFiscal() && valor > 0 && valor <= this.limitePorCompra && !this.isProcessando();
  }

  async confirmarCompra(): Promise<void> {
    const alvo = this.comprarAlvo();
    const nota = this.comprarNotaFiscal();
    if (!alvo || !nota || !this.canConfirmarCompra()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.marcarComprado(
        alvo.id, nota, this.comprarValorFinal() ?? alvo.valorEstimado, this.comprarFormaPagamento(), this.comprarFornecedor(),
      );
      this.notificationService.showSuccess('Compra registrada com sucesso!');
      this.fecharComprar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao registrar compra.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  formatDate(d: Date | null): string {
    if (!d) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }

  // ── Excluir ────────────────────────────────────────────────────────────
  podeExcluir(): boolean {
    return this.isAdmin();
  }

  async excluir(s: FundoFixoSolicitacao): Promise<void> {
    if (this.isProcessando()) return;
    const confirmado = confirm(
      `Excluir a solicitação de ${s.solicitanteNome} (${s.material})?\n\nEsta ação não pode ser desfeita.`,
    );
    if (!confirmado) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.excluir(s.id);
      this.notificationService.showSuccess('Solicitação excluída.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Saldo em caixa / saques ────────────────────────────────────────────
  saldoCaixa = this.fundoFixoService.saldoCaixa;
  saquesDoMes = computed(() => this.fundoFixoService.saques().filter(s => s.mesReferencia === this.mesFiltro()));

  abrirNovoSaque(): void {
    this.saqueValor.set(null);
    this.saqueTaxa.set(null);
    this.saqueEhSaldoInicial.set(false);
    this.saqueData.set(new Date().toISOString().slice(0, 10));
    this.saqueObservacoes.set('');
    this.saqueModalAberto.set(true);
  }

  fecharNovoSaque(): void {
    this.saqueModalAberto.set(false);
  }

  canConfirmarSaque(): boolean {
    return (this.saqueValor() ?? 0) > 0 && !this.isProcessando();
  }

  async confirmarNovoSaque(): Promise<void> {
    if (!this.canConfirmarSaque()) return;
    this.isProcessando.set(true);
    try {
      const ehSaldoInicial = this.saqueEhSaldoInicial();
      await this.fundoFixoService.registrarSaque({
        valor: this.saqueValor() ?? 0,
        taxa: ehSaldoInicial ? undefined : (this.saqueTaxa() ?? undefined),
        tipo: ehSaldoInicial ? 'ajuste_inicial' : 'saque',
        dataSaque: this.saqueData(),
        observacoes: this.saqueObservacoes() || undefined,
      });
      this.notificationService.showSuccess(ehSaldoInicial ? 'Saldo inicial registrado.' : 'Saque registrado.');
      this.fecharNovoSaque();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao registrar saque.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Informar taxa depois (só se sabe no fechamento da fatura) ─────────
  abrirEditarTaxa(saque: FundoFixoSaque): void {
    this.taxaAlvo.set(saque);
    this.taxaValor.set(saque.taxa);
  }

  fecharEditarTaxa(): void {
    this.taxaAlvo.set(null);
  }

  canConfirmarTaxa(): boolean {
    return (this.taxaValor() ?? -1) >= 0 && !this.isProcessando();
  }

  async confirmarTaxa(): Promise<void> {
    const alvo = this.taxaAlvo();
    if (!alvo || !this.canConfirmarTaxa()) return;
    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.atualizarTaxaSaque(alvo.id, this.taxaValor() ?? 0);
      this.notificationService.showSuccess('Taxa registrada.');
      this.fecharEditarTaxa();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao registrar taxa.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Excluir saque ──────────────────────────────────────────────────────
  async excluirSaque(saque: FundoFixoSaque): Promise<void> {
    if (this.isProcessando()) return;
    const confirmado = confirm(
      `Excluir o saque de ${saque.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de ${this.formatDate(saque.dataSaque)}?\n\nEsta ação não pode ser desfeita.`,
    );
    if (!confirmado) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.excluirSaque(saque.id);
      this.notificationService.showSuccess('Saque excluído.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir saque.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Marcar reembolso como pago ─────────────────────────────────────────
  async marcarReembolsado(s: FundoFixoSolicitacao): Promise<void> {
    if (this.isProcessando()) return;
    const confirmado = confirm(`Confirmar que ${s.solicitanteNome} já recebeu de volta o valor de "${s.material}"?`);
    if (!confirmado) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.marcarReembolsado(s.id);
      this.notificationService.showSuccess('Reembolso marcado como pago.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao marcar reembolso.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Atribuir comprador ────────────────────────────────────────────────
  abrirAtribuirComprador(s: FundoFixoSolicitacao): void {
    this.compradorAlvo.set(s);
    this.compradorEscolhidoId.set(s.compradorId ?? '');
  }

  fecharAtribuirComprador(): void {
    this.compradorAlvo.set(null);
  }

  async confirmarComprador(): Promise<void> {
    const alvo = this.compradorAlvo();
    const admin = this.admins().find(a => a.id === this.compradorEscolhidoId());
    if (!alvo || !admin || this.isProcessando()) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.atribuirComprador(alvo.id, admin.id, admin.name);
      this.notificationService.showSuccess(`Compra direcionada para ${admin.name}.`);
      this.fecharAtribuirComprador();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao direcionar comprador.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Corrigir forma de pagamento (mesmo após a nota fiscal anexada) ────
  abrirEditarFormaPagamento(s: FundoFixoSolicitacao): void {
    this.formaPagamentoAlvo.set(s);
    this.formaPagamentoEscolhida.set(s.formaPagamento);
  }

  fecharEditarFormaPagamento(): void {
    this.formaPagamentoAlvo.set(null);
  }

  async confirmarFormaPagamento(): Promise<void> {
    const alvo = this.formaPagamentoAlvo();
    if (!alvo || this.isProcessando()) return;

    this.isProcessando.set(true);
    try {
      await this.fundoFixoService.atualizarFormaPagamento(alvo.id, this.formaPagamentoEscolhida());
      this.notificationService.showSuccess('Forma de pagamento atualizada.');
      this.fecharEditarFormaPagamento();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao atualizar forma de pagamento.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Fechar mês: excel no formato da planilha + zip das NFs + e-mail pronto ──
  async fecharMes(): Promise<void> {
    if (this.isExportandoFechamento()) return;
    this.isExportandoFechamento.set(true);

    try {
      const mesLabel = this.mesFiltroLabel();
      const cartao = this.itensCartaoDoMes();
      const reembolsos = this.itensReembolsoDoMes();
      const saquesDoMesReais = this.saquesDoMes().filter(s => s.tipo === 'saque');

      // Saques (e a taxa cobrada) entram como linhas na tabela do cartão — é assim que
      // aparecem na fatura de verdade, igual na planilha que já era usada manualmente.
      const linhasSaque: FechamentoFundoFixoLinha[] = [];
      for (const saque of saquesDoMesReais) {
        linhasSaque.push({
          fornecedor: `${saque.registradoPorNome} - SAQUE CAIXA 24H`,
          solicitante: saque.registradoPorNome,
          setor: '—',
          material: saque.observacoes || 'Saque em dinheiro',
          valor: saque.valor,
          aprovador: '—',
        });
        if (saque.taxa) {
          linhasSaque.push({
            fornecedor: 'TARIFA SAQUE',
            solicitante: saque.registradoPorNome,
            setor: '—',
            material: 'Taxa cobrada no saque',
            valor: saque.taxa,
            aprovador: '—',
          });
        }
      }

      this.excelExportService.exportarFechamentoFundoFixo({
        mesLabel,
        cartao: [
          ...cartao.map(s => ({
            fornecedor: s.fornecedor ?? '—',
            solicitante: s.solicitanteNome,
            setor: s.setor,
            material: s.material,
            valor: s.valorFinal ?? s.valorEstimado,
            aprovador: s.gestorAprovador ?? '—',
          })),
          ...linhasSaque,
        ],
        reembolsos: reembolsos.map(s => ({
          fornecedor: s.fornecedor ?? '—',
          solicitante: s.solicitanteNome,
          setor: s.setor,
          material: s.material,
          valor: s.valorFinal ?? s.valorEstimado,
          aprovador: s.gestorAprovador ?? '—',
        })),
        limiteMensal: this.limiteMensal,
        totalSacadoMes: this.totalSacadoMes(),
        saldoCaixaAtual: this.saldoCaixa(),
      });

      await this.baixarNotasFiscaisZip([...cartao, ...reembolsos], mesLabel);

      const assunto = encodeURIComponent(`Fundo Fixo — Fechamento de ${mesLabel}`);
      const corpo = encodeURIComponent(
        `Senhores, bom dia,\n\nSegue para conhecimento e aprovação os gastos com o fundo fixo da fatura de ${mesLabel}.\n\n` +
        `Planilha e notas fiscais em anexo.\n\nAguardo de acordo para seguir com o pagamento da fatura.\n\nAtenciosamente,`,
      );
      window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;

      this.notificationService.showSuccess('Excel e notas fiscais baixados. Anexe os dois arquivos no e-mail que abriu.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao gerar o fechamento do mês.');
    } finally {
      this.isExportandoFechamento.set(false);
    }
  }

  private async baixarNotasFiscaisZip(itens: FundoFixoSolicitacao[], mesLabel: string): Promise<void> {
    const comNota = itens.filter(s => !!s.notaFiscalUrl);
    if (comNota.length === 0) return;

    const zip = new JSZip();
    const resultados = await Promise.allSettled(
      comNota.map(async (s, i) => {
        const res = await fetch(s.notaFiscalUrl!);
        if (!res.ok) throw new Error(`Falha ao baixar nota fiscal de ${s.fornecedor ?? s.material}`);
        const blob = await res.blob();
        const ext = s.notaFiscalUrl!.split('.').pop()?.split('?')[0] || 'pdf';
        const nomeBase = `${s.fornecedor ?? s.material}`.replace(/[^\w\sÀ-ÿ-]/g, '').trim().slice(0, 40) || 'nota';
        zip.file(`${String(i + 1).padStart(2, '0')}_${nomeBase}.${ext}`, blob);
      }),
    );

    const falhas = resultados.filter(r => r.status === 'rejected').length;
    if (falhas > 0) {
      this.notificationService.showError(`${falhas} nota(s) fiscal(is) não puderam ser baixadas para o zip.`);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notas_fiscais_fundo_fixo_${mesLabel.replace(/\s+/g, '_')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
