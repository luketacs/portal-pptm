import { ChangeDetectionStrategy, Component, OnInit, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { MovimentoEquipamento, SituacaoEquipamento } from '../../../models/eletrica-ensaio.model';
import { SITUACAO_BADGE, SITUACAO_LABEL } from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Situação e trocas" na tela do motor / trafo: histórico (gravado pelo banco a cada
// mudança de situação, aplicação ou local) e o registro de troca instalado ↔ reserva.
@Component({
  selector: 'app-equipamento-historico',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="app-card p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-bold text-blue-900 uppercase tracking-wide">Situação e trocas</h2>
        @if (!abrindoTroca() && candidatos().length) {
          <button type="button" (click)="abrindoTroca.set(true)"
            class="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">Registrar troca</button>
        }
      </div>

      @if (abrindoTroca()) {
        <div class="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
          <p class="text-sm text-gray-700">
            @if (situacao() === 'instalado') {
              <strong>{{ tag() }}</strong> sai e uma reserva entra no lugar. A reserva assume a aplicação e o local de {{ tag() }}.
            } @else {
              <strong>{{ tag() }}</strong> (reserva) entra no lugar de um equipamento instalado, que passa a ser reserva.
            }
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">
                {{ situacao() === 'instalado' ? 'Reserva que entra' : 'Instalado que sai' }} <span class="text-red-500">*</span>
              </label>
              <select [ngModel]="outroId()" (ngModelChange)="outroId.set($event)" name="outro"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="" disabled>Escolha...</option>
                @for (c of candidatos(); track c.id) {
                  <option [value]="c.id">{{ c.tag }}{{ c.aplicacao ? ' — ' + c.aplicacao : '' }}{{ c.localInstalacao ? ' (' + c.localInstalacao + ')' : '' }}</option>
                }
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Data da troca</label>
              <input type="date" [ngModel]="data()" (ngModelChange)="data.set($event)" name="data"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Para onde vai o que sai</label>
              <input type="text" [ngModel]="localSai()" (ngModelChange)="localSai.set($event)" name="localSai"
                placeholder="Ex: Oficina elétrica, Reparo externo RE-005"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Motivo</label>
              <input type="text" [ngModel]="motivo()" (ngModelChange)="motivo.set($event)" name="motivo" placeholder="Ex: isolamento reprovado no EN-014"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" (click)="cancelar()" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" (click)="confirmar()" [disabled]="!outroId() || salvando()"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {{ salvando() ? 'Registrando...' : 'Registrar troca' }}
            </button>
          </div>
        </div>
      } @else if (!candidatos().length) {
        <p class="text-xs text-gray-500">
          {{ situacao() === 'instalado' ? 'Para registrar uma troca, cadastre uma reserva do mesmo tipo.' : 'Não há equipamento instalado do mesmo tipo para trocar.' }}
        </p>
      }

      @if (carregando()) {
        <p class="text-sm text-gray-500">Carregando...</p>
      } @else if (!movimentos().length) {
        <p class="text-sm text-gray-500">Sem histórico ainda.</p>
      } @else {
        <ol class="relative border-l border-slate-200 ml-2 space-y-4">
          @for (m of movimentos(); track m.id) {
            <li class="ml-4">
              <span class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white" [ngClass]="m.situacaoNova === 'reserva' ? 'bg-violet-500' : 'bg-sky-500'"></span>
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-semibold text-gray-800">{{ dataBr(m.dataMovimento) }}</span>
                <span class="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" [ngClass]="situacaoBadge[m.situacaoNova]">{{ situacaoLabel[m.situacaoNova] }}</span>
                @if (m.trocaId && m.substitutoTag) {
                  <span class="text-xs text-gray-600">{{ m.situacaoNova === 'instalado' ? 'entrou no lugar de' : 'substituído por' }} <strong>{{ m.substitutoTag }}</strong></span>
                }
              </div>
              <p class="text-xs text-gray-600 mt-0.5">
                {{ descricao(m) }}
              </p>
              <p class="text-[11px] text-gray-400">{{ m.motivo || '' }}{{ m.motivo && m.usuarioNome ? ' · ' : '' }}{{ m.usuarioNome || '' }}</p>
            </li>
          }
        </ol>
      }
    </section>
  `,
})
export class EquipamentoHistoricoComponent implements OnInit {
  equipamentoId = input.required<string>();
  tipo = input.required<'motor' | 'transformador'>();
  situacao = input.required<SituacaoEquipamento>();
  tag = input.required<string>();
  trocado = output<void>();

  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly dataBr = dataBr;

  movimentos = signal<MovimentoEquipamento[]>([]);
  carregando = signal(true);
  abrindoTroca = signal(false);
  outroId = signal('');
  data = signal(hojeIso());
  localSai = signal('');
  motivo = signal('');
  salvando = signal(false);

  // Instalado troca com reserva do mesmo tipo e vice-versa.
  candidatos = computed(() => {
    const lista = this.tipo() === 'motor' ? this.ensaioService.motores() : this.ensaioService.trafos();
    const quer: SituacaoEquipamento = this.situacao() === 'instalado' ? 'reserva' : 'instalado';
    return lista.filter(e => e.id !== this.equipamentoId() && e.situacao === quer);
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
  ) {
    // Recarrega o histórico quando a situação muda (depois de uma troca, por exemplo).
    effect(() => {
      this.situacao();
      this.carregar();
    });
  }

  ngOnInit(): void {
    if (!this.ensaioService.motores().length && !this.ensaioService.trafos().length) {
      this.ensaioService.load().catch(() => undefined);
    }
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      this.movimentos.set(await this.ensaioService.movimentos(this.equipamentoId()));
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o histórico.');
    } finally {
      this.carregando.set(false);
    }
  }

  descricao(m: MovimentoEquipamento): string {
    const partes: string[] = [];
    if (m.aplicacaoNova) partes.push(`${m.situacaoNova === 'reserva' ? 'Reserva de' : 'Aplicação'}: ${m.aplicacaoNova}`);
    if (m.localNovo) partes.push(`${m.situacaoNova === 'reserva' ? 'Armazenado em' : 'Local'}: ${m.localNovo}`);
    return partes.join(' · ') || '—';
  }

  cancelar(): void {
    this.abrindoTroca.set(false);
    this.outroId.set('');
    this.localSai.set('');
    this.motivo.set('');
  }

  async confirmar(): Promise<void> {
    const outro = this.candidatos().find(c => c.id === this.outroId());
    if (!outro || this.salvando()) return;
    const sai = this.situacao() === 'instalado' ? { id: this.equipamentoId(), tag: this.tag() } : { id: outro.id, tag: outro.tag };
    const entra = this.situacao() === 'instalado' ? { id: outro.id, tag: outro.tag } : { id: this.equipamentoId(), tag: this.tag() };
    const ok = await this.confirmDialogService.confirm(
      `Confirmar a troca: ${entra.tag} entra no lugar de ${sai.tag}, e ${sai.tag} passa a ser reserva${this.localSai().trim() ? ` em "${this.localSai().trim()}"` : ''}?`,
      { confirmLabel: 'Registrar troca' },
    );
    if (!ok) return;
    this.salvando.set(true);
    try {
      await this.ensaioService.trocar({ saiId: sai.id, entraId: entra.id, localSai: this.localSai(), data: this.data(), motivo: this.motivo() });
      this.notificationService.showSuccess(`Troca registrada: ${entra.tag} no lugar de ${sai.tag}.`);
      this.cancelar();
      this.trocado.emit();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao registrar a troca.');
    } finally {
      this.salvando.set(false);
    }
  }
}
