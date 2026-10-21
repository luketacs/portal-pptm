import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// "Cadastrar equipamento" do menu Elétrica: escolhe o tipo e abre o formulário certo.
// Uma entrada só no menu em vez de "Cadastrar Motor" + "Cadastrar Transformador".
@Component({
  selector: 'app-equipamento-novo',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="max-w-3xl mx-auto space-y-6">
      <div>
        <a routerLink="/eletrica/ensaios" class="text-xs font-semibold text-blue-600 hover:text-blue-700">← Equipamentos e ensaios</a>
        <h1 class="text-2xl font-bold text-gray-800 mt-1">Cadastrar equipamento</h1>
        <p class="text-sm text-gray-500 mt-1">Qual equipamento você vai cadastrar? Depois do cadastro já dá pra lançar o ensaio.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <a routerLink="/eletrica/ensaios/motores/novo"
          class="app-card p-6 space-y-2 border-2 border-transparent hover:border-blue-500 focus-visible:border-blue-500 focus:outline-none">
          <p class="text-lg font-bold text-blue-900">Motor</p>
          <p class="text-sm text-gray-600">Dados de placa, situação (instalado ou reserva) e aplicação.</p>
          <p class="text-xs text-gray-500">Ensaio: resistência de isolamento e índice de polarização (IEEE 43-2013).</p>
        </a>
        <a routerLink="/eletrica/ensaios/trafos/novo"
          class="app-card p-6 space-y-2 border-2 border-transparent hover:border-blue-500 focus-visible:border-blue-500 focus:outline-none">
          <p class="text-lg font-bold text-blue-900">Transformador</p>
          <p class="text-sm text-gray-600">Placa, ligações do primário e dos secundários, situação e aplicação.</p>
          <p class="text-xs text-gray-500">Ensaios: isolamento, resistência ôhmica e TTR (ANSI/NETA MTS).</p>
        </a>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquipamentoNovoComponent {}
