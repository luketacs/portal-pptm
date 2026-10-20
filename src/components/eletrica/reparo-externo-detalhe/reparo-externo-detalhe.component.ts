import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EletricaReparoService } from '../../../services/eletrica-reparo.service';
import { NotificationService } from '../../../services/notification.service';
import { ReparoExterno, ReparoHistorico, ReparoStatus } from '../../../models/eletrica-reparo.model';
import {
  REPARO_ENDERECO, REPARO_GARANTIA_LABEL, REPARO_STATUS, REPARO_STATUS_BADGE, REPARO_STATUS_LABEL, dataBr, numeroReparo,
} from '../../../utils/eletrica-reparo';
import { baixarPdfReparo } from '../../../utils/eletrica-reparo-pdf';

// Relatório completo de um reparo (é a página que o botão do card do Teams abre). Baixa o
// PDF; supervisor de elétrica / Admin também atualiza o status aqui.
@Component({
  selector: 'app-reparo-externo-detalhe',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reparo-externo-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReparoExternoDetalheComponent implements OnInit {
  readonly statusLista = REPARO_STATUS;
  readonly statusLabel = REPARO_STATUS_LABEL;
  readonly statusBadge = REPARO_STATUS_BADGE;
  readonly garantiaLabel = REPARO_GARANTIA_LABEL;
  readonly endereco = REPARO_ENDERECO;
  readonly numero = numeroReparo;
  readonly dataBr = dataBr;

  private id = '';
  reparo = signal<ReparoExterno | null>(null);
  historico = signal<ReparoHistorico[]>([]);
  carregando = signal(true);
  gerandoPdf = signal(false);
  podeControlar = this.reparoService.podeControlar;

  // Painel de status (supervisor)
  novoStatus = signal<ReparoStatus>('aberto');
  observacao = signal('');
  fornecedor = signal('');
  valorOrcamento = signal<number | null>(null);
  nfRemessa = signal('');
  previsaoRetorno = signal('');
  salvando = signal(false);

  contato = computed(() => {
    const r = this.reparo();
    return r ? [r.contatoNome, r.contatoTelefone, r.contatoEmail].filter(Boolean).join(' / ') : '';
  });

  constructor(
    private reparoService: EletricaReparoService,
    private notificationService: NotificationService,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
  }

  ngOnInit(): void {
    this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      const [r, h] = await Promise.all([this.reparoService.buscar(this.id), this.reparoService.historico(this.id)]);
      this.reparo.set(r);
      this.historico.set(h);
      if (r) {
        this.novoStatus.set(r.status);
        this.fornecedor.set(r.fornecedor ?? '');
        this.valorOrcamento.set(r.valorOrcamento);
        this.nfRemessa.set(r.nfRemessa ?? '');
        this.previsaoRetorno.set(r.previsaoRetorno ?? '');
        this.observacao.set('');
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o reparo.');
    } finally {
      this.carregando.set(false);
    }
  }

  async baixarPdf(): Promise<void> {
    const r = this.reparo();
    if (!r || this.gerandoPdf()) return;
    this.gerandoPdf.set(true);
    try {
      await baixarPdfReparo(r);
    } catch (err) {
      console.error('[reparo-externo] Falha ao gerar PDF:', err);
      this.notificationService.showError('Erro ao gerar o PDF.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  async salvarStatus(): Promise<void> {
    const r = this.reparo();
    if (!r || this.salvando()) return;
    this.salvando.set(true);
    try {
      const valor = this.valorOrcamento();
      await this.reparoService.atualizarStatus(r.id, {
        status: this.novoStatus(),
        observacao: this.observacao(),
        fornecedor: this.fornecedor(),
        valorOrcamento: valor === null || (valor as unknown) === '' ? null : Number(valor),
        nfRemessa: this.nfRemessa(),
        previsaoRetorno: this.previsaoRetorno() || null,
      });
      this.notificationService.showSuccess(`${numeroReparo(r.numero)} atualizado: ${REPARO_STATUS_LABEL[this.novoStatus()]}.`);
      await this.carregar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao atualizar o status.');
    } finally {
      this.salvando.set(false);
    }
  }
}
