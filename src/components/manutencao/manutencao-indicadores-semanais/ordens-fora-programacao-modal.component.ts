import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoriaIndicador } from '../../../models/manutencao-programacao.model';
import { CATEGORIA_LABEL, OrdemForaProgramacao, mensagemOrdensForaProgramacao } from '../../../utils/manutencao-indicadores';

// Janela "Ordens fora da programação" dos Indicadores — aberta pelo número da coluna
// "Fora da Prog." da tabela Desempenho por Área (tela interna e link público). Lista as
// OS executadas na semana que não estavam na programação: dia, OS, serviço, quem apontou
// e horas; filtro por área e cópia pro WhatsApp (retorno no próprio botão, sem
// NotificationService — serve à página pública também).
@Component({
  selector: 'app-ordens-fora-programacao-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ordens-fora-programacao-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensForaProgramacaoModalComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) periodo = '';
  @Input({ required: true }) itens: OrdemForaProgramacao[] = [];
  @Input() categoriaInicial: CategoriaIndicador | 'todas' = 'todas';
  @Input() nomeDe: (matricula: string) => string = m => m;
  @Output() fechar = new EventEmitter<void>();

  readonly categoriaLabel = CATEGORIA_LABEL;
  private itensSig = signal<OrdemForaProgramacao[]>([]);
  filtroCategoria = signal<string>('todas');
  copiado = signal<'ok' | 'erro' | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(): void {
    this.itensSig.set(this.itens);
    this.filtroCategoria.set(this.categoriaInicial);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  categorias = computed(() => [...new Set(this.itensSig().map(o => o.categoria ?? 'outras'))]);
  filtrados = computed(() => {
    const cat = this.filtroCategoria();
    return this.itensSig().filter(o => cat === 'todas' || (o.categoria ?? 'outras') === cat);
  });
  horasTotal = computed(() => Math.round(this.filtrados().reduce((s, o) => s + o.horas, 0) * 100) / 100);

  rotuloCategoria(c: string): string {
    return c === 'outras' ? 'Outras áreas' : this.categoriaLabel[c as CategoriaIndicador] ?? c;
  }

  diaCurto(iso: string): string {
    const [a, m, d] = iso.split('-').map(Number);
    return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(a, m - 1, d).getDay()] + ` ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  async copiar(): Promise<void> {
    const titulo = 'Ordens fora da programação' + (this.filtroCategoria() !== 'todas' ? ` — ${this.rotuloCategoria(this.filtroCategoria())}` : '');
    try {
      await navigator.clipboard.writeText(mensagemOrdensForaProgramacao(titulo, this.periodo, this.filtrados(), this.nomeDe));
      this.copiado.set('ok');
    } catch {
      this.copiado.set('erro');
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copiado.set(null), 2500);
  }
}
