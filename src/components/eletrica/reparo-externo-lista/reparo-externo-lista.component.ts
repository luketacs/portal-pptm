import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EletricaReparoService } from '../../../services/eletrica-reparo.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { ReparoStatus } from '../../../models/eletrica-reparo.model';
import {
  REPARO_STATUS, REPARO_STATUS_BADGE, REPARO_STATUS_LABEL, dataBr, numeroReparo, reparoEncerrado,
} from '../../../utils/eletrica-reparo';

type FiltroStatus = ReparoStatus | 'andamento' | 'todos';

// "Acompanhar reparos": todo mundo vê todos os reparos, com contagem por status. O
// supervisor de elétrica / Admin atualiza o status abrindo o reparo (antes era a tela
// separada "Controle de Reparos", hoje redireciona pra cá).
@Component({
  selector: 'app-reparo-externo-lista',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reparo-externo-lista.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReparoExternoListaComponent implements OnInit {
  readonly statusLista = REPARO_STATUS;
  readonly statusLabel = REPARO_STATUS_LABEL;
  readonly statusBadge = REPARO_STATUS_BADGE;
  readonly numero = numeroReparo;
  readonly dataBr = dataBr;

  filtroStatus = signal<FiltroStatus>('andamento');
  busca = signal('');

  isLoading = this.reparoService.isLoading;
  podeControlar = this.reparoService.podeControlar;

  // Na lista geral todo mundo vê todos os reparos (sugestão de usuário); "Só os meus"
  // filtra pelos que a pessoa abriu.
  soMeus = signal(false);

  private base = computed(() => {
    const todos = this.reparoService.reparos();
    if (!this.soMeus()) return todos;
    const uid = this.authService.currentUser()?.id;
    return todos.filter(r => r.solicitanteId === uid);
  });

  contagem = computed(() => {
    const c = {} as Record<ReparoStatus, number>;
    REPARO_STATUS.forEach(s => (c[s] = 0));
    this.base().forEach(r => c[r.status]++);
    return c;
  });
  emAndamento = computed(() => this.base().filter(r => !reparoEncerrado(r.status)).length);

  lista = computed(() => {
    const f = this.filtroStatus();
    const termo = this.busca().trim().toLowerCase();
    return this.base().filter(r => {
      if (f === 'andamento' && reparoEncerrado(r.status)) return false;
      if (f !== 'andamento' && f !== 'todos' && r.status !== f) return false;
      if (termo) {
        const texto = `${numeroReparo(r.numero)} ${r.numero} ${r.equipamento} ${r.fabricanteModelo ?? ''} ${r.tagSap ?? ''} `
          + `${r.numeroSerie ?? ''} ${r.solicitanteNome} ${r.fornecedor ?? ''}`;
        if (!texto.toLowerCase().includes(termo)) return false;
      }
      return true;
    });
  });

  constructor(
    private reparoService: EletricaReparoService,
    private authService: AuthService,
    private notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    this.reparoService.load().catch(err => this.notificationService.showError(err?.message || 'Erro ao carregar reparos.'));
  }
}
