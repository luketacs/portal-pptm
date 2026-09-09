import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TecnicoAtividade {
  nome: string;
  duracaoHoras: number | null;
}

// A mesma OS pode ter mais de um técnico (apoio) — o número da OS não repete no
// quadro, os técnicos entram todos no mesmo card (ver api/kanban-atividades-publico.js).
export interface CardAtividade {
  numeroOs: string | null;
  descricao: string;
  equipamento: string | null;
  tecnicos: TecnicoAtividade[];
  area: 'ELETRICA' | 'MECANICA';
  loto: string | null;
}

interface ColunasKanban {
  pendente: CardAtividade[];
  emExecucao: CardAtividade[];
  concluida: CardAtividade[];
}

const RECARREGAR_A_CADA_MS = 60 * 1000;

// Mesmo cálculo de semana ISO 8601 usado na Programação (numeroSemanaISO em
// manutencao-programacao.component.ts) — duplicado aqui porque esse componente é
// público/standalone, sem nenhuma dependência do resto do app.
function numeroSemanaISO(d: Date): number {
  const data = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const diaDaSemana = (data.getUTCDay() + 6) % 7;
  data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
  const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
  const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
  return 1 + Math.round(diffDias / 7);
}

// Quadro público (sem login) das atividades do dia — Elétrica + Mecânica, pensado pra
// ficar aberto numa TV da oficina. Só consome /api/kanban-atividades-publico, sem
// nenhuma dependência de AuthService/ManutencaoProgramacaoService (não precisa de sessão).
@Component({
  selector: 'app-kanban-oficina-publico',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kanban-oficina-publico.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KanbanOficinaPublicoComponent implements OnInit, OnDestroy {
  colunas = signal<ColunasKanban>({ pendente: [], emExecucao: [], concluida: [] });
  atualizadoEm = signal<number | null>(null);
  erro = signal('');
  carregando = signal(true);
  readonly hojeLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  readonly numeroSemana = numeroSemanaISO(new Date());

  private intervalId?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.carregar();
    this.intervalId = setInterval(() => this.carregar(), RECARREGAR_A_CADA_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  atualizadoEmLabel(): string {
    const ts = this.atualizadoEm();
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  private async carregar(): Promise<void> {
    try {
      const resp = await fetch('/api/kanban-atividades-publico');
      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) throw new Error(body?.error || 'Falha ao carregar o quadro.');
      this.colunas.set(body.colunas);
      this.atualizadoEm.set(body.atualizadoEm);
      this.erro.set('');
    } catch (err: unknown) {
      this.erro.set(err instanceof Error ? err.message : 'Não foi possível atualizar o quadro.');
    } finally {
      this.carregando.set(false);
    }
  }
}
