import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import {
  AcaoPrioritaria, DadosSemana, Destaque, ModoCalendarioSemana, PontoAtencao,
  analisarPontosAtencaoEAcoes, calcularPeriodoSemana, extrairHistoricoSemanas, gerarDestaques, parseIndicadoresSemanais,
} from '../../../utils/relatorio-semanal-pcm';
import { LinhaTempoGeometria, calcularLinhaTempo } from '../../../utils/relatorio-linha-tempo';
import { parseMatriculas } from '../../../utils/relatorio-colaboradores';
import {
  ColaboradorHoras, calcularHorasEOrdensApontadas, colaboradoresOperacaoEmManutencao, descricaoCurtaOrdem,
} from '../../../utils/relatorio-apontamentos';
import { carregarLocal, removerLocal, salvarLocal } from '../../../utils/relatorio-persistencia-local';

const CHAVE_STORAGE = 'pcm-relatorio-semanal-ultimo';

interface RelatorioSemanalSnapshot {
  dados: DadosSemana;
  pontosAtencao: PontoAtencao[];
  acoesPrioritarias: AcaoPrioritaria[];
  destaques: Destaque[];
  linhaTempo: LinhaTempoGeometria | null;
  colaboradoresOperacao: ColaboradorHoras[];
  descricoesOrdens: Record<string, string>;
  geradoEm: string; // ISO
}

