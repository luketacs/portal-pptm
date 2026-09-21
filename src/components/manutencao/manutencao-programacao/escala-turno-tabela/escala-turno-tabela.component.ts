import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiaSemana } from '../../../../utils/manutencao-regras';
import { EquipeApoio, Turno, TURNO_LABEL } from '../../../../utils/escala-apoio';

export interface EscalaLinha {
  equipe: EquipeApoio;
  integrantesLabel: string;
  turnos: { data: string; label: string; turno: Turno }[];
}

// Tabela da Escala de turno (D/N/F) do Apoio — extraída de manutencao-programacao pra
// reduzir o tamanho do componente host. Reaproveitada tanto pela semana única quanto por
// cada bloco do Horizonte de 4 semanas (antes um <ng-template>+ngTemplateOutlet, agora um
// componente de verdade). Puramente de exibição, sem mutação — a escala em si só é
// editada em "Gerenciar Apoio".
@Component({
  selector: 'app-escala-turno-tabela',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './escala-turno-tabela.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EscalaTurnoTabelaComponent {
  @Input() dias: DiaSemana[] = [];
  @Input() escalaDaSemana: EscalaLinha[] = [];

  readonly turnoLabel = TURNO_LABEL;
}
