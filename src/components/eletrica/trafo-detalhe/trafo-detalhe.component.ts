import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EquipamentoHistoricoComponent } from '../equipamento-historico/equipamento-historico.component';
import { EnsaioTermografia } from '../../../models/eletrica-termografia.model';
import { PRIORIDADE_ACAO, PRIORIDADE_BADGE, avaliarPontos, formatarTemp, piorPrioridade } from '../../../utils/eletrica-termografia';

import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { EnsaioTrafo, Transformador } from '../../../models/eletrica-trafo.model';
import { CorSerie, SerieLinha, drawLinhas, limparGrafico } from '../../../utils/charts';
import {
  CLASSE_LABEL, RESULTADO_BADGE, RESULTADO_LABEL, SITUACAO_BADGE, SITUACAO_LABEL, rotuloAplicacao, rotuloLocal, formatarMohm, formatarNumero, numeroEnsaio,
} from '../../../utils/eletrica-ensaio';
import {
  LIGACAO_LABEL, MATERIAL_LABEL, MEIO_LABEL, OHMICA_DESEQUILIBRIO_MAX_PCT, TTR_DESVIO_MAX_PCT, avaliarTrafo,
  circuitoTrafoLabel, circuitosIsolamento, formatarPct, formatarRelacao, irMinimoTrafoMohm, relacaoCalculada,
  tensaoCircuito, tensoesTexto,
} from '../../../utils/eletrica-trafo';
import { dataBr } from '../../../utils/eletrica-reparo';

const instante = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d, 12).getTime();
};
const dataCurta = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const cor = (i: number) => (Math.min(i, 5) + 1) as CorSerie;

