import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { AcaoPrioritaria, Destaque, PontoAtencao } from '../../../utils/relatorio-semanal-pcm';
import {
  DadosAcumulado, DadosMensal, MESES_ABREV, MESES_COMPLETO, MesAbrev,
  analisarPontosAtencaoEAcoesMensal, areasComMovimento, extrairHistoricoMeses, gerarDestaquesMensal, parseIndicadoresMensais,
} from '../../../utils/relatorio-mensal-pcm';
import { LinhaTempoGeometria, calcularLinhaTempo } from '../../../utils/relatorio-linha-tempo';
import { OrigemPrograma, RegistroMatricula, parseMatriculas } from '../../../utils/relatorio-colaboradores';
import { HorasProgramadasPorColaborador, extrairHorasProgramadasSemana, extrairPeriodoAba } from '../../../utils/relatorio-programacao-semanal';
import { agregarHorasPonto } from '../../../utils/relatorio-ponto';
import {
  ColaboradorHoras, DadosHoras, NomeNaoMapeado, calcularHorasEOrdensApontadas, colaboradoresOperacaoEmManutencao,
  mapearHorasDisponiveisPonto, mapearHorasProgramadasParaMatricula,
} from '../../../utils/relatorio-apontamentos';
import { calcularGraficoHoras } from '../../../utils/relatorio-horas-grafico';
import { carregarLocal, removerLocal, salvarLocal } from '../../../utils/relatorio-persistencia-local';

const CHAVE_STORAGE = 'pcm-relatorio-mensal-ultimo';

interface RelatorioMensalSnapshot {
  dadosMensal: DadosMensal;
  dadosAcumulado: DadosAcumulado;
  pontosAtencao: PontoAtencao[];
  acoesPrioritarias: AcaoPrioritaria[];
  destaques: Destaque[];
  linhaTempo: LinhaTempoGeometria | null;
  dadosHoras: DadosHoras | null;
  nomesNaoMapeados: NomeNaoMapeado[];
  colaboradoresOperacao: ColaboradorHoras[];
  geradoEm: string; // ISO
}

function mesAtualAbrev(): MesAbrev {
  return MESES_ABREV[new Date().getMonth()];
}

function isoParaBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function normalizarNomeAba(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
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
  arquivoProgramacao = signal<File[]>([]);
  arquivoPonto = signal<File | null>(null);
  arquivoMatriculas = signal<File | null>(null);
  arquivoFechamento = signal<File | null>(null);
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
  dadosHoras = signal<DadosHoras | null>(null);
  nomesNaoMapeados = signal<NomeNaoMapeado[]>([]);
  colaboradoresOperacao = signal<ColaboradorHoras[]>([]);
  geradoEm = signal<Date | null>(null);

  arquivoProgramacaoNomes = computed(() => this.arquivoProgramacao().map(f => f.name).join(', '));
  areasVisiveis = computed(() => areasComMovimento(this.dadosMensal()?.detalhesAreas ?? []));
  graficoHoras = computed(() => {
    const dh = this.dadosHoras();
    return dh ? calcularGraficoHoras(dh.horasPorColaborador) : null;
  });

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
    const dadosMensal = this.dadosMensal();
    const dadosAcumulado = this.dadosAcumulado();
    if (!dadosMensal || !dadosAcumulado) return;

    const snapshot: RelatorioMensalSnapshot = {
      dadosMensal, dadosAcumulado,
      pontosAtencao: this.pontosAtencao(),
      acoesPrioritarias: this.acoesPrioritarias(),
      destaques: this.destaques(),
      linhaTempo: this.linhaTempo(),
      dadosHoras: this.dadosHoras(),
      nomesNaoMapeados: this.nomesNaoMapeados(),
      colaboradoresOperacao: this.colaboradoresOperacao(),
      geradoEm: (this.geradoEm() ?? new Date()).toISOString(),
    };
    salvarLocal(CHAVE_STORAGE, snapshot);
  }

  private restaurarSnapshot(): void {
    const snapshot = carregarLocal<RelatorioMensalSnapshot>(CHAVE_STORAGE);
    if (!snapshot) return;

    this.dadosMensal.set(snapshot.dadosMensal);
    this.dadosAcumulado.set(snapshot.dadosAcumulado);
    this.pontosAtencao.set(snapshot.pontosAtencao);
    this.acoesPrioritarias.set(snapshot.acoesPrioritarias);
    this.destaques.set(snapshot.destaques);
    this.linhaTempo.set(snapshot.linhaTempo);
    this.dadosHoras.set(snapshot.dadosHoras);
    this.nomesNaoMapeados.set(snapshot.nomesNaoMapeados);
    this.colaboradoresOperacao.set(snapshot.colaboradoresOperacao);
    this.geradoEm.set(new Date(snapshot.geradoEm));
  }

  onFileSelected(event: Event): void {
    const file = this.selecionarArquivo(event.target as HTMLInputElement, ['.xlsx']);
    if (file) this.arquivo.set(file);
  }

  onProgramacaoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.errorMessage.set('');
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    if (files.some(f => !f.name.toLowerCase().endsWith('.xlsx'))) {
      this.errorMessage.set('Selecione apenas arquivos .xlsx.');
      input.value = '';
      return;
    }
    this.arquivoProgramacao.set(files);
  }

  onPontoSelected(event: Event): void {
    const file = this.selecionarArquivo(event.target as HTMLInputElement, ['.pdf']);
    if (file) this.arquivoPonto.set(file);
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
    return !!this.arquivo() && !this.isProcessando();
  }

  private periodoDatas(): { inicio: Date; fim: Date } {
    const ano = this.ano();
    const mesIdx = MESES_ABREV.indexOf(this.mes());
    const inicioIso = this.dataInicioIso();
    const fimIso = this.dataFimIso();
    const inicio = inicioIso ? new Date(`${inicioIso}T00:00:00Z`) : new Date(Date.UTC(ano, mesIdx, 1));
    const fim = fimIso ? new Date(`${fimIso}T00:00:00Z`) : new Date(Date.UTC(ano, mesIdx + 1, 0));
    return { inicio, fim };
  }

  // A programação tem dois jeitos de vir organizada: um arquivo por semana (abas
  // ELÉTRICA/MECÂNICA/APOIO — a área identifica a aba) ou um arquivo por mês/área
  // com uma aba por semana (S19..S31 — aí a área só dá pra saber pelo nome do
  // arquivo, e o arquivo cobre um intervalo bem maior que o período do relatório,
  // então cada aba de semana só entra se o período dela (lido do título, ex.:
  // "S27 2026 (29/06 À 05/07)") cruzar com o período do relatório).
  private async extrairOrigensProgramacao(
    files: File[], XLSX: typeof import('xlsx'), periodo: { inicio: Date; fim: Date },
  ): Promise<{ origem: OrigemPrograma; totais: HorasProgramadasPorColaborador }[]> {
    const abasEletrica: unknown[][][] = [];
    const abasMecanica: unknown[][][] = [];

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

      const nomeArquivoNorm = normalizarNomeAba(file.name);
      const origemArquivo: OrigemPrograma | null = nomeArquivoNorm.includes('ELETR')
        ? 'ELETRICA' : nomeArquivoNorm.includes('MECAN') ? 'MECANICA' : null;

      for (const nomeAba of wb.SheetNames) {
        const normalizadoAba = normalizarNomeAba(nomeAba);
        const origemAba: OrigemPrograma | null = normalizadoAba.includes('ELETR')
          ? 'ELETRICA' : normalizadoAba.includes('MECAN') ? 'MECANICA' : null;
        const origem = origemAba ?? origemArquivo;
        if (!origem) continue;

        const ws = wb.Sheets[nomeAba];
        this.limitarRangeSheet(ws, XLSX);
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];

        const periodoAba = extrairPeriodoAba(rows);
        if (periodoAba && (periodoAba.fim < periodo.inicio || periodoAba.inicio > periodo.fim)) continue;

        (origem === 'ELETRICA' ? abasEletrica : abasMecanica).push(rows);
      }
    }

    const origens: { origem: OrigemPrograma; totais: HorasProgramadasPorColaborador }[] = [];
    if (abasEletrica.length > 0) origens.push({ origem: 'ELETRICA', totais: extrairHorasProgramadasSemana(abasEletrica) });
    if (abasMecanica.length > 0) origens.push({ origem: 'MECANICA', totais: extrairHorasProgramadasSemana(abasMecanica) });
    return origens;
  }

  // Algumas abas declaram um range de milhões de linhas fantasma (formatação
  // aplicada na coluna inteira), o que deixa o sheet_to_json bem lento — trunca
  // antes de converter (dados reais dessas planilhas nunca passam de ~100 linhas).
  private limitarRangeSheet(ws: import('xlsx').WorkSheet, XLSX: typeof import('xlsx'), maxLinhas = 3000): void {
    const ref = ws['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r > maxLinhas) {
      range.e.r = maxLinhas;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }
  }

  private async parseMatriculasArquivo(file: File, XLSX: typeof import('xlsx')): Promise<RegistroMatricula[]> {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }) as unknown[][];
    return parseMatriculas(rows);
  }

  private async extrairTextoPdf(file: File): Promise<string[]> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const textos: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      textos.push(content.items.map(item => ('str' in item ? item.str : '') + ('hasEOL' in item && item.hasEOL ? '\n' : '')).join(''));
    }
    return textos;
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

      const arqMatriculas = this.arquivoMatriculas();
      const arqFechamento = this.arquivoFechamento();
      if (arqMatriculas && arqFechamento) {
        const periodo = this.periodoDatas();
        const matriculas = await this.parseMatriculasArquivo(arqMatriculas, XLSX);

        let origensProgramadas: { origem: OrigemPrograma; totais: HorasProgramadasPorColaborador }[] = [];
        const arqsProgramacao = this.arquivoProgramacao();
        if (arqsProgramacao.length > 0) {
          origensProgramadas = await this.extrairOrigensProgramacao(arqsProgramacao, XLSX, periodo);
        }
        const { horasPorMatricula: horasProgramadas, naoMapeados } =
          mapearHorasProgramadasParaMatricula(origensProgramadas, matriculas);

        let horasDisponiveis: Record<string, number> = {};
        const arqPonto = this.arquivoPonto();
        if (arqPonto) {
          const textosPorPagina = await this.extrairTextoPdf(arqPonto);
          const totaisPonto = agregarHorasPonto(textosPorPagina, periodo.inicio, periodo.fim);
          horasDisponiveis = mapearHorasDisponiveisPonto(totaisPonto, matriculas);
        }

        const bufferFechamento = await arqFechamento.arrayBuffer();
        const wbFechamento = XLSX.read(bufferFechamento, { type: 'array', cellDates: false });
        const nomeAbaApontamentos = wbFechamento.SheetNames.find(n => n.trim().toLowerCase() === 'apontamentos');
        if (!nomeAbaApontamentos) throw new Error('Aba "Apontamentos" não encontrada no arquivo de Fechamento Semanal.');
        const rowsApontamentos = XLSX.utils.sheet_to_json(
          wbFechamento.Sheets[nomeAbaApontamentos], { header: 1, defval: '', raw: true },
        ) as unknown[][];

        const dados = calcularHorasEOrdensApontadas(rowsApontamentos, {
          dataInicio: periodo.inicio, dataFim: periodo.fim, matriculas,
          horasProgramadasPorMatricula: horasProgramadas, horasDisponiveisPorMatricula: horasDisponiveis,
        });
        this.dadosHoras.set(dados);
        this.nomesNaoMapeados.set(naoMapeados);
        this.colaboradoresOperacao.set(colaboradoresOperacaoEmManutencao(dados.horasPorColaborador, matriculas));
      } else {
        this.dadosHoras.set(null);
        this.nomesNaoMapeados.set([]);
        this.colaboradoresOperacao.set([]);
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
    this.dadosMensal.set(null);
    this.dadosAcumulado.set(null);
    this.pontosAtencao.set([]);
    this.acoesPrioritarias.set([]);
    this.destaques.set([]);
    this.linhaTempo.set(null);
    this.dadosHoras.set(null);
    this.nomesNaoMapeados.set([]);
    this.colaboradoresOperacao.set([]);
    this.geradoEm.set(null);
    this.errorMessage.set('');
    this.arquivo.set(null);
    this.arquivoProgramacao.set([]);
    this.arquivoPonto.set(null);
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
