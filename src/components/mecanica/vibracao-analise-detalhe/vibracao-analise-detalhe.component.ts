import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AnexosGaleriaComponent } from '../../eletrica/anexos/anexos.component';
import { MecanicaVibracaoService } from '../../../services/mecanica-vibracao.service';
import { NotificationService } from '../../../services/notification.service';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { AnaliseVibracao, EquipamentoVibracao, PontoMedicao } from '../../../models/mecanica-vibracao.model';
import {
  ALARME_BADGE, ALARME_LABEL, GRANDEZA_LABEL, SITUACAO_BADGE, SITUACAO_DESCRICAO, SITUACAO_LABEL, TIPO_INSPECAO_LABEL, alarmeDaLeitura,
  alteracaoPct, avisoTendencia, formatarPct, formatarValor, identificarFrequencia, numeroAnalise, zonaDaLeitura,
} from '../../../utils/mecanica-vibracao';
import { baixarPdfVibracao } from '../../../utils/mecanica-vibracao-pdf';
import { formatarNumero } from '../../../utils/eletrica-ensaio';
import { dataBr } from '../../../utils/eletrica-reparo';

// Uma análise de vibração: status, diagnóstico, valores globais (zona ISO, alarme do SKF,
// % de alteração), anexos e o PDF do relatório.
@Component({
  selector: 'app-vibracao-analise-detalhe',
  standalone: true,
  imports: [CommonModule, RouterLink, AnexosGaleriaComponent],
  templateUrl: './vibracao-analise-detalhe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VibracaoAnaliseDetalheComponent implements OnInit {
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly situacaoBadge = SITUACAO_BADGE;
  readonly situacaoDescricao = SITUACAO_DESCRICAO;
  readonly alarmeLabel = ALARME_LABEL;
  readonly alarmeBadge = ALARME_BADGE;
  readonly tipoLabel = TIPO_INSPECAO_LABEL;
  readonly grandezaLabel = GRANDEZA_LABEL;
  readonly numero = numeroAnalise;
  readonly dataBr = dataBr;
  readonly fmt = formatarValor;
  readonly pct = formatarPct;
  readonly num = formatarNumero;

  private id = '';
  analise = signal<AnaliseVibracao | null>(null);
  equip = signal<EquipamentoVibracao | null>(null);
  private pontos = signal<PontoMedicao[]>([]);
  private outras = signal<AnaliseVibracao[]>([]);
  carregando = signal(true);
  gerandoPdf = signal(false);
  excluindo = signal(false);
  isAdmin = this.service.isAdmin;

  podeCorrigir = computed(() => {
    const a = this.analise();
    return !!a && this.service.podeCorrigir(a);
  });

  // Análises do equipamento antes desta (por data e número).
  private anterioresAnalises = computed(() => {
    const a = this.analise();
    if (!a) return [];
    return this.outras().filter(o => o.id !== a.id && (o.dataColeta < a.dataColeta || (o.dataColeta === a.dataColeta && o.numero < a.numero)));
  });

  // Último valor de cada ponto em coleta anterior a esta.
  private anteriores = computed(() => {
    const mapa = new Map<string, number>();
    for (const o of this.anterioresAnalises()) {
      for (const l of o.leituras) if (l.pontoId && l.valor !== null) mapa.set(l.pontoId, l.valor);
    }
    return mapa;
  });

  private fatores = computed(() => new Map(this.pontos().map(p => [p.id, p.fatores])));

  linhas = computed(() => {
    const a = this.analise();
    const e = this.equip();
    if (!a) return [];
    return a.leituras.map(l => {
      const anterior = l.pontoId ? this.anteriores().get(l.pontoId) ?? null : null;
      const fatores = l.pontoId ? this.fatores().get(l.pontoId) : undefined;
      return {
        leitura: l,
        alarme: alarmeDaLeitura(l),
        zona: zonaDaLeitura(l, e?.grupoIso ?? null, e?.fundacao ?? null),
        anterior,
        alteracao: alteracaoPct(l.valor, anterior),
        tendencia: avisoTendencia(l.valor, anterior, l.grandeza),
        frequencia: fatores ? identificarFrequencia(l.frequenciaHz, a.rotacaoRpm, fatores)[0] ?? null : null,
      };
    });
  });

  avisos = computed(() => this.linhas().flatMap(x => (x.tendencia ? [`${x.leitura.ponto}: ${x.tendencia}`] : [])));

  temDetalhes = computed(() => this.linhas().some(x =>
    x.leitura.fatorCrista !== null || x.leitura.curtose !== null || x.leitura.frequenciaHz !== null || !!x.leitura.observacao));

  constructor(
    private service: MecanicaVibracaoService,
    private notificationService: NotificationService,
    private confirmDialogService: ConfirmDialogService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
  }

  async ngOnInit(): Promise<void> {
    try {
      const a = await this.service.buscarAnalise(this.id);
      this.analise.set(a);
      if (a) {
        const [e, pontos, outras] = await Promise.all([
          this.service.buscarEquipamento(a.equipamentoId), this.service.pontosDo(a.equipamentoId, true), this.service.analisesDo(a.equipamentoId),
        ]);
        this.equip.set(e);
        this.pontos.set(pontos);
        this.outras.set(outras);
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao carregar a análise.');
    } finally {
      this.carregando.set(false);
    }
  }

  async baixarPdf(): Promise<void> {
    const a = this.analise();
    const e = this.equip();
    if (!a || !e || this.gerandoPdf()) return;
    this.gerandoPdf.set(true);
    try {
      await baixarPdfVibracao(a, e, {
        anteriores: this.anteriores(),
        fatores: this.fatores(),
        historico: this.anterioresAnalises().map(o => ({ numero: o.numero, dataColeta: o.dataColeta, situacao: o.situacao })),
      });
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao gerar o PDF.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  async excluir(): Promise<void> {
    const a = this.analise();
    if (!a || this.excluindo()) return;
    const ok = await this.confirmDialogService.confirm(
      `Excluir a análise ${numeroAnalise(a.numero)}? Esta ação não pode ser desfeita.`,
      { confirmLabel: 'Excluir análise', danger: true },
    );
    if (!ok) return;
    this.excluindo.set(true);
    try {
      await this.service.excluirAnalise(a.id);
      this.notificationService.showSuccess(`Análise ${numeroAnalise(a.numero)} excluída.`);
      await this.router.navigate(['/mecanica/vibracao/equipamentos', a.equipamentoId]);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.excluindo.set(false);
    }
  }
}