// Histórico de um transformador: placa, critério e a tendência dos três ensaios ao longo do
// tempo (isolamento a 20 °C, diferença ôhmica entre fases e desvio do TTR).
@Component({
  selector: 'app-trafo-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, EquipamentoHistoricoComponent],
  templateUrl: './trafo-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrafoDetalheComponent implements OnInit, OnDestroy {
  readonly classeLabel = CLASSE_LABEL;
  readonly ligacaoLabel = LIGACAO_LABEL;
  readonly meioLabel = MEIO_LABEL;
  readonly materialLabel = MATERIAL_LABEL;
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly rotuloLocal = rotuloLocal;
  readonly rotuloAplicacao = rotuloAplicacao;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly fmt = formatarNumero;
  readonly pct = formatarPct;
  readonly relacao = formatarRelacao;
  readonly tensoes = tensoesTexto;

  private id = '';
  trafo = signal<Transformador | null>(null);
  ensaios = signal<EnsaioTrafo[]>([]);
  carregando = signal(true);

  termografias = computed(() => this._termografias().map(e => {
    const av = avaliarPontos(e.pontos, e.temperaturaAmbienteC);
    const quente = e.pontos.filter(p => p.temperaturaC !== null).sort((a, b) => (b.temperaturaC ?? 0) - (a.temperaturaC ?? 0))[0];
    return { ensaio: e, pior: piorPrioridade(av), maisQuente: quente ? `${formatarTemp(quente.temperaturaC)} · ${quente.ponto}` : '—' };
  }).reverse());
  private _termografias = signal<EnsaioTermografia[]>([]);
  readonly prioridadeBadge = PRIORIDADE_BADGE;
  readonly prioridadeAcao = PRIORIDADE_ACAO;
  excluindo = signal(false);
  isAdmin = this.ensaioService.isAdmin;

  private graficoIr = viewChild<ElementRef>('graficoIr');
  private graficoOhmica = viewChild<ElementRef>('graficoOhmica');
  private graficoTtr = viewChild<ElementRef>('graficoTtr');

  // Critério pela placa atual (o de cada ensaio fica na cópia dele).
  criterio = computed(() => {
    const t = this.trafo();
    if (!t) return null;
    const enrolamentos = [{ nome: 'H', tensao: t.tensaoPrimariaV }, ...t.secundarios.map(s => ({ nome: s.nome, tensao: s.tensaoV }))];
    return {
      isolamento: enrolamentos.map(e => ({ nome: e.nome, minimo: irMinimoTrafoMohm(e.tensao, t.meioIsolante) })),
      ttr: t.secundarios.map(s => ({ nome: s.nome, relacao: relacaoCalculada(t.tensaoPrimariaV, t.ligacaoPrimaria, s) })),
    };
  });

  historico = computed(() => this.ensaios()
    .map(e => {
      const av = avaliarTrafo(e);
      const des = av.ohmica.map(a => a.desequilibrioPct).filter((v): v is number => v !== null);
      const ttr = av.ttr.map(a => a.maiorDesvioPct).filter((v): v is number => v !== null);
      return {
        ensaio: e,
        partes: [e.isolamento.length && 'Isolamento', e.ohmica.length && 'Ôhmica', e.ttr.length && 'TTR'].filter(Boolean).join(' · '),
        maiorDiferenca: des.length ? Math.max(...des) : null,
        maiorDesvioTtr: ttr.length ? Math.max(...ttr) : null,
      };
    })
    .reverse());

  ultimo = computed(() => (this.historico().length ? this.historico()[0] : null));

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';

    effect(() => {
      const t = this.trafo();
      const ensaios = this.ensaios();
      if (!t || !ensaios.length) return;
      const el = { ir: this.graficoIr(), oh: this.graficoOhmica(), ttr: this.graficoTtr() };
      const ordemCircuitos = circuitosIsolamento(t.secundarios);
      const ordemEnrol = ['H', ...t.secundarios.map(s => s.nome)];

      const ir = new Map<string, SerieLinha>();
      const oh = new Map<string, SerieLinha>();
      const tt = new Map<string, SerieLinha>();
      ensaios.forEach(e => {
        const x = instante(e.dataEnsaio);
        const av = avaliarTrafo(e);
        av.isolamento.forEach((a, i) => {
          if (a.r1min20 === null) return;
          const s = ir.get(a.circuito) ?? { nome: circuitoTrafoLabel(a.circuito), cor: cor(Math.max(ordemCircuitos.indexOf(a.circuito), 0)), pontos: [] };
          s.pontos.push({ x, y: a.r1min20, nota: e.isolamento[i].foraEscala ? 'fundo de escala' : undefined });
          ir.set(a.circuito, s);
        });
        av.ohmica.forEach(a => {
          if (a.desequilibrioPct === null) return;
          const s = oh.get(a.enrolamento) ?? { nome: `Enrolamento ${a.enrolamento}`, cor: cor(Math.max(ordemEnrol.indexOf(a.enrolamento), 0)), pontos: [] };
          s.pontos.push({ x, y: a.desequilibrioPct });
          oh.set(a.enrolamento, s);
        });
        av.ttr.forEach(a => {
          if (a.maiorDesvioPct === null) return;
          const s = tt.get(a.secundario) ?? { nome: `H/${a.secundario}`, cor: cor(Math.max(ordemEnrol.indexOf(a.secundario), 0)), pontos: [] };
          s.pontos.push({ x, y: a.maiorDesvioPct });
          tt.set(a.secundario, s);
        });
      });

      const ordenar = (m: Map<string, SerieLinha>, ordem: string[]) =>
        [...m.entries()].sort((a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0])).map(([, s]) => s);
      const minimos = [...new Set(ordemCircuitos.map(c => irMinimoTrafoMohm(tensaoCircuito(c, { tensaoPrimariaV: t.tensaoPrimariaV, secundarios: t.secundarios }), t.meioIsolante)))];

      if (el.ir) {
        drawLinhas(el.ir, ordenar(ir, ordemCircuitos), {
          ariaLabel: 'Resistência de isolamento de 1 minuto corrigida a 20 °C, por circuito e por ensaio',
          eixoX: 'data', formatX: dataCurta, rotuloX: 'Data do ensaio', formatY: v => `${formatarMohm(v)} MΩ`, yLog: true, altura: 260,
          referencias: minimos.map(v => ({ valor: v, rotulo: `Mínimo NETA: ${formatarMohm(v)} MΩ` })),
        });
      }
      if (el.oh) {
        drawLinhas(el.oh, ordenar(oh, ordemEnrol), {
          ariaLabel: 'Diferença entre fases da resistência ôhmica, por enrolamento e por ensaio',
          eixoX: 'data', formatX: dataCurta, rotuloX: 'Data do ensaio', formatY: v => formatarPct(v),
          referencias: [{ valor: OHMICA_DESEQUILIBRIO_MAX_PCT, rotulo: `Máximo: ${OHMICA_DESEQUILIBRIO_MAX_PCT}%` }],
        });
      }
      if (el.ttr) {
        drawLinhas(el.ttr, ordenar(tt, ordemEnrol), {
          ariaLabel: 'Maior desvio do TTR em relação à relação calculada, por secundário e por ensaio',
          eixoX: 'data', formatX: dataCurta, rotuloX: 'Data do ensaio', formatY: v => formatarPct(v),
          referencias: [{ valor: TTR_DESVIO_MAX_PCT, rotulo: `Máximo: ${formatarNumero(TTR_DESVIO_MAX_PCT, 1)}%` }],
        });
      }
    });
  }

  ngOnInit(): void {
    this.recarregar();
  }

  // Também depois de uma troca (situação, aplicação e local mudam).
  async recarregar(): Promise<void> {
    try {
      const [t, e, termo] = await Promise.all([
        this.ensaioService.buscarTrafo(this.id), this.ensaioService.ensaiosDoTrafo(this.id), this.ensaioService.termografiasDo(this.id),
      ]);
      this.trafo.set(t);
      this.ensaios.set(e);
      this._termografias.set(termo);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o transformador.');
    } finally {
      this.carregando.set(false);
    }
  }

  ngOnDestroy(): void {
    limparGrafico(this.graficoIr());
    limparGrafico(this.graficoOhmica());
    limparGrafico(this.graficoTtr());
  }

  async excluir(): Promise<void> {
    const t = this.trafo();
    if (!t || this.excluindo()) return;
    const n = this.ensaios().length;
    const ok = await this.confirmDialogService.confirm(
      `Excluir o transformador ${t.tag}?${n ? ` Os ${n} ensaio(s) dele também serão apagados.` : ''} Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.ensaioService.excluirEquipamento(t.id);
      this.notificationService.showSuccess(`Transformador ${t.tag} excluído.`);
      await this.router.navigate(['/eletrica/ensaios'], { queryParams: { aba: 'trafos' } });
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
