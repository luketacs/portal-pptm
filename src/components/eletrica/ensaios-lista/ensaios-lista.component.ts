import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { EnsaioIsolamento, Motor, ResultadoEnsaio, SituacaoEquipamento } from '../../../models/eletrica-ensaio.model';
import { EnsaioTrafo, Transformador } from '../../../models/eletrica-trafo.model';
import {
  RESULTADO_BADGE, RESULTADO_LABEL, SITUACAO_BADGE, SITUACAO_LABEL, avaliarEnsaio, criterioDoEnsaio, formatarMohm, formatarNumero, numeroEnsaio,
  potenciaTexto,
} from '../../../utils/eletrica-ensaio';
import { tensoesTexto } from '../../../utils/eletrica-trafo';
import { dataBr } from '../../../utils/eletrica-reparo';

type Filtro = 'todos' | ResultadoEnsaio | 'sem_ensaio';
type Aba = 'motores' | 'trafos' | 'ensaios';

interface LinhaMotor {
  motor: Motor;
  ultimo: EnsaioIsolamento | null;
  totalEnsaios: number;
  menorR1min40: number | null;
}

interface LinhaTrafo {
  trafo: Transformador;
  ultimo: EnsaioTrafo | null;
  totalEnsaios: number;
}

interface LinhaEnsaio {
  id: string;
  numero: number;
  dataEnsaio: string;
  tipo: 'Motor' | 'Transformador';
  tag: string;
  local: string | null;
  osNumero: string | null;
  criadoPorNome: string;
  resultado: ResultadoEnsaio;
  link: string[];
  busca: string;
}

// Agrupa ensaios por equipamento; vêm do mais novo pro mais antigo, então o primeiro é o último ensaio.
function porEquipamento<T extends { equipamentoId: string }>(lista: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  lista.forEach(e => m.set(e.equipamentoId, [...(m.get(e.equipamentoId) ?? []), e]));
  return m;
}

