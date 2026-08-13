import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../services/supabase.service';
import { FUNDO_FIXO_LIMITE_POR_COMPRA, FUNDO_FIXO_SETORES } from '../../../services/fundo-fixo.service';
import { FundoFixoSetor } from '../../../models/fundo-fixo.model';

const ORCAMENTO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB — igual ao formulário interno
const ORCAMENTO_ACCEPT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Formulário público — sem login. Só chega até aqui quem tem o link; qualquer um
// que preencher vira uma solicitação "pendente" normal, igual às feitas de dentro
// do Portal (aparece marcada como via link público pra quem for aprovar conferir).
@Component({
  selector: 'app-fundo-fixo-form-publico',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fundo-fixo-form-publico.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundoFixoFormPublicoComponent {
  readonly setores = FUNDO_FIXO_SETORES;
  readonly limitePorCompra = FUNDO_FIXO_LIMITE_POR_COMPRA;

  nomeSolicitante = signal('');
  contato = signal('');
  setor = signal<FundoFixoSetor>('Manutenção');
  fornecedor = signal('');
  material = signal('');
  linksProduto = signal<string[]>(['']);
  valorEstimado = signal<number | null>(null);
  observacoes = signal('');
  orcamento = signal<File | null>(null);

  isSubmitting = signal(false);
  errorMessage = signal('');
  enviado = signal(false);

  constructor(private supabaseService: SupabaseService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.errorMessage.set('');
    if (!file) return;

    if (!ORCAMENTO_ACCEPT[file.type]) {
      this.errorMessage.set('Formato inválido. Use PDF, JPG, PNG ou WEBP.');
      input.value = '';
      return;
    }
    if (file.size > ORCAMENTO_MAX_BYTES) {
      this.errorMessage.set('Arquivo muito grande (máx. 15 MB).');
      input.value = '';
      return;
    }
    this.orcamento.set(file);
  }

  removerAnexo(): void {
    this.orcamento.set(null);
  }

  onLinkChange(index: number, value: string): void {
    const copy = [...this.linksProduto()];
    copy[index] = value;
    this.linksProduto.set(copy);
  }

  adicionarLink(): void {
    this.linksProduto.set([...this.linksProduto(), '']);
  }

  removerLink(index: number): void {
    const copy = this.linksProduto().filter((_, i) => i !== index);
    this.linksProduto.set(copy.length > 0 ? copy : ['']);
  }

  canSubmit(): boolean {
    const valor = this.valorEstimado() ?? 0;
    return !!this.nomeSolicitante().trim()
      && !!this.material().trim()
      && valor > 0 && valor <= this.limitePorCompra
      && !this.isSubmitting();
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    try {
      let orcamentoPath: string | null = null;
      const file = this.orcamento();
      if (file) {
        orcamentoPath = await this.uploadOrcamento(file);
        if (!orcamentoPath) {
          this.errorMessage.set('Falha ao enviar o anexo. Tente novamente ou envie sem anexo.');
          this.isSubmitting.set(false);
          return;
        }
      }

      const resp = await fetch('/api/fundo-fixo-public-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeSolicitante: this.nomeSolicitante(),
          contato: this.contato(),
          setor: this.setor(),
          fornecedor: this.fornecedor(),
          material: this.material(),
          linkProduto: this.linksProduto().map(l => l.trim()).filter(Boolean).join('\n'),
          valorEstimado: this.valorEstimado(),
          observacoes: this.observacoes(),
          orcamentoPath,
        }),
      });
      const data = await resp.json().catch(() => ({ success: false }));

      if (!resp.ok || !data.success) {
        this.errorMessage.set(data.error || 'Erro ao enviar solicitação. Tente novamente.');
        this.isSubmitting.set(false);
        return;
      }

      this.enviado.set(true);
    } catch {
      this.errorMessage.set('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private async uploadOrcamento(file: File): Promise<string | null> {
    const prepResp = await fetch('/api/fundo-fixo-public-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type }),
    });
    const prep = await prepResp.json().catch(() => ({ success: false }));
    if (!prepResp.ok || !prep.success) return null;

    const { error } = await this.supabaseService.client.storage
      .from('fundo-fixo-anexos')
      .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type });

    return error ? null : prep.path;
  }

  novaSolicitacao(): void {
    this.nomeSolicitante.set('');
    this.contato.set('');
    this.setor.set('Manutenção');
    this.fornecedor.set('');
    this.material.set('');
    this.linksProduto.set(['']);
    this.valorEstimado.set(null);
    this.observacoes.set('');
    this.orcamento.set(null);
    this.errorMessage.set('');
    this.enviado.set(false);
  }
}
