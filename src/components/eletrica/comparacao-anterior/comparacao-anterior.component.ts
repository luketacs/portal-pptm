import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ItemComparacao, formatarValorComparacao, formatarVariacao } from '../../../utils/eletrica-comparacao';

// "Comparação com o ensaio anterior" no detalhe do ensaio (motor e trafo).
@Component({
  selector: 'app-comparacao-anterior',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="app-card p-5 space-y-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-bold text-blue-900 uppercase tracking-wide">Comparação com o ensaio anterior</h2>
        @if (anteriorRotulo()) {
          <a [routerLink]="anteriorLink()" class="text-xs font-semibold text-blue-600 hover:text-blue-700">{{ anteriorRotulo() }} →</a>
        }
      </div>
      @if (!anteriorRotulo()) {
        <p class="text-sm text-gray-500">Primeiro ensaio deste equipamento no portal — a comparação aparece a partir do próximo.</p>
      } @else if (!itens().length) {
        <p class="text-sm text-gray-500">O ensaio anterior não tem as mesmas medições para comparar.</p>
      } @else {
        @if (alertas() > 0) {
          <p class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
            ⚠ {{ alertas() }} {{ alertas() === 1 ? 'item piorou' : 'itens pioraram' }} além do esperado desde o ensaio anterior. Não reprova, mas vale investigar.
          </p>
        }
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="text-xs text-slate-500 border-b border-slate-200">
                <th class="py-2 pr-2 text-left font-semibold">Item</th>
                <th class="py-2 px-2 text-left font-semibold">Grandeza</th>
                <th class="py-2 px-2 text-right font-semibold">Anterior</th>
                <th class="py-2 px-2 text-right font-semibold">Atual</th>
                <th class="py-2 px-2 text-right font-semibold">Variação</th>
                <th class="py-2 pl-2 text-left font-semibold">Aviso</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (i of itens(); track $index) {
                <tr>
                  <td class="py-2 pr-2 text-gray-800 whitespace-nowrap">{{ i.item }}</td>
                  <td class="py-2 px-2 text-gray-500">{{ i.grandeza }}</td>
                  <td class="py-2 px-2 text-right tabular-nums text-gray-600">{{ valor(i.grandeza, i.anterior) }}</td>
                  <td class="py-2 px-2 text-right tabular-nums text-gray-800">{{ valor(i.grandeza, i.atual) }}</td>
                  <td class="py-2 px-2 text-right tabular-nums" [ngClass]="i.alerta ? 'text-amber-700 font-semibold' : 'text-gray-600'">{{ variacao(i.variacaoPct) }}</td>
                  <td class="py-2 pl-2 text-xs" [ngClass]="i.alerta ? 'text-amber-800 font-semibold' : 'text-gray-400'">{{ i.alerta ? '⚠ ' + i.alerta : '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="text-xs text-gray-500">{{ regra() }}</p>
      }
    </section>
  `,
})
export class ComparacaoAnteriorComponent {
  itens = input<ItemComparacao[]>([]);
  anteriorRotulo = input<string | null>(null);
  anteriorLink = input<string[]>([]);
  regra = input('');
  readonly valor = formatarValorComparacao;
  readonly variacao = formatarVariacao;
  alertas = computed(() => this.itens().filter(i => i.alerta).length);
}
