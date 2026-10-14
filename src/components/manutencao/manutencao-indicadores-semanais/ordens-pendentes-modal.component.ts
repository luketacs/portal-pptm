import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoriaIndicador } from '../../../models/manutencao-programacao.model';
import { OrdemPendente, mensagemOrdensNaoExecutadas } from '../../../utils/manutencao-dashboard';
import { CATEGORIA_LABEL } from '../../../utils/manutencao-indicadores';

// Janela "OS não executadas" dos Indicadores — aberta pelo número "Não Executadas" da
// tabela Desempenho por Área (tela interna e link público). Separa atrasadas (dia
// previsto já passou) das que ainda estão no prazo, filtra por área/técnico e copia a
// lista pro WhatsApp. Sem NotificationService (serve à página pública também): o
// retorno do "copiar" é o próprio texto do botão.
@Component({
  selector: 'app-ordens-pendentes-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ordens-pendentes-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensPendentesModalComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) titulo = '';
  @Input({ required: true }) periodo = '';
  @Input({ required: true }) itens: OrdemPendente[] = [];
  @Input() categoriaInicial: CategoriaIndicador | null | 'todas' = 'todas';
  @Output() fechar = new EventEmitter<void>();

  readonly categoriaLabel = CATEGORIA_LABEL;
  private itensSig = signal<OrdemPendente[]>([]);
  filtroCategoria = signal<string>('todas');
  filtroTecnico = signal<string>('todos');
  copiado = signal<'ok' | 'erro' | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(): void {
    this.itensSig.set(this.itens);
    this.filtroCategoria.set(this.categoriaInicial === null ? 'nao-classificado' : this.categoriaInicial);
    this.filtroTecnico.set('todos');
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  categorias = computed(() => [...new Set(this.itensSig().map(o => o.categoria ?? 'nao-classificado'))]);
  tecnicos = computed(() => [...new Set(this.itensSig().flatMap(o => o.executantes.map(e => e.nome)))].sort((a, b) => a.localeCompare(b, 'pt-BR')));

  filtrados = computed(() => {
    const cat = this.filtroCategoria();
    const tec = this.filtroTecnico();
    return this.itensSig().filter(o =>
      (cat === 'todas' || (o.categoria ?? 'nao-classificado') === cat)
      && (tec === 'todos' || o.executantes.some(e => e.nome === tec)));
  });
  atrasadas = computed(() => this.filtrados().filter(o => o.atrasada));
  noPrazo = computed(() => this.filtrados().filter(o => !o.atrasada));

  rotuloCategoria(c: string): string {
    return c === 'nao-classificado' ? 'Não classificado' : this.categoriaLabel[c as CategoriaIndicador] ?? c;
  }

  diaCurto(iso: string): string {
    const [a, m, d] = iso.split('-').map(Number);
    return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(a, m - 1, d).getDay()] + ` ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  async copiar(): Promise<void> {
    const partes = [this.titulo];
    if (this.filtroCategoria() !== 'todas') partes.push(this.rotuloCategoria(this.filtroCategoria()));
    if (this.filtroTecnico() !== 'todos') partes.push(this.filtroTecnico());
    try {
      await navigator.clipboard.writeText(mensagemOrdensNaoExecutadas(partes.join(' — '), this.periodo, this.filtrados()));
      this.copiado.set('ok');
    } catch {
      this.copiado.set('erro');
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copiado.set(null), 2500);
  }
}
