import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import {
  AcaoPrioritaria, DadosSemana, Destaque, ModoCalendarioSemana, PontoAtencao,
  analisarPontosAtencaoEAcoes, gerarDestaques, parseIndicadoresSemanais,
} from '../../../utils/relatorio-semanal-pcm';

function semanaIsoAtual(): number {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const diaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
}

const SEVERIDADE_LABEL: Record<PontoAtencao['severidade'], string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const PRIORIDADE_LABEL: Record<AcaoPrioritaria['prioridade'], string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };

// Cores por status geral — iguais às do relatório original (era literal no HTML: {dados['status_cor']}).
const STATUS_COR: Record<string, string> = { 'EM DIA': '#4CAF50', 'ATENÇÃO': '#FF9800', 'CRÍTICO': '#F44336' };

// Port do gerador de Relatório Semanal PCM (antes um app desktop em Python) — lê a
// mesma planilha "Painel de Indicadores de PCM - 2026.xlsx" que a equipe já usa e
// gera o mesmo relatório, direto no navegador, sem precisar instalar nada. O layout
// (logos, cores, tabela) reproduz de propósito o relatório original — é um documento
// gerencial que já circula com essa identidade visual, não a tela padrão do Portal.
@Component({
  selector: 'app-relatorio-semanal-pcm',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './relatorio-semanal-pcm.component.html',
  styleUrls: ['./relatorio-semanal-pcm.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelatorioSemanalPcmComponent {
  readonly severidadeLabel = SEVERIDADE_LABEL;
  readonly prioridadeLabel = PRIORIDADE_LABEL;

  currentUser = this.authService.currentUser;

  arquivo = signal<File | null>(null);
  semana = signal(semanaIsoAtual());
  ano = signal(new Date().getFullYear());
  modoCalendario = signal<ModoCalendarioSemana>('ISO');

  isProcessando = signal(false);
  errorMessage = signal('');

  dados = signal<DadosSemana | null>(null);
  pontosAtencao = signal<PontoAtencao[]>([]);
  acoesPrioritarias = signal<AcaoPrioritaria[]>([]);
  destaques = signal<Destaque[]>([]);
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
    return !!this.arquivo() && this.semana() >= 1 && this.semana() <= 53 && !this.isProcessando();
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

      const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'indicadores semanais') ?? wb.SheetNames[0];
      const ws = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!ws) throw new Error('Aba "Indicadores Semanais" não encontrada no arquivo.');

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];

      const dados = parseIndicadoresSemanais(rows, this.semana(), this.ano(), this.modoCalendario());
      const { pontosAtencao, acoesPrioritarias } = analisarPontosAtencaoEAcoes(dados);
      const destaques = gerarDestaques(dados);

      this.dados.set(dados);
      this.pontosAtencao.set(pontosAtencao);
      this.acoesPrioritarias.set(acoesPrioritarias);
      this.destaques.set(destaques);
      this.geradoEm.set(new Date());
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao processar a planilha.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  novoRelatorio(): void {
    this.dados.set(null);
    this.pontosAtencao.set([]);
    this.acoesPrioritarias.set([]);
    this.destaques.set([]);
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
