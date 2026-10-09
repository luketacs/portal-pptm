import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

interface SolicitacaoDecisao {
  solicitanteNome: string;
  setor: string;
  fornecedor: string | null;
  material: string;
  linkProduto: string | null;
  valorEstimado: number;
  orcamentoUrl: string | null;
  observacoes: string | null;
  dataSolicitacao: string;
  status: 'pendente' | 'aprovado' | 'recusado' | 'comprado';
  gestorAprovador: string | null;
  aprovadorNome: string | null;
  dataAprovacao: string | null;
  motivoRecusa: string | null;
  expirado: boolean;
}

type Decisao = 'aprovar' | 'recusar';

// Página que os botões Aprovar/Recusar do card do Teams abrem (sem login). O token do
// link é a autorização — vale só pra essa solicitação, expira e só decide enquanto ela
// estiver pendente. Abrir a página não decide nada (o Teams abre links sozinho pra
// gerar prévia): só o clique em Confirmar grava. Ver docs/FUNDO-FIXO-TEAMS.md.
@Component({
  selector: 'app-fundo-fixo-decisao-publico',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fundo-fixo-decisao-publico.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoDecisaoPublicoComponent implements OnInit {
  private token = '';

  carregando = signal(true);
  solicitacao = signal<SolicitacaoDecisao | null>(null);
  decisao = signal<Decisao>('aprovar');
  comentario = signal('');
  enviando = signal(false);
  errorMessage = signal('');
  // Decisão feita agora, nesta tela (pra mostrar o "pronto" em vez do "já decidida").
  decididaAgora = signal(false);

  links = computed(() =>
    (this.solicitacao()?.linkProduto ?? '').split(/\s+/).filter(l => /^https?:\/\//i.test(l)));

  constructor(private route: ActivatedRoute) {}

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    this.token = params.get('t') ?? '';
    if (params.get('d') === 'recusar') this.decisao.set('recusar');

    try {
      const body = await this.chamar({ action: 'decisao-ver', token: this.token });
      if (!body.success) throw new Error(body.error);
      this.solicitacao.set(body.solicitacao);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao carregar a solicitação.');
    } finally {
      this.carregando.set(false);
    }
  }

  async confirmar(): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.errorMessage.set('');
    try {
      const body = await this.chamar({
        action: 'decisao-confirmar', token: this.token, decisao: this.decisao(), comentario: this.comentario(),
      });
      if (body.solicitacao) this.solicitacao.set(body.solicitacao);
      if (!body.success) throw new Error(body.error);
      this.decididaAgora.set(true);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao registrar a decisão.');
    } finally {
      this.enviando.set(false);
    }
  }

  private async chamar(payload: Record<string, string>): Promise<any> {
    const resp = await fetch('/api/fundo-fixo-public-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json().catch(() => ({ success: false, error: 'Erro de comunicação com o servidor.' }));
  }
}