function parseDataBr(str: string): Date {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

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
const STATUS_COR: Record<string, string> = { 'Dentro da Meta': '#4CAF50', 'Próximo da Meta': '#FF9800', 'Abaixo da Meta': '#F44336' };

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
  arquivoMatriculas = signal<File | null>(null);
  arquivoFechamento = signal<File | null>(null);
  semana = signal(semanaIsoAtual());
  ano = signal(new Date().getFullYear());
  modoCalendario = signal<ModoCalendarioSemana>('ISO');

  isProcessando = signal(false);
  errorMessage = signal('');

  dados = signal<DadosSemana | null>(null);
  pontosAtencao = signal<PontoAtencao[]>([]);
  acoesPrioritarias = signal<AcaoPrioritaria[]>([]);
  destaques = signal<Destaque[]>([]);
  linhaTempo = signal<LinhaTempoGeometria | null>(null);
  colaboradoresOperacao = signal<ColaboradorHoras[]>([]);
  descricoesOrdens = signal<Record<string, string>>({});
  geradoEm = signal<Date | null>(null);

  imprimindoSomenteOperacao = signal(false);

  imprimirSecaoOperacao(): void {
    this.imprimindoSomenteOperacao.set(true);
    const limpar = () => {
      this.imprimindoSomenteOperacao.set(false);
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => window.print(), 50);
  }

  constructor(private authService: AuthService) {
    this.restaurarSnapshot();
  }

  // O último relatório gerado fica salvo no navegador (localStorage), pra não
  // sumir da tela quando o usuário sai da página e volta ou atualiza o navegador.
  // Só o resultado já calculado é salvo, não os arquivos enviados.
  private salvarSnapshot(): void {
    const dados = this.dados();
    if (!dados) return;

    const snapshot: RelatorioSemanalSnapshot = {
      dados,
      pontosAtencao: this.pontosAtencao(),
      acoesPrioritarias: this.acoesPrioritarias(),
      destaques: this.destaques(),
      linhaTempo: this.linhaTempo(),
      colaboradoresOperacao: this.colaboradoresOperacao(),
      descricoesOrdens: this.descricoesOrdens(),
      geradoEm: (this.geradoEm() ?? new Date()).toISOString(),
    };
    salvarLocal(CHAVE_STORAGE, snapshot);
  }

  private restaurarSnapshot(): void {
    const snapshot = carregarLocal<RelatorioSemanalSnapshot>(CHAVE_STORAGE);
    if (!snapshot) return;

    this.dados.set(snapshot.dados);
    this.pontosAtencao.set(snapshot.pontosAtencao);
    this.acoesPrioritarias.set(snapshot.acoesPrioritarias);
    this.destaques.set(snapshot.destaques);
    this.linhaTempo.set(snapshot.linhaTempo);
    this.colaboradoresOperacao.set(snapshot.colaboradoresOperacao);
    this.descricoesOrdens.set(snapshot.descricoesOrdens ?? {});
    this.geradoEm.set(new Date(snapshot.geradoEm));
  }

  onFileSelected(event: Event): void {
    const file = this.selecionarArquivo(event.target as HTMLInputElement, ['.xlsx']);
    if (file) this.arquivo.set(file);
  }

  onMatriculasSelected(event: Event): void {
    const file = this.selecionarArquivo(event.target as HTMLInputElement, ['.xlsx']);
    if (file) this.arquivoMatriculas.set(file);
  }

  onFechamentoSelected(event: Event): void {
    const file = this.selecionarArquivo(event.target as HTMLInputElement, ['.xlsx']);
    if (file) this.arquivoFechamento.set(file);
  }

  private selecionarArquivo(input: HTMLInputElement, extensoes: string[]): File | null {
    const file = input.files?.[0] ?? null;
    this.errorMessage.set('');
    if (!file) return null;

    if (!extensoes.some(ext => file.name.toLowerCase().endsWith(ext))) {
      this.errorMessage.set(`Selecione um arquivo ${extensoes.join(' ou ')}.`);
      input.value = '';
      return null;
    }
    return file;
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
      const historico = extrairHistoricoSemanas(rows, this.semana());

      this.dados.set(dados);
      this.pontosAtencao.set(pontosAtencao);
      this.acoesPrioritarias.set(acoesPrioritarias);
      this.destaques.set(destaques);
      this.linhaTempo.set(calcularLinhaTempo(historico));

      const arqMatriculas = this.arquivoMatriculas();
      const arqFechamento = this.arquivoFechamento();
      if (arqMatriculas && arqFechamento) {
        const bufferMatriculas = await arqMatriculas.arrayBuffer();
        const wbMatriculas = XLSX.read(bufferMatriculas, { type: 'array', cellDates: false });
        const rowsMatriculas = XLSX.utils.sheet_to_json(
          wbMatriculas.Sheets[wbMatriculas.SheetNames[0]], { header: 1, defval: '', raw: true },
        ) as unknown[][];
        const matriculas = parseMatriculas(rowsMatriculas);

        const { inicio, fim } = calcularPeriodoSemana(this.semana(), this.ano(), this.modoCalendario());

        const bufferFechamento = await arqFechamento.arrayBuffer();
        const wbFechamento = XLSX.read(bufferFechamento, { type: 'array', cellDates: false });
        const nomeAbaApontamentos = wbFechamento.SheetNames.find(n => n.trim().toLowerCase() === 'apontamentos');
        if (!nomeAbaApontamentos) throw new Error('Aba "Apontamentos" não encontrada no arquivo de Fechamento Semanal.');
        const rowsApontamentos = XLSX.utils.sheet_to_json(
          wbFechamento.Sheets[nomeAbaApontamentos], { header: 1, defval: '', raw: true },
        ) as unknown[][];

        const dadosHoras = calcularHorasEOrdensApontadas(rowsApontamentos, {
          dataInicio: parseDataBr(inicio), dataFim: parseDataBr(fim), matriculas,
          horasProgramadasPorMatricula: {}, horasDisponiveisPorMatricula: {},
        });
        this.colaboradoresOperacao.set(colaboradoresOperacaoEmManutencao(dadosHoras.horasPorColaborador, matriculas));
        this.descricoesOrdens.set(dadosHoras.descricoesOrdens);
      } else {
        this.colaboradoresOperacao.set([]);
        this.descricoesOrdens.set({});
      }

      this.geradoEm.set(new Date());
      this.salvarSnapshot();
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
    this.linhaTempo.set(null);
    this.colaboradoresOperacao.set([]);
    this.descricoesOrdens.set({});
    this.geradoEm.set(null);
    this.errorMessage.set('');
    this.arquivo.set(null);
    this.arquivoMatriculas.set(null);
    this.arquivoFechamento.set(null);
    removerLocal(CHAVE_STORAGE);
  }

  imprimir(): void {
    window.print();
  }

  statusCor(status: string): string {
    return STATUS_COR[status] ?? '#757575';
  }

  descricaoOrdem(numero: string): string {
    return descricaoCurtaOrdem(this.descricoesOrdens(), numero);
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
