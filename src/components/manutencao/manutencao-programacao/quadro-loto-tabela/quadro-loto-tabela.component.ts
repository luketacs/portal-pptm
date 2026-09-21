import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiaSemana, conflitoLotoTitle, lotoBadgeClass } from '../../../../utils/manutencao-regras';

export interface QuadroLotoItem {
  status: string;
  descricao: string;
  tecnicos: string[];
  numeroOs: string | null;
}

export interface QuadroLotoLinha {
  equipamento: string;
  dias: { data: string; itens: QuadroLotoItem[]; conflito: boolean }[];
  temConflito: boolean;
  separadorAntes: boolean;
}

export interface QuadroLotoCelulaClick {
  chave: string;
  itens: QuadroLotoItem[];
  event: MouseEvent;
}

// Tabela do quadro de bloqueios (LOTO) — extraída de manutencao-programacao pra reduzir o
// tamanho do componente host. Reaproveitada tanto pela semana única quanto por cada bloco
// do Horizonte de 4 semanas (antes um <ng-template>+ngTemplateOutlet, agora um componente
// de verdade). O popup de detalhe da célula continua no host — é um único elemento
// flutuante compartilhado por todas as instâncias desta tabela, não faz sentido duplicar.
@Component({
  selector: 'app-quadro-loto-tabela',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quadro-loto-tabela.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuadroLotoTabelaComponent {
  @Input() dias: DiaSemana[] = [];
  @Input() quadroLoto: QuadroLotoLinha[] = [];
  @Output() celulaClick = new EventEmitter<QuadroLotoCelulaClick>();

  readonly lotoBadgeClass = lotoBadgeClass;
  readonly conflitoLotoTitle = conflitoLotoTitle;

  onCelulaClick(equipamento: string, data: string, itens: QuadroLotoItem[], event: MouseEvent): void {
    this.celulaClick.emit({ chave: `${equipamento}:${data}`, itens, event });
  }
}
