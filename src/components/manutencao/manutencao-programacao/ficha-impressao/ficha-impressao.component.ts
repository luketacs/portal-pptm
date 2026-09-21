import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AtividadeChecklist, ManutencaoOrdem } from '../../../../models/manutencao-programacao.model';

export interface FichaImpressaoOs {
  numeroOs: string | null;
  descricao: string;
  equipamento: string | null;
  loto: string | null;
  duracaoHoras: number | null;
  checklist: AtividadeChecklist[] | null;
  tecnicos: string[];
}

// Fichas impressas por OS (checklist pro executante de campo) — extraído de
// manutencao-programacao pra reduzir o tamanho do componente host. Puro derivado
// read-only sobre a lista já filtrada na tela (área/técnico/busca), sem mutação — só
// agrupa por OS e dispara window.print().
@Component({
  selector: 'app-ficha-impressao',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ficha-impressao.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FichaImpressaoComponent {
  private listaFiltradaSignal = signal<ManutencaoOrdem[]>([]);

  @Input() set listaFiltrada(valor: ManutencaoOrdem[]) {
    this.listaFiltradaSignal.set(valor);
  }

  // Agrupa por número de OS (uma OS com apoio de 2+ técnicos vira 2+ linhas em
  // manutencao_programacao, mas é 1 ficha só, com todos os técnicos listados — nunca
  // duplica o checklist). Só PREVENTIVA — pedido explícito do usuário: corretiva/melhoria
  // não tem plano nem checklist, a ficha inteira não deve nem ser gerada pra elas.
  fichas = computed<FichaImpressaoOs[]>(() => {
    const porChave = new Map<string, ManutencaoOrdem[]>();
    let semOsIdx = 0;
    for (const o of this.listaFiltradaSignal()) {
      if (o.tipo !== 'ordem') continue;
      if ((o.tipoServico || '').toUpperCase() !== 'PREVENTIVA') continue;
      const chave = o.numeroOs?.trim() ? o.numeroOs.trim() : `sem-os-${semOsIdx++}`;
      const lista = porChave.get(chave);
      if (lista) lista.push(o); else porChave.set(chave, [o]);
    }
    return [...porChave.values()].map(linhas => ({
      numeroOs: linhas[0].numeroOs,
      descricao: linhas[0].descricao,
      equipamento: linhas[0].equipamento,
      loto: linhas[0].loto,
      duracaoHoras: linhas[0].duracaoHoras,
      checklist: linhas[0].checklist,
      tecnicos: linhas.map(l => l.tecnicoNome),
    }));
  });

  imprimir(): void {
    setTimeout(() => window.print(), 50);
  }
}
