import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { ExcelExportService } from '../../../services/excel-export.service';
import { NotificationService } from '../../../services/notification.service';
import {
  ApontamentoFeedback, FeedbackAvaliado, MOTIVO_DICA, MOTIVO_LABEL, MotivoFeedback,
  agruparPor, avaliarFeedbacks, contarMotivos, normalizarTexto, segundaDaSemana,
} from '../../../utils/feedback-qualidade';

type Aba = 'executantes' | 'lista';
type LinhaApi = [string, string, string, string, string, string, number | null, string, string];

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dataBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Qualidade dos Feedbacks dos apontamentos do SIGMA (só Admin). Regras em
// src/utils/feedback-qualidade.ts; dados ao vivo do export do SIGMA (cache 3 min).
@Component({
  selector: 'app-feedback-qualidade',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './feedback-qualidade.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackQualidadeComponent implements OnInit {
  private auth = inject(AuthService);
  private apontamentosService = inject(ApontamentosService);
  private excel = inject(ExcelExportService);
  private notify = inject(NotificationService);

  readonly motivoLabel = MOTIVO_LABEL;
  readonly motivoDica = MOTIVO_DICA;
  readonly dataBr = dataBr;

  // Padrão: últimas 8 semanas (segunda de 7 semanas atrás até hoje).
  de = signal(segundaDaSemana(isoLocal(new Date(Date.now() - 49 * 86400000))));
  ate = signal(isoLocal(new Date()));

  carregando = signal(false);
  erro = signal('');
  atualizadoEm = signal<number | null>(null);
  private avaliados = signal<FeedbackAvaliado[]>([]);
  private nomePorMatricula = signal(new Map<string, string>());

  aba = signal<Aba>('executantes');
  area = signal('');
  motivo = signal<MotivoFeedback | ''>('');
  executante = signal('');
  busca = signal('');
  soRuins = signal(true);
  limite = signal(200);

  nome = (mat: string) => this.nomePorMatricula().get(mat) ?? mat;

  areas = computed(() => [...new Set(this.avaliados().map(a => a.area).filter(Boolean))].sort());

  // Base dos indicadores: período + área (os outros filtros só afetam a lista).
  base = computed(() => {
    const area = this.area();
    return area ? this.avaliados().filter(a => a.area === area) : this.avaliados();
  });

  resumo = computed(() => {
    const b = this.base();
    const ruins = b.filter(a => a.ruim).length;
    return { total: b.length, ruins, pct: b.length ? Math.round((ruins / b.length) * 1000) / 10 : 0 };
  });

  motivos = computed(() => contarMotivos(this.base()));

  semanas = computed(() =>
    agruparPor(this.base(), a => segundaDaSemana(a.data)).sort((x, y) => x.chave.localeCompare(y.chave)),
  );

  executantes = computed(() =>
    agruparPor(this.base(), a => a.executante).map(g => ({
      ...g,
      nome: this.nome(g.chave),
      area: this.base().find(a => a.executante === g.chave)?.area ?? '',
      top: (Object.entries(g.porMotivo) as [MotivoFeedback, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2),
    })),
  );

  lista = computed(() => {
    const motivo = this.motivo();
    const exec = this.executante();
    const q = normalizarTexto(this.busca());
    return this.base()
      .filter(a => (!this.soRuins() || a.ruim)
        && (!motivo || a.motivos.includes(motivo))
        && (!exec || a.executante === exec)
        && (!q || normalizarTexto(`${a.numeroOs} ${a.feedback} ${this.nome(a.executante)} ${a.descricaoOs}`).includes(q)))
      .sort((x, y) => y.data.localeCompare(x.data) || y.numeroOs.localeCompare(x.numeroOs));
  });

  listaVisivel = computed(() => this.lista().slice(0, this.limite()));

  async ngOnInit() {
    const cols = await this.apontamentosService.loadColaboradores();
    this.nomePorMatricula.set(new Map(cols.map(c => [c.matricula, c.nome])));
    await this.carregar();
  }

  async carregar() {
    this.carregando.set(true);
    this.erro.set('');
    try {
      const token = await this.auth.getValidAccessToken();
      const params = new URLSearchParams({ feedbacks_de: this.de(), feedbacks_ate: this.ate() });
      const resp = await fetch(`/api/sigma-ordens-proxy?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.success) throw new Error(body?.error || 'Falha ao consultar o SIGMA.');
      const aps: ApontamentoFeedback[] = (body.linhas as LinhaApi[]).map(
        ([id, numeroOs, data, executante, area, status, horas, feedback, descricaoOs]) =>
          ({ id, numeroOs, data, executante, area, status, horas, feedback, descricaoOs }),
      );
      this.avaliados.set(avaliarFeedbacks(aps, new Set(body.osExistentes as string[])));
      this.atualizadoEm.set(body.atualizadoEm ?? Date.now());
      this.limite.set(200);
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.carregando.set(false);
    }
  }

  verExecutante(mat: string) {
    this.executante.set(mat);
    this.motivo.set('');
    this.aba.set('lista');
  }

  verMotivo(m: MotivoFeedback) {
    this.motivo.set(this.motivo() === m ? '' : m);
    this.soRuins.set(true);
    this.aba.set('lista');
  }

  limparFiltros() {
    this.motivo.set('');
    this.executante.set('');
    this.busca.set('');
    this.soRuins.set(true);
  }

  corPct(p: number): string {
    if (p >= 30) return 'text-red-700';
    if (p >= 15) return 'text-amber-700';
    return 'text-emerald-700';
  }

  async exportar() {
    try {
      const motivosTexto = (a: FeedbackAvaliado) => a.motivos.map(m => MOTIVO_LABEL[m]).join('; ');
      await this.excel.exportarAbas({
        titulo: `Qualidade dos Feedbacks ${dataBr(this.de())} a ${dataBr(this.ate())}`,
        abas: [
          {
            nome: 'Por executante',
            colunas: [
              { header: 'Matrícula', width: 12 }, { header: 'Executante', width: 34 }, { header: 'Área', width: 8 },
              { header: 'Apontamentos', width: 14 }, { header: 'Ruins', width: 10 }, { header: '% ruins', width: 10 },
              { header: 'Principais motivos', width: 50, quebra: true },
            ],
            linhas: this.executantes().map(e => [
              e.chave, e.nome, e.area, e.total, e.ruins, e.pct,
              e.top.map(([m, n]) => `${MOTIVO_LABEL[m]} (${n})`).join('; '),
            ]),
          },
          {
            nome: 'Por semana',
            colunas: [{ header: 'Semana (segunda)', width: 18 }, { header: 'Apontamentos', width: 14 }, { header: 'Ruins', width: 10 }, { header: '% ruins', width: 10 }],
            linhas: this.semanas().map(s => [dataBr(s.chave), s.total, s.ruins, s.pct]),
          },
          {
            nome: 'Feedbacks ruins',
            colunas: [
              { header: 'Data', width: 11 }, { header: 'OS', width: 9 }, { header: 'Descrição da OS', width: 36, quebra: true },
              { header: 'Executante', width: 28 }, { header: 'Área', width: 7 }, { header: 'Status', width: 8 },
              { header: 'Horas', width: 7 }, { header: 'Feedback', width: 60, quebra: true }, { header: 'Motivos', width: 30, quebra: true },
            ],
            linhas: this.base().filter(a => a.ruim)
              .sort((x, y) => y.data.localeCompare(x.data))
              .map(a => [dataBr(a.data), a.numeroOs, a.descricaoOs, this.nome(a.executante), a.area, a.status, a.horas, a.feedback, motivosTexto(a)]),
          },
        ],
      });
    } catch (e) {
      this.notify.show('Falha ao gerar o Excel.', 'error');
      console.error(e);
    }
  }
}
