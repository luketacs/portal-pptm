import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { AcaoPrioritaria, Destaque, PontoAtencao } from '../../../utils/relatorio-semanal-pcm';
import {
  DadosAcumulado, DadosMensal, MESES_ABREV, MESES_COMPLETO, MesAbrev,
  analisarPontosAtencaoEAcoesMensal, extrairHistoricoMeses, gerarDestaquesMensal, parseIndicadoresMensais,
} from '../../../utils/relatorio-mensal-pcm';
import { LinhaTempoGeometria, calcularLinhaTempo } from '../../../utils/relatorio-linha-tempo';

function mesAtualAbrev(): MesAbrev {
  return MESES_ABREV[new Date().getMonth()];
}

function isoParaBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

const SEVERIDADE_LABEL: Record<PontoAtencao['severidade'], string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const PRIORIDADE_LABEL: Record<AcaoPrioritaria['prioridade'], string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const STATUS_COR: Record<string, string> = { 'Dentro da Meta': '#4CAF50', 'Próximo da Meta': '#FF9800', 'Abaixo da Meta': '#F44336' };

// Port do gerador de Relatório Mensal PCM (Fase 1: KPIs do mês + acumulado do ano —
// ver src/utils/relatorio-mensal-pcm.ts para o porquê da leitura por rótulo em vez
// de índice fixo). Reconciliação de horas/backlog fica para uma fase seguinte.
@Component({
  selector: 'app-relatorio-mensal-pcm',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './relatorio-mensal-pcm.component.html',
  styleUrls: ['./relatorio-mensal-pcm.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelatorioMensalPcmComponent {
  readonly meses = MESES_ABREV;
  readonly mesesCompleto = MESES_COMPLETO;
  readonly severidadeLabel = SEVERIDADE_LABEL;
  readonly prioridadeLabel = PRIORIDADE_LABEL;

  currentUser = this.authService.currentUser;

  arquivo = signal<File | null>(null);
  mes = signal<MesAbrev>(mesAtualAbrev());
  ano = signal(new Date().getFullYear());
  dataInicioIso = signal('');
  dataFimIso = signal('');

  isProcessando = signal(false);
  errorMessage = signal('');

  dadosMensal = signal<DadosMensal | null>(null);
  dadosAcumulado = signal<DadosAcumulado | null>(null);
  pontosAtencao = signal<PontoAtencao[]>([]);
  acoesPrioritarias = signal<AcaoPrioritaria[]>([]);
  destaques = signal<Destaque[]>([]);
  linhaTempo = signal<LinhaTempoGeometria | null>(null);
  geradoEm = signal<Date | null>(null);

  constructor(private authService: AuthService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.errorMessage.set('');
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.errorMessage.set('Selecione um arquivo .xlsx.');
      input.value = '';
      return;
    }
    this.arquivo.set(file);
  }

  canGerar(): boolean {
    return !!this.arquivo() && !this.isProcessando();
  }

  async gerarRelatorio(): Promise<void> {
    const file = this.arquivo();
    if (!file || !this.canGerar()) return;

    this.isProcessando.set(true);
    this.errorMessage.set('');

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

      const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'indicadores mensais') ?? wb.SheetNames[0];
      const ws = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!ws) throw new Error('Aba "Indicadores Mensais" não encontrada no arquivo.');

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];

      const dataInicioBr = this.dataInicioIso() ? isoParaBr(this.dataInicioIso()) : undefined;
      const dataFimBr = this.dataFimIso() ? isoParaBr(this.dataFimIso()) : undefined;

      const { dadosMensal, dadosAcumulado } = parseIndicadoresMensais(rows, this.mes(), this.ano(), dataInicioBr, dataFimBr);
      const { pontosAtencao, acoesPrioritarias } = analisarPontosAtencaoEAcoesMensal(dadosMensal, dadosAcumulado);
      const destaques = gerarDestaquesMensal(dadosMensal, dadosAcumulado);
      const historico = extrairHistoricoMeses(rows, this.mes());

      this.dadosMensal.set(dadosMensal);
      this.dadosAcumulado.set(dadosAcumulado);
      this.pontosAtencao.set(pontosAtencao);
      this.acoesPrioritarias.set(acoesPrioritarias);
      this.destaques.set(destaques);
      this.linhaTempo.set(calcularLinhaTempo(historico));
      this.geradoEm.set(new Date());
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao processar a planilha.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  novoRelatorio(): void {
    this.dadosMensal.set(null);
    this.dadosAcumulado.set(null);
    this.pontosAtencao.set([]);
    this.acoesPrioritarias.set([]);
    this.destaques.set([]);
    this.linhaTempo.set(null);
    this.geradoEm.set(null);
    this.errorMessage.set('');
  }

  imprimir(): void {
    window.print();
  }

  statusCor(status: string): string {
    return STATUS_COR[status] ?? '#757575';
  }

  severidadeIconClasse(sev: PontoAtencao['severidade']): string {
    if (sev === 'alta') return 'icon-critical';
    if (sev === 'media') return 'icon-warning';
    return 'icon-pending';
  }

  prioridadeIconClasse(p: AcaoPrioritaria['prioridade']): string {
    if (p === 'urgente') return 'icon-critical';
    if (p === 'alta') return 'icon-warning';
    if (p === 'media') return 'icon-info';
    return 'icon-pending';
  }
}
