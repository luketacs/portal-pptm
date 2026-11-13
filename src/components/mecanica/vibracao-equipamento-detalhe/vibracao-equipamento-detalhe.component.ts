import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MecanicaVibracaoService } from '../../../services/mecanica-vibracao.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { AnaliseVibracao, EquipamentoVibracao, PontoMedicao } from '../../../models/mecanica-vibracao.model';
import { SerieLinha, drawLinhas, limparGrafico } from '../../../utils/charts';
import {
  ALARME_BADGE, ALARME_LABEL, FUNDACAO_LABEL, GRANDEZA_LABEL, GRUPO_ISO_LABEL, LIMITES_ISO, SITUACAO_BADGE, SITUACAO_LABEL, alarmeLeitura,
  formatarValor, numeroAnalise, piorSituacao, zonaDaLeitura,
} from '../../../utils/mecanica-vibracao';
import { formatarNumero } from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

// 'YYYY-MM-DD' → timestamp ao meio-dia local (evita a data voltar um dia por fuso).
const instante = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d, 12).getTime();
};
const dataCurta = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

// Histórico de vibração de um equipamento: pontos da rota com o último valor, tendência
// do ponto escolhido com as linhas de alerta/perigo (igual ao gráfico do SKF) e análises.
@Component({
  selector: 'app-vibracao-equipamento-detalhe',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './vibracao-equipamento-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VibracaoEquipamentoDetalheComponent implements OnInit, OnDestroy {
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly alarmeLabel = ALARME_LABEL;
  readonly alarmeBadge = ALARME_BADGE;
  readonly grandezaLabel = GRANDEZA_LABEL;
  readonly grupoLabel = GRUPO_ISO_LABEL;
  readonly fundacaoLabel = FUNDACAO_LABEL;
  readonly numero = numeroAnalise;
  readonly dataBr = dataBr;
  readonly fmt = formatarValor;
  readonly num = formatarNumero;

  private id = '';
  equip = signal<EquipamentoVibracao | null>(null);
  pontos = signal<PontoMedicao[]>([]);
  analises = signal<AnaliseVibracao[]>([]); // mais antiga primeiro
  carregando = signal(true);
  excluindo = signal(false);
  pontoGrafico = signal('');

  isAdmin = this.service.isAdmin;
  podeLancar = this.service.podeLancar;

  private grafico = viewChild<ElementRef>('grafico');

  ultima = computed(() => this.analises().at(-1) ?? null);
  fabricanteModelo = computed(() => [this.equip()?.fabricante, this.equip()?.modelo].filter(Boolean).join(' · '));
  historico = computed(() => [...this.analises()].reverse());

  // Pontos ativos + último valor medido de cada um.
  linhasPontos = computed(() => {
    const ultimo = new Map<string, { valor: number; data: string }>();
    for (const a of this.analises()) {
      for (const l of a.leituras) if (l.pontoId && l.valor !== null) ultimo.set(l.pontoId, { valor: l.valor, data: a.dataColeta });
    }
    const e = this.equip();
    return this.pontos().filter(p => p.ativo).map(p => {
      const u = ultimo.get(p.id) ?? null;
      const leitura = {
        pontoId: p.id, ponto: p.nome, grandeza: p.grandeza, unidade: p.unidade, valor: u?.valor ?? null, alarmeAlerta: p.alarmeAlerta,
        alarmePerigo: p.alarmePerigo, fatorCrista: null, curtose: null, frequenciaHz: null, observacao: null,
      };
      return {
        ponto: p, ultimo: u,
        zona: u ? zonaDaLeitura(leitura, e?.grupoIso ?? null, e?.fundacao ?? null) : null,
        alarme: u ? alarmeLeitura(u.valor, p.alarmeAlerta, p.alarmePerigo) : null,
      };
    });
  });

  // Pontos com pelo menos uma leitura (inclusive os que saíram da rota).
  pontosComLeitura = computed(() => {
    const lidos = new Set(this.analises().flatMap(a => a.leituras.filter(l => l.valor !== null).map(l => l.pontoId)));
    return this.pontos().filter(p => lidos.has(p.id));
  });

  pontoSelecionado = computed(() => this.pontos().find(p => p.id === this.pontoGrafico()) ?? null);

  constructor(
    private service: MecanicaVibracaoService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';

    effect(() => {
      const el = this.grafico();
      const p = this.pontoSelecionado();
      if (!el || !p) return;
      const serie: SerieLinha = { nome: p.nome, cor: 1, pontos: [] };
      for (const a of this.analises()) {
        const l = a.leituras.find(x => x.pontoId === p.id);
        if (l?.valor != null) serie.pontos.push({ x: instante(a.dataColeta), y: l.valor, nota: `${numeroAnalise(a.numero)} · ${SITUACAO_LABEL[a.situacao]}` });
      }
      const e = this.equip();
      // Velocidade em mm/s: limites das zonas da ISO; demais pontos: alarmes do SKF, se houver.
      const iso = p.grandeza === 'velocidade' && /mm\/s/i.test(p.unidade) && e?.grupoIso && e.fundacao ? LIMITES_ISO[e.grupoIso][e.fundacao] : null;
      const referencias = iso
        ? [{ valor: iso[0], rotulo: `A/B: ${formatarValor(iso[0])}` }, { valor: iso[1], rotulo: `B/C: ${formatarValor(iso[1])}` }, { valor: iso[2], rotulo: `C/D: ${formatarValor(iso[2])}` }]
        : [
          ...(p.alarmeAlerta !== null ? [{ valor: p.alarmeAlerta, rotulo: `Alerta: ${formatarValor(p.alarmeAlerta)}` }] : []),
          ...(p.alarmePerigo !== null ? [{ valor: p.alarmePerigo, rotulo: `Perigo: ${formatarValor(p.alarmePerigo)}` }] : []),
        ];
      drawLinhas(el, [serie], {
        ariaLabel: `Tendência do ponto ${p.nome} em ${p.unidade}`,
        eixoX: 'data', formatX: dataCurta, rotuloX: 'Data da coleta',
        formatY: v => formatarValor(v, p.unidade), referencias,
      });
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const [e, pontos, analises] = await Promise.all([
        this.service.buscarEquipamento(this.id), this.service.pontosDo(this.id, true), this.service.analisesDo(this.id),
      ]);
      this.equip.set(e);
      this.pontos.set(pontos);
      this.analises.set(analises);
      // Primeiro ponto com leitura; o de maior situação da última coleta, se houver.
      const comLeitura = this.pontosComLeitura();
      const piorZona = piorSituacao(this.linhasPontos().map(l => l.zona));
      const pior = piorZona ? this.linhasPontos().find(l => l.zona === piorZona) : undefined;
      this.pontoGrafico.set(pior?.ponto.id ?? comLeitura[0]?.id ?? '');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar o equipamento.');
    } finally {
      this.carregando.set(false);
    }
  }

  ngOnDestroy(): void {
    limparGrafico(this.grafico());
  }

  async excluir(): Promise<void> {
    const e = this.equip();
    if (!e || this.excluindo()) return;
    const n = this.analises().length;
    const ok = await this.confirmDialogService.confirm(
      `Excluir o equipamento ${e.tag}? Os pontos${n ? ` e as ${n} análise(s)` : ''} dele também serão apagados. Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.service.excluirEquipamento(e.id);
      this.notificationService.showSuccess(`Equipamento ${e.tag} excluído.`);
      await this.router.navigateByUrl('/mecanica/vibracao');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