// Entrada do menu "Ensaios Elétricos": cada motor / trafo com o último ensaio (é o que diz
// se ele está apto hoje) e, na outra aba, todos os ensaios lançados.
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
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly potencia = potenciaTexto;
  readonly fmt = formatarNumero;
  readonly tensoes = tensoesTexto;

  aba = signal<Aba>('motores');
  filtro = signal<Filtro>('todos');
  filtroSituacao = signal<SituacaoEquipamento | 'todas'>('todas');
  busca = signal('');
  isLoading = this.ensaioService.isLoading;

  linhasMotor = computed<LinhaMotor[]>(() => {
    const ensaios = porEquipamento(this.ensaioService.ensaios());
    return this.ensaioService.motores().map(motor => {
      const lista = ensaios.get(motor.id) ?? [];
      const ultimo = lista[0] ?? null;
      return {
        motor, ultimo, totalEnsaios: lista.length,
        menorR1min40: ultimo ? avaliarEnsaio(ultimo.medicoes, criterioDoEnsaio(ultimo)).menorR1min40 : null,
      };
    });
  });

  linhasTrafo = computed<LinhaTrafo[]>(() => {
    const ensaios = porEquipamento(this.ensaioService.ensaiosTrafo());
    return this.ensaioService.trafos().map(trafo => {
      const lista = ensaios.get(trafo.id) ?? [];
      return { trafo, ultimo: lista[0] ?? null, totalEnsaios: lista.length };
    });
  });

  todosEnsaios = computed<LinhaEnsaio[]>(() => {
    const motores = new Map(this.ensaioService.motores().map(m => [m.id, m]));
    const trafos = new Map(this.ensaioService.trafos().map(t => [t.id, t]));
    const deMotor = this.ensaioService.ensaios().map(e => {
      const m = motores.get(e.equipamentoId);
      return this.linhaEnsaio(e, 'Motor', m?.tag ?? '—', m?.localInstalacao ?? null, ['/eletrica/ensaios', e.id]);
    });
    const deTrafo = this.ensaioService.ensaiosTrafo().map(e => {
      const t = trafos.get(e.equipamentoId);
      return this.linhaEnsaio(e, 'Transformador', t?.tag ?? '—', t?.localInstalacao ?? null, ['/eletrica/ensaios/trafo', e.id]);
    });
    return [...deMotor, ...deTrafo].sort((a, b) => b.dataEnsaio.localeCompare(a.dataEnsaio) || b.numero - a.numero);
  });

  private linhaEnsaio(
    e: EnsaioIsolamento | EnsaioTrafo, tipo: LinhaEnsaio['tipo'], tag: string, local: string | null, link: string[],
  ): LinhaEnsaio {
    return {
      id: e.id, numero: e.numero, dataEnsaio: e.dataEnsaio, tipo, tag, local, osNumero: e.osNumero,
      criadoPorNome: e.criadoPorNome, resultado: e.resultado, link,
      busca: `${numeroEnsaio(e.numero)} ${e.numero} ${tag} ${local ?? ''} ${e.osNumero ?? ''} ${e.criadoPorNome} ${tipo} `
        + e.executantes.map(x => x.nome).join(' '),
    };
  }

  contagemSituacao = computed(() => {
    const lista = this.aba() === 'trafos' ? this.linhasTrafo().map(l => l.trafo) : this.linhasMotor().map(l => l.motor);
    return { instalado: lista.filter(e => e.situacao === 'instalado').length, reserva: lista.filter(e => e.situacao === 'reserva').length };
  });

  // Contagem pelo último ensaio, da aba atual.
  contagem = computed(() => {
    const c = { todos: 0, aprovado: 0, reprovado: 0, sem_ensaio: 0 };
    const ultimos = this.aba() === 'trafos' ? this.linhasTrafo().map(l => l.ultimo) : this.linhasMotor().map(l => l.ultimo);
    ultimos.forEach(u => {
      c.todos++;
      c[u ? u.resultado : 'sem_ensaio']++;
    });
    return c;
  });

  private casaBusca(texto: string): boolean {
    const termo = this.busca().trim().toLowerCase();
    return !termo || texto.toLowerCase().includes(termo);
  }

  private passaFiltro(ultimo: { resultado: ResultadoEnsaio } | null, situacao: SituacaoEquipamento): boolean {
    const fs = this.filtroSituacao();
    if (fs !== 'todas' && fs !== situacao) return false;
    const f = this.filtro();
    if (f === 'sem_ensaio') return !ultimo;
    if (f === 'aprovado' || f === 'reprovado') return ultimo?.resultado === f;
    return true;
  }

  motoresFiltrados = computed(() => this.linhasMotor().filter(l => {
    const m = l.motor;
    return this.passaFiltro(l.ultimo, m.situacao)
      && this.casaBusca(`${m.tag} ${m.aplicacao ?? ''} ${m.descricao ?? ''} ${m.localInstalacao ?? ''} ${m.fabricante ?? ''} ${m.modelo ?? ''} ${m.numeroSerie ?? ''}`);
  }));

  trafosFiltrados = computed(() => this.linhasTrafo().filter(l => {
    const t = l.trafo;
    return this.passaFiltro(l.ultimo, t.situacao)
      && this.casaBusca(`${t.tag} ${t.aplicacao ?? ''} ${t.descricao ?? ''} ${t.localInstalacao ?? ''} ${t.fabricante ?? ''} ${t.modelo ?? ''} ${t.numeroSerie ?? ''}`);
  }));

  ensaiosFiltrados = computed(() => {
    const f = this.filtro();
    return this.todosEnsaios().filter(e => (f === 'todos' || f === e.resultado) && this.casaBusca(e.busca));
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    const aba = route.snapshot.queryParamMap.get('aba');
    if (aba === 'trafos' || aba === 'ensaios') this.aba.set(aba);
  }

  ngOnInit(): void {
    this.ensaioService.load().catch(err => this.notificationService.showError(err?.message || 'Erro ao carregar os ensaios.'));
  }

  trocarAba(aba: Aba): void {
    this.aba.set(aba);
    if (aba === 'ensaios' && this.filtro() === 'sem_ensaio') this.filtro.set('todos');
    // Guarda a aba na URL: voltar de um trafo cai na aba de trafos.
    this.router.navigate([], { queryParams: { aba: aba === 'motores' ? null : aba }, replaceUrl: true });
  }
}
