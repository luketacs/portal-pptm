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
import { EnsaioIsolamento, Motor } from '../../../models/eletrica-ensaio.model';
import { CorSerie, SerieLinha, drawLinhas, limparGrafico } from '../../../utils/charts';
import {
  CLASSE_LABEL, RESULTADO_BADGE, RESULTADO_LABEL, SITUACAO_BADGE, SITUACAO_LABEL, rotuloAplicacao, rotuloLocal, TIPO_ACIONAMENTO_LABEL, TIPO_BOBINA_LABEL, avaliarEnsaio, circuitoLabel, criterioDoEnsaio,
  formatarIndice, formatarMohm, formatarNumero, ipMinimo, irMinimoMohm, numeroEnsaio, potenciaTexto,
  tensaoEnsaioRecomendada,
} from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

// Cor fixa por fase (a fase A é sempre a cor 1, mesmo se só houver B e C no gráfico).
const COR_CIRCUITO: Record<string, CorSerie> = { A: 1, B: 2, C: 3, ABC: 4 };

// 'YYYY-MM-DD' → timestamp ao meio-dia local (evita a data voltar um dia por fuso).
const instante = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d, 12).getTime();
};

const dataCurta = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

// Histórico de um motor: dados de placa, tendência do isolamento (IR 1 min a 40 °C) e do
// IP ao longo dos ensaios — é aqui que se vê o isolamento degradando antes de reprovar.
@Component({
  selector: 'app-motor-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, EquipamentoHistoricoComponent],
  templateUrl: './motor-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MotorDetalheComponent implements OnInit, OnDestroy {
  readonly classeLabel = CLASSE_LABEL;
  readonly bobinaLabel = TIPO_BOBINA_LABEL;
  readonly acionamentoLabel = TIPO_ACIONAMENTO_LABEL;
  readonly resultadoLabel = RESULTADO_LABEL;
  readonly resultadoBadge = RESULTADO_BADGE;
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly rotuloLocal = rotuloLocal;
  readonly rotuloAplicacao = rotuloAplicacao;
  readonly numero = numeroEnsaio;
  readonly dataBr = dataBr;
  readonly mohm = formatarMohm;
  readonly indice = formatarIndice;
  readonly fmt = formatarNumero;
  readonly potencia = potenciaTexto;

  private id = '';
  motor = signal<Motor | null>(null);
  ensaios = signal<EnsaioIsolamento[]>([]);
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
  private graficoIp = viewChild<ElementRef>('graficoIp');

  criterio = computed(() => {
    const m = this.motor();
    if (!m) return null;
    const rec = tensaoEnsaioRecomendada(m.tensaoV);
    return {
      irMin: irMinimoMohm(m.tipoBobina, m.tensaoV),
      ipMin: ipMinimo(m.classeIsolamento),
      tensaoRec: rec.min === rec.max ? `${rec.min} V` : `${rec.min} a ${rec.max} V`,
    };
  });

  // Ensaios com a avaliação pronta, do mais novo pro mais antigo (tabela).
  historico = computed(() => this.ensaios()
    .map(e => {
      const av = avaliarEnsaio(e.medicoes, criterioDoEnsaio(e));
      const ips = av.circuitos.filter(a => a.ipSituacao !== 'na' && a.ip !== null).map(a => a.ip as number);
      return { ensaio: e, menorR1min40: av.menorR1min40, menorIp: ips.length ? Math.min(...ips) : null, ipNa: av.circuitos.every(a => a.ipSituacao === 'na') };
    })
    .reverse());

  ultimo = computed(() => (this.historico().length ? this.historico()[0] : null));

  private series(campo: 'ir' | 'ip'): SerieLinha[] {
    const porCircuito = new Map<string, SerieLinha>();
    this.ensaios().forEach(e => {
      const av = avaliarEnsaio(e.medicoes, criterioDoEnsaio(e));
      av.circuitos.forEach((a, i) => {
        const valor = campo === 'ir' ? a.r1min40 : (a.ipSituacao === 'na' ? null : a.ip);
        if (valor === null) return;
        const s = porCircuito.get(a.circuito)
          ?? { nome: circuitoLabel(a.circuito).replace(' – Terra', ''), cor: COR_CIRCUITO[a.circuito] ?? 4, pontos: [] };
        s.pontos.push({ x: instante(e.dataEnsaio), y: valor, nota: e.medicoes[i].foraEscala ? 'fundo de escala' : undefined });
        porCircuito.set(a.circuito, s);
      });
    });
    return ['A', 'B', 'C', 'ABC'].map(c => porCircuito.get(c)).filter((s): s is SerieLinha => !!s);
  }

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';

    effect(() => {
      const c = this.criterio();
      const ir = this.graficoIr();
      const ip = this.graficoIp();
      if (!c || !this.ensaios().length) return;
      if (ir) {
        drawLinhas(ir, this.series('ir'), {
          ariaLabel: 'Resistência de isolamento de 1 minuto corrigida a 40 °C, por ensaio',
          eixoX: 'data', formatX: dataCurta, rotuloX: 'Data do ensaio',
          formatY: v => `${formatarMohm(v)} MΩ`, yLog: true,
          referencias: [{ valor: c.irMin, rotulo: `Mínimo IEEE 43: ${formatarMohm(c.irMin)} MΩ` }],
        });
      }
      if (ip) {
        drawLinhas(ip, this.series('ip'), {
          ariaLabel: 'Índice de polarização por ensaio',
          eixoX: 'data', formatX: dataCurta, rotuloX: 'Data do ensaio',
          formatY: v => formatarIndice(v),
          referencias: [{ valor: c.ipMin, rotulo: `Mínimo IEEE 43: ${formatarIndice(c.ipMin)}` }],
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
      const [m, e, termo] = await Promise.all([
        this.ensaioService.buscarMotor(this.id), this.ensaioService.ensaiosDoMotor(this.id), this.ensaioService.termografiasDo(this.id),
      ]);
      this.motor.set(m);
      this.ensaios.set(e);
      this._termografias.set(termo);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o motor.');
    } finally {
      this.carregando.set(false);
    }
  }

  ngOnDestroy(): void {
    limparGrafico(this.graficoIr());
    limparGrafico(this.graficoIp());
  }

  async excluir(): Promise<void> {
    const m = this.motor();
    if (!m || this.excluindo()) return;
    const n = this.ensaios().length;
    const ok = await this.confirmDialogService.confirm(
      `Excluir o motor ${m.tag}?${n ? ` Os ${n} ensaio(s) dele também serão apagados.` : ''} Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.ensaioService.excluirEquipamento(m.id);
      this.notificationService.showSuccess(`Motor ${m.tag} excluído.`);
      await this.router.navigateByUrl('/eletrica/ensaios');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
