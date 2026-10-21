import { ChangeDetectionStrategy, Component, OnDestroy, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Anexo } from '../../../models/eletrica-ensaio.model';

// Item do editor: anexo já salvo (url) ou arquivo novo escolhido agora (file + preview).
// O upload acontece só ao salvar o ensaio (EletricaEnsaioService.subirAnexos).
export interface AnexoForm {
  url: string | null;
  file: File | null;
  preview: string | null;
  nome: string;
  tipo: Anexo['tipo'];
  legenda: string;
}

export const anexoParaForm = (a: Anexo): AnexoForm => ({ url: a.url, file: null, preview: null, nome: a.nome, tipo: a.tipo, legenda: a.legenda });

const LIMITE_MB = 20;

// Anexos do ensaio no formulário: foto (câmera no celular) ou PDF do instrumento.
@Component({
  selector: 'app-anexos-editor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (itens().length) {
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          @for (a of itens(); track $index; let i = $index) {
            <div class="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
              @if (a.tipo === 'imagem') {
                <img [src]="a.preview || a.url" [alt]="a.legenda || a.nome" class="h-20 w-24 shrink-0 rounded object-cover border border-slate-200 bg-white" />
              } @else {
                <div class="flex h-20 w-24 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-xs font-bold text-red-700">PDF</div>
              }
              <div class="min-w-0 flex-1 space-y-1">
                <p class="truncate text-xs text-gray-600" [title]="a.nome">{{ a.nome }}</p>
                <input type="text" [ngModel]="a.legenda" (ngModelChange)="legenda(i, $event)" [name]="'anexo' + i" placeholder="Legenda (ex.: tela do megôhmetro fase A)"
                  class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="button" (click)="remover(i)" class="text-xs font-semibold text-red-600 hover:text-red-700">Remover</button>
              </div>
            </div>
          }
        </div>
      } @else {
        <p class="text-sm text-gray-500">{{ dica() }}</p>
      }
      <div class="flex flex-wrap gap-3">
        <label class="cursor-pointer rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">
          + Foto
          <input type="file" accept="image/*" capture="environment" multiple class="sr-only" (change)="adicionar($event, 'imagem')" />
        </label>
        <label class="cursor-pointer rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">
          + PDF
          <input type="file" accept="application/pdf" multiple class="sr-only" (change)="adicionar($event, 'pdf')" />
        </label>
      </div>
      @if (erro()) { <p class="text-xs text-red-700">{{ erro() }}</p> }
    </div>
  `,
})
export class AnexosEditorComponent implements OnDestroy {
  itens = model<AnexoForm[]>([]);
  dica = input('Foto da tela do instrumento, relatório exportado em PDF, foto da placa...');
  erro = signal('');

  ngOnDestroy(): void {
    this.itens().forEach(a => a.preview && URL.revokeObjectURL(a.preview));
  }

  adicionar(event: Event, tipo: Anexo['tipo']): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.erro.set('');
    const novos: AnexoForm[] = [];
    for (const f of files) {
      const ok = tipo === 'pdf' ? f.type === 'application/pdf' : f.type.startsWith('image/');
      if (!ok) { this.erro.set(`"${f.name}" não é ${tipo === 'pdf' ? 'PDF' : 'imagem'}.`); continue; }
      if (f.size > LIMITE_MB * 1024 * 1024) { this.erro.set(`"${f.name}" passa de ${LIMITE_MB} MB.`); continue; }
      novos.push({ url: null, file: f, preview: tipo === 'imagem' ? URL.createObjectURL(f) : null, nome: f.name, tipo, legenda: '' });
    }
    this.itens.update(l => [...l, ...novos]);
  }

  legenda(i: number, valor: string): void {
    this.itens.update(l => l.map((a, j) => (j === i ? { ...a, legenda: valor } : a)));
  }

  remover(i: number): void {
    this.itens.update(l => {
      const a = l[i];
      if (a?.preview) URL.revokeObjectURL(a.preview);
      return l.filter((_, j) => j !== i);
    });
  }
}

// Anexos no detalhe do ensaio: imagens em grade (abre em nova aba), PDFs como link.
@Component({
  selector: 'app-anexos-galeria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (anexos().length) {
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        @for (a of anexos(); track a.url) {
          <a [href]="a.url" target="_blank" rel="noopener" class="block space-y-1 group">
            @if (a.tipo === 'imagem') {
              <img [src]="a.url" [alt]="a.legenda || a.nome" loading="lazy"
                class="aspect-[4/3] w-full rounded-lg border border-slate-200 object-cover group-hover:border-blue-400" />
            } @else {
              <div class="aspect-[4/3] w-full rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1 group-hover:border-blue-400">
                <span class="text-sm font-bold text-red-700">PDF</span>
                <span class="px-2 text-[11px] text-gray-500 truncate max-w-full">{{ a.nome }}</span>
              </div>
            }
            <p class="text-xs text-center text-gray-600 truncate" [title]="a.legenda || a.nome">{{ a.legenda || a.nome }}</p>
          </a>
        }
      </div>
    } @else {
      <p class="text-sm text-gray-500">Nenhum anexo.</p>
    }
  `,
})
export class AnexosGaleriaComponent {
  anexos = input<Anexo[]>([]);
}
