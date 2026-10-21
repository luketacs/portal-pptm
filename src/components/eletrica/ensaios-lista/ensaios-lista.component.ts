import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { EnsaioIsolamento, Motor, ResultadoEnsaio } from '../../../models/eletrica-ensaio.model';
import {
  RESULTADO_BADGE, RESULTADO_LABEL, avaliarEnsaio, criterioDoEnsaio, formatarMohm, formatarNumero, numeroEnsaio,
  potenciaTexto,
} from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

type Filtro = 'todos' | ResultadoEnsaio | 'sem_ensaio';

interface LinhaMotor {
  motor: Motor;
  ultimo: EnsaioIsolamento | null;
  totalEnsaios: number;
  menorR1min40: number | null;
}

// Entrada do menu "Ensaios de Motores": cada motor com o último ensaio (é o que diz se
// ele está apto hoje) e, na outra aba, todos os ensaios lançados.
@Component({
  selector: 'app-ensaios-lista',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './ensaios-lista.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnsaiosListaComponent implements OnInit {
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly potencia = potenciaTexto;
  readonly fmt = formatarNumero;

  aba = signal<'motores' | 'ensaios'>('motores');
  filtro = signal<Filtro>('todos');
  busca = signal('');
  isLoading = this.ensaioService.isLoading;

  private motorPorId = computed(() => new Map(this.ensaioService.motores().map(m => [m.id, m])));

  linhas = computed<LinhaMotor[]>(() => {
    // ensaios vêm do mais novo pro mais antigo: o primeiro de cada motor é o último ensaio.
    const porMotor = new Map<string, EnsaioIsolamento[]>();
    this.ensaioService.ensaios().forEach(e => {
      const l = porMotor.get(e.equipamentoId) ?? [];
      l.push(e);
      porMotor.set(e.equipamentoId, l);
    });
    return this.ensaioService.motores().map(motor => {
      const lista = porMotor.get(motor.id) ?? [];
      const ultimo = lista[0] ?? null;
      return {
        motor,
        ultimo,
        totalEnsaios: lista.length,
        menorR1min40: ultimo ? avaliarEnsaio(ultimo.medicoes, criterioDoEnsaio(ultimo)).menorR1min40 : null,
      };
    });
  });

  contagem = computed(() => {
    const c = { todos: 0, aprovado: 0, reprovado: 0, sem_ensaio: 0 };
    this.linhas().forEach(l => {
      c.todos++;
      c[l.ultimo ? l.ultimo.resultado : 'sem_ensaio']++;
    });
    return c;
  });

  private casaBusca(texto: string): boolean {
    const termo = this.busca().trim().toLowerCase();
    return !termo || texto.toLowerCase().includes(termo);
  }

  motoresFiltrados = computed(() => {
    const f = this.filtro();
    return this.linhas().filter(l => {
      if (f === 'sem_ensaio' && l.ultimo) return false;
      if ((f === 'aprovado' || f === 'reprovado') && l.ultimo?.resultado !== f) return false;
      const m = l.motor;
      return this.casaBusca(`${m.tag} ${m.descricao ?? ''} ${m.localInstalacao ?? ''} ${m.fabricante ?? ''} ${m.modelo ?? ''} ${m.numeroSerie ?? ''}`);
    });
  });

  ensaiosFiltrados = computed(() => {
    const f = this.filtro();
    const motores = this.motorPorId();
    return this.ensaioService.ensaios()
      .map(e => ({ ensaio: e, motor: motores.get(e.equipamentoId) ?? null }))
      .filter(({ ensaio, motor }) => {
        if (f === 'sem_ensaio') return false;
        if ((f === 'aprovado' || f === 'reprovado') && ensaio.resultado !== f) return false;
        return this.casaBusca(`${numeroEnsaio(ensaio.numero)} ${ensaio.numero} ${motor?.tag ?? ''} ${motor?.localInstalacao ?? ''} `
          + `${ensaio.osNumero ?? ''} ${ensaio.criadoPorNome} ${ensaio.executantes.map(x => x.nome).join(' ')}`);
      });
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    this.ensaioService.load().catch(err => this.notificationService.showError(err?.message || 'Erro ao carregar os ensaios.'));
  }

  trocarAba(aba: 'motores' | 'ensaios'): void {
    this.aba.set(aba);
    if (aba === 'ensaios' && this.filtro() === 'sem_ensaio') this.filtro.set('todos');
  }
}
