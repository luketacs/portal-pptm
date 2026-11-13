import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MecanicaVibracaoService } from '../../../services/mecanica-vibracao.service';
import { NotificationService } from '../../../services/notification.service';
import { AnaliseVibracao, Situacao } from '../../../models/mecanica-vibracao.model';
import { SITUACAO_BADGE, SITUACAO_LABEL, numeroAnalise } from '../../../utils/mecanica-vibracao';
import { dataBr } from '../../../utils/eletrica-reparo';

type Aba = 'equipamentos' | 'analises';
type FiltroSituacao = 'todas' | Situacao | 'sem';

const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Hoje (YYYY-MM-DD local) pra comparar com prazo.
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Análise de Vibração: equipamentos com a situação da última coleta e lista de análises.
@Component({
  selector: 'app-vibracao-lista',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './vibracao-lista.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VibracaoListaComponent implements OnInit {
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly numero = numeroAnalise;
  readonly dataBr = dataBr;
  readonly hoje = hojeIso();
  readonly filtros: { valor: FiltroSituacao; rotulo: string }[] = [
    { valor: 'todas', rotulo: 'Todas' }, { valor: 'D', rotulo: 'D – Crítica' }, { valor: 'C', rotulo: 'C – Alerta' }, { valor: 'B', rotulo: 'B – Boa' }, { valor: 'A', rotulo: 'A – Excelente' },
  ];

  aba = signal<Aba>('equipamentos');
  busca = signal('');
  filtroSituacao = signal<FiltroSituacao>('todas');
  area = signal('');

  isLoading = this.service.isLoading;
  podeLancar = this.service.podeLancar;

  private equipPorId = computed(() => new Map(this.service.equipamentos().map(e => [e.id, e])));

  // Equipamento + última análise (lista de análises já vem da mais nova pra mais antiga).
  linhas = computed(() => {
    const ultima = new Map<string, AnaliseVibracao>();
    const total = new Map<string, number>();
    for (const a of this.service.analises()) {
      if (!ultima.has(a.equipamentoId)) ultima.set(a.equipamentoId, a);
      total.set(a.equipamentoId, (total.get(a.equipamentoId) ?? 0) + 1);
    }
    return this.service.equipamentos().map(e => ({ equip: e, ultima: ultima.get(e.id) ?? null, total: total.get(e.id) ?? 0 }));
  });

  areas = computed(() => [...new Set(this.service.equipamentos().map(e => e.area?.trim()).filter((a): a is string => !!a))].sort());

  contagem = computed(() => {
    const l = this.linhas();
    return {
      total: l.length,
      critica: l.filter(x => x.ultima?.situacao === 'D').length,
      alerta: l.filter(x => x.ultima?.situacao === 'C').length,
      sem: l.filter(x => !x.ultima).length,
    };
  });

  equipamentosFiltrados = computed(() => {
    const termo = normalizar(this.busca().trim());
    const sit = this.filtroSituacao();
    const area = this.area();
    return this.linhas().filter(x => {
      if (area && x.equip.area?.trim() !== area) return false;
      if (sit === 'sem' && x.ultima) return false;
      if (sit !== 'todas' && sit !== 'sem' && x.ultima?.situacao !== sit) return false;
      if (!termo) return true;
      return [x.equip.tag, x.equip.descricao, x.equip.area, x.equip.tipoMaquina].some(c => normalizar(c).includes(termo));
    });
  });

  analisesFiltradas = computed(() => {
    const termo = normalizar(this.busca().trim());
    const sit = this.filtroSituacao();
    const area = this.area();
    const porId = this.equipPorId();
    return this.service.analises()
      .map(a => ({ analise: a, equip: porId.get(a.equipamentoId) ?? null }))
      .filter(x => {
        if (area && x.equip?.area?.trim() !== area) return false;
        if (sit === 'sem') return false;
        if (sit !== 'todas' && x.analise.situacao !== sit) return false;
        if (!termo) return true;
        return [numeroAnalise(x.analise.numero), x.equip?.tag, x.equip?.descricao, x.analise.diagnostico, x.analise.recomendacao,
          x.analise.criadoPorNome, ...x.analise.modosFalha].some(c => normalizar(c).includes(termo));
      });
  });

  constructor(private service: MecanicaVibracaoService, private notificationService: NotificationService) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.service.load();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar as análises de vibração.');
    }
  }

  prazoVencido(a: AnaliseVibracao): boolean {
    return !!a.prazo && (a.situacao === 'C' || a.situacao === 'D') && a.prazo < this.hoje;
  }
}
