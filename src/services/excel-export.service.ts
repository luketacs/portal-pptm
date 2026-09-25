import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx-js-style';
import type { CellStyle, WorkSheet, WorkBook } from 'xlsx-js-style';
import type * as ExcelJS from 'exceljs';
import type { MaterialComSAs, Movimentacao, SaldoReal } from './almoxarifado.service';

export interface FechamentoFundoFixoLinha {
  fornecedor: string;
  solicitante: string;
  setor: string;
  material: string;
  valor: number;
  aprovador: string;
}

// Layout do export replica o Excel que o time já usava (ex.: "PROGRAMAÇÃO ELÉTRICA
// JUL.xlsx") — cabeçalho ORDEM/DESCRIÇÃO/DURAÇÃO/EQUIPAMENTO/RECURSOS/LOTO/ÁREA DE
// ATUAÇÃO, 7 colunas de dia (datas reais + SEG..DOM), um bloco por técnico com o nome
// mesclado na lateral. Não replica marcadores manuais que a planilha original tinha
// (DSR, "trab", "BH") porque o Portal não rastreia esses códigos — só marca os dias em
// que a linha está prevista. Sem coluna de status/execução — pedido do usuário.
export interface ProgramacaoSemanalLinha {
  tipo: 'ordem' | 'folga' | 'treinamento' | 'exame_medico' | 'reuniao';
  numeroOs: string | null;
  semOs: boolean;
  descricao: string;
  duracaoHoras: number | null;
  equipamento: string;
  recursos: string;
  loto: string;
  areaAtuacao: string;
  diasPrevistos: string[]; // datas ISO ('YYYY-MM-DD') dentro da semana exportada
}

export interface ProgramacaoSemanalGrupo {
  tecnico: string;
  linhas: ProgramacaoSemanalLinha[];
  feriasAte?: string; // "DD/MM/AAAA" — presente quando o técnico está de férias na semana
  atestadoAte?: string; // "DD/MM/AAAA" — presente quando o técnico está de atestado médico na semana
}

export interface ProgramacaoSemanalDia {
  data: string;   // ISO
  diaMes: string; // "27/7" — igual ao cabeçalho da planilha original
  label: string;  // "SEG"
}

// Export da tela de Planos de Manutenção (Ativo/Inativo, uma linha por plano — não tem
// nada de dia/semana em grade, é lista simples) — campos já formatados como texto
// (datas 'DD/MM/AAAA', "S38" pra semana, "—" pra vazio) porque quem usa isso não é
// código, é o time revisando/repassando a planilha por fora do Portal.
export interface PlanoManutencaoExportLinha {
  codigo: string;
  nome: string;
  equipamento: string;
  tagKks: string;
  area: string;
  especialidade: string;
  descricao: string;
  periodicidade: string;
  responsavel: string;
  dataInicial: string;
  ultimaExecucao: string;
  proximaExecucao: string;
  semanaPrevista: string;
  status: 'Ativo' | 'Inativo';
  tempoEstimadoHoras: string;
  hhEstimado: string;
  observacoes: string;
  checklist: string; // "5 passos" / "—"
}

// Mapa de intervenções (52 semanas) — mesma grade da tela de Planos › Calendário.
export interface MapaIntervencoesExportLinha {
  codigo: string;
  nome: string;
  equipamento: string;
  tagKks: string;
  area: string;
  periodicidade: string;
  sigla: string; // S, Q, 3S, M, B, T, 4M, 6M, A, 2A
  mensalNaParada: boolean;
  celulas: Record<number, 'programada' | 'prevista'>; // chave = nº da semana ISO
}

export interface MapaIntervencoesExport {
  titulo: string;
  subtitulo: string;
  semanas: { numero: number; inicio: string; fim: string }[];
  semanaAtual: number | null; // null quando o ano exportado não é o atual
  linhas: MapaIntervencoesExportLinha[];
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {

  private enc(r: number, c: number): string {
    return XLSX.utils.encode_cell({ r, c });
  }

  private nowStr(): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date());
  }

  private formatDate(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  private todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  // Nome de aba do Excel tem limite de 31 caracteres e não aceita : \ / ? * [ ] — nomes
  // como "Programação Mecânica Semana 37" cabem tranquilo, mas corta em segurança pra
  // não quebrar o export se algum dia o texto vier maior (ex.: "Geral" combinando duas
  // áreas com nome mais longo).
  private nomeAbaSeguro(nome: string): string {
    return nome.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
  }

  // ── Estilos ────────────────────────────────────────────────────────────────

  private sTitle(): CellStyle {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
      fill: { fgColor: { rgb: '1F4E79' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
  }

  private sSub(): CellStyle {
    return {
      font: { color: { rgb: '1F4E79' }, sz: 9 },
      fill: { fgColor: { rgb: 'EBF3FB' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  private sHeader(align: 'left' | 'center' | 'right' = 'center'): CellStyle {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
      fill: { fgColor: { rgb: '2E75B6' }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center', wrapText: true },
      border: { bottom: { color: { rgb: 'FFFFFF' }, style: 'medium' } },
    };
  }

  private sMat(align: 'left' | 'center' | 'right' = 'left'): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '1A1A1A' } },
      fill: { fgColor: { rgb: 'F2F2F2' }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center' },
    };
  }

  private sSA(align: 'left' | 'center' | 'right' = 'left'): CellStyle {
    return {
      font: { sz: 10, color: { rgb: '444444' } },
      fill: { fgColor: { rgb: 'FFFFFF' }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center' },
    };
  }

  private sData(align: 'left' | 'center' | 'right' = 'left', even = false): CellStyle {
    return {
      font: { sz: 10, color: { rgb: '333333' } },
      fill: { fgColor: { rgb: even ? 'EEF5FF' : 'FFFFFF' }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center' },
    };
  }

  private sParcial(): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '7C3A00' } },
      fill: { fgColor: { rgb: 'FFD966' }, patternType: 'solid' },
      alignment: { horizontal: 'right', vertical: 'center' },
    };
  }

  private sTotal(align: 'left' | 'center' | 'right' = 'left'): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '1A1A1A' } },
      fill: { fgColor: { rgb: 'FFE699' }, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center' },
      border: { top: { color: { rgb: 'CCAA00' }, style: 'medium' } },
    };
  }

  private sSecao(): CellStyle {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
      fill: { fgColor: { rgb: '2E5C8A' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  private sTotalSalmao(): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '7A1F1F' } },
      fill: { fgColor: { rgb: 'F4A8A0' }, patternType: 'solid' },
      alignment: { horizontal: 'right', vertical: 'center' },
    };
  }

  private sReferenciaVerde(): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '2E5C2E' } },
      fill: { fgColor: { rgb: 'C6E0B4' }, patternType: 'solid' },
      alignment: { horizontal: 'right', vertical: 'center' },
    };
  }

  private sCaixaAmarelo(): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '7C3A00' } },
      fill: { fgColor: { rgb: 'FFE699' }, patternType: 'solid' },
      alignment: { horizontal: 'right', vertical: 'center' },
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private fillRow(ws: WorkSheet, row: number, ncols: number, style: CellStyle): void {
    for (let c = 0; c < ncols; c++) {
      ws[this.enc(row, c)] = { v: '', t: 's', s: style };
    }
  }

  private n(ws: WorkSheet, r: number, c: number, v: number, style: CellStyle, z: string): void {
    ws[this.enc(r, c)] = { v, t: 'n', s: style, z };
  }

  private s(ws: WorkSheet, r: number, c: number, v: string | null | undefined, style: CellStyle): void {
    ws[this.enc(r, c)] = { v: v ?? '—', t: 's', s: style };
  }

  // ── Exportar Aguardando Retirada ──────────────────────────────────────────

  // Confere se o saldo físico real atende o total solicitado (soma das SAs pendentes)
  // do material — não a quantidade de entrada. Ausência no arquivo de saldo = saldo 0.
  private saldoStatusLabel(item: MaterialComSAs, real: SaldoReal | undefined, temConferencia: boolean): string {
    if (!temConferencia) return '—';
    const saldoReal  = real?.saldo_qtd ?? 0;
    const solicitado = item.sas.reduce((s, sa) => s + sa.qtd_solicitada, 0);
    return saldoReal >= solicitado - 0.01 ? 'Disponível' : 'Insuficiente';
  }

  private sSaldoStatus(label: string): CellStyle {
    const cores: Record<string, string> = { 'Disponível': 'C6E0B4', 'Insuficiente': 'F8696B', '—': 'FFFFFF' };
    return {
      font: { bold: label !== '—', sz: 10, color: { rgb: '1A1A1A' } },
      fill: { fgColor: { rgb: cores[label] ?? 'FFFFFF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  exportarAguardandoRetirada(
    dados: MaterialComSAs[],
    totalGeral: { qtd: number; valor: number },
    saldoRealMap: Map<string, SaldoReal>,
    temConferencia: boolean,
  ): void {
    const NC = 17;
    const ws: WorkSheet = {};
    let row = 0;

    // Título
    this.fillRow(ws, row, NC, this.sTitle());
    ws[this.enc(row, 0)] = { v: 'MATERIAIS COM SA PENDENTE DE RETIRADA', t: 's', s: this.sTitle() };
    row++;

    // Subtítulo
    this.fillRow(ws, row, NC, this.sSub());
    ws[this.enc(row, 0)] = {
      v: `${dados.length} material(is)  |  Gerado em ${this.nowStr()}`,
      t: 's', s: this.sSub(),
    };
    row++;

    // Cabeçalhos
    const headers: Array<[string, 'left' | 'center' | 'right']> = [
      ['Nº',               'center'],
      ['Código',           'left'  ],
      ['Descrição',        'left'  ],
      ['UM',               'center'],
      ['Grupo',            'center'],
      ['Qtd. Entrada',     'right' ],
      ['Saldo Real',       'right' ],
      ['Confere?',         'center'],
      ['Saldo Qtd.',       'right' ],
      ['Custo Médio (R$)', 'right' ],
      ['Valor Total (R$)', 'right' ],
      ['Últ. Moviment.',   'center'],
      ['Nr. SA',           'center'],
      ['Ordem',            'center'],
      ['Qtd. Solicitada',  'right' ],
      ['Qtd. Atende',      'right' ],
      ['Recebedor(es)',     'left'  ],
    ];
    headers.forEach(([label, align], c) => {
      ws[this.enc(row, c)] = { v: label, t: 's', s: this.sHeader(align) };
    });
    row++;

    // Dados
    let idx = 1;
    for (const item of dados) {
      const m = item.material;
      const [firstSA, ...restSAs] = item.sas;
      const real = saldoRealMap.get(m.produto_codigo);
      const statusLabel = this.saldoStatusLabel(item, real, temConferencia);

      // Linha do material (+ primeira SA, se existir)
      this.n(ws, row, 0, idx,                       this.sMat('center'), '#,##0');
      this.s(ws, row, 1, m.produto_codigo,           this.sMat('left'));
      this.s(ws, row, 2, m.produto_desc,             this.sMat('left'));
      this.s(ws, row, 3, m.unidade,                  this.sMat('center'));
      this.s(ws, row, 4, m.grupo,                    this.sMat('center'));
      this.n(ws, row, 5, m.qtd_entrada_total,        this.sMat('right'), '#,##0.00');
      if (temConferencia) this.n(ws, row, 6, real?.saldo_qtd ?? 0, this.sMat('right'), '#,##0.00');
      else this.s(ws, row, 6, '', this.sMat());
      this.s(ws, row, 7, statusLabel,                this.sSaldoStatus(statusLabel));
      this.n(ws, row, 8, m.saldo_qtd,                this.sMat('right'), '#,##0.00');
      this.n(ws, row, 9, m.custo_medio,              this.sMat('right'), '"R$"\\ #,##0.00');
      this.n(ws, row, 10, m.valor_total,             this.sMat('right'), '"R$"\\ #,##0.00');
      this.s(ws, row, 11, this.formatDate(m.ultima_movimentacao), this.sMat('center'));

      if (firstSA) {
        this.s(ws, row, 12, firstSA.sa_numero,           this.sMat('center'));
        this.s(ws, row, 13, firstSA.ordem_id,            this.sMat('center'));
        this.n(ws, row, 14, firstSA.qtd_solicitada,      this.sMat('right'), '#,##0.00');
        this.n(ws, row, 15, firstSA.qtd_atende,
          firstSA.parcial ? this.sParcial() : this.sMat('right'), '#,##0.00');
        this.s(ws, row, 16, firstSA.recebedor,           this.sMat('left'));
      } else {
        for (let c = 12; c < NC; c++) this.s(ws, row, c, '', this.sMat());
      }
      row++;

      // Sub-linhas das demais SAs
      for (const sa of restSAs) {
        for (let c = 0; c < 12; c++) this.s(ws, row, c, '', this.sSA());
        this.s(ws, row, 12, sa.sa_numero,          this.sSA('center'));
        this.s(ws, row, 13, sa.ordem_id,           this.sSA('center'));
        this.n(ws, row, 14, sa.qtd_solicitada,     this.sSA('right'), '#,##0.00');
        this.n(ws, row, 15, sa.qtd_atende,
          sa.parcial ? this.sParcial() : this.sSA('right'), '#,##0.00');
        this.s(ws, row, 16, sa.recebedor,          this.sSA('left'));
        row++;
      }

      idx++;
    }

    // Total geral
    ws[this.enc(row, 0)] = { v: 'TOTAL GERAL', t: 's', s: this.sTotal('left') };
    for (let c = 1; c < 5;  c++) this.s(ws, row, c, '', this.sTotal());
    this.n(ws, row, 5, totalGeral.qtd,   this.sTotal('right'), '#,##0.00');
    for (let c = 6; c < 10; c++) this.s(ws, row, c, '', this.sTotal());
    this.n(ws, row, 10, totalGeral.valor, this.sTotal('right'), '"R$"\\ #,##0.00');
    for (let c = 11; c < NC; c++) this.s(ws, row, c, '', this.sTotal());
    row++;

    ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: NC - 1 } });
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: NC - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: NC - 1 } },
    ];
    ws['!rows'] = [{ hpt: 26 }, { hpt: 16 }, { hpt: 22 }];
    ws['!cols'] = [
      { wch: 5  }, { wch: 13 }, { wch: 36 }, { wch: 6  }, { wch: 8  },
      { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 16 },
      { wch: 16 }, { wch: 13 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
      { wch: 12 }, { wch: 24 },
    ];

    const wb: WorkBook = XLSX.utils.book_new();
    wb.Props = { Title: 'Materiais Aguardando Retirada', Company: 'Diamante Energia' };
    XLSX.utils.book_append_sheet(wb, ws, 'Aguardando Retirada');
    XLSX.writeFile(wb, `aguardando_retirada_${this.todayStr()}.xlsx`);
  }

  // ── Exportar Entradas por Período ─────────────────────────────────────────

  exportarEntradasPorPeriodo(
    dados: Movimentacao[],
    resumo: { total: number; distintos: number; qtdTotal: number; valorTotal: number },
    periodo: number,
    dateRange: { from: string; to: string },
  ): void {
    const NC = 10;
    const ws: WorkSheet = {};
    let row = 0;

    // Título
    this.fillRow(ws, row, NC, this.sTitle());
    ws[this.enc(row, 0)] = {
      v: `ENTRADAS POR PERÍODO — Últimos ${periodo} dias  (${dateRange.from} a ${dateRange.to})`,
      t: 's', s: this.sTitle(),
    };
    row++;

    // Subtítulo
    this.fillRow(ws, row, NC, this.sSub());
    ws[this.enc(row, 0)] = {
      v: `${resumo.total} lançamentos  |  ${resumo.distintos} materiais distintos  |  Gerado em ${this.nowStr()}`,
      t: 's', s: this.sSub(),
    };
    row++;

    // Cabeçalhos
    const headers: Array<[string, 'left' | 'center' | 'right']> = [
      ['Nº',               'center'],
      ['Data',             'center'],
      ['Código',           'left'  ],
      ['Descrição',        'left'  ],
      ['UM',               'center'],
      ['Grupo',            'center'],
      ['Qtd. Entrada',     'right' ],
      ['Custo Médio (R$)', 'right' ],
      ['Valor Total (R$)', 'right' ],
      ['Referência',       'left'  ],
    ];
    headers.forEach(([label, align], c) => {
      ws[this.enc(row, c)] = { v: label, t: 's', s: this.sHeader(align) };
    });
    row++;

    // Dados
    dados.forEach((m, i) => {
      const even  = i % 2 === 1;
      const valor = (m.qtd_entrada ?? 0) * (m.custo_medio ?? 0);
      this.n(ws, row, 0, i + 1,            this.sData('center', even), '#,##0');
      this.s(ws, row, 1, this.formatDate(m.data_operacao), this.sData('center', even));
      this.s(ws, row, 2, m.produto_codigo, this.sData('left', even));
      this.s(ws, row, 3, m.produto_desc,   this.sData('left', even));
      this.s(ws, row, 4, m.unidade,        this.sData('center', even));
      this.s(ws, row, 5, m.grupo,          this.sData('center', even));
      this.n(ws, row, 6, m.qtd_entrada ?? 0, this.sData('right', even), '#,##0.00');
      this.n(ws, row, 7, m.custo_medio ?? 0, this.sData('right', even), '"R$"\\ #,##0.00');
      this.n(ws, row, 8, valor,            this.sData('right', even), '"R$"\\ #,##0.00');
      this.s(ws, row, 9, m.referencia,     this.sData('left', even));
      row++;
    });

    // Total
    ws[this.enc(row, 0)] = { v: 'TOTAL', t: 's', s: this.sTotal('left') };
    for (let c = 1; c < 6; c++) this.s(ws, row, c, '', this.sTotal());
    this.n(ws, row, 6, resumo.qtdTotal,   this.sTotal('right'), '#,##0.00');
    this.s(ws, row, 7, '', this.sTotal());
    this.n(ws, row, 8, resumo.valorTotal, this.sTotal('right'), '"R$"\\ #,##0.00');
    this.s(ws, row, 9, '', this.sTotal());
    row++;

    ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: NC - 1 } });
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: NC - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: NC - 1 } },
    ];
    ws['!rows'] = [{ hpt: 26 }, { hpt: 16 }, { hpt: 22 }];
    ws['!cols'] = [
      { wch: 5  }, { wch: 12 }, { wch: 13 }, { wch: 36 }, { wch: 6  },
      { wch: 8  }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
    ];

    const wb: WorkBook = XLSX.utils.book_new();
    wb.Props = { Title: `Entradas por Período — ${periodo} dias`, Company: 'Diamante Energia' };
    XLSX.utils.book_append_sheet(wb, ws, 'Entradas por Período');
    XLSX.writeFile(wb, `entradas_periodo_${periodo}d_${this.todayStr()}.xlsx`);
  }

  // ── Exportar Saídas por Período ────────────────────────────────────────────

  exportarSaidasPorPeriodo(
    dados: Movimentacao[],
    resumo: { total: number; distintos: number; qtdTotal: number; valorTotal: number },
    periodo: number,
    dateRange: { from: string; to: string },
  ): void {
    const NC = 10;
    const ws: WorkSheet = {};
    let row = 0;

    // Título
    this.fillRow(ws, row, NC, this.sTitle());
    ws[this.enc(row, 0)] = {
      v: `SAÍDAS POR PERÍODO — Últimos ${periodo} dias  (${dateRange.from} a ${dateRange.to})`,
      t: 's', s: this.sTitle(),
    };
    row++;

    // Subtítulo
    this.fillRow(ws, row, NC, this.sSub());
    ws[this.enc(row, 0)] = {
      v: `${resumo.total} lançamentos  |  ${resumo.distintos} materiais distintos  |  Gerado em ${this.nowStr()}`,
      t: 's', s: this.sSub(),
    };
    row++;

    // Cabeçalhos
    const headers: Array<[string, 'left' | 'center' | 'right']> = [
      ['Nº',               'center'],
      ['Data',             'center'],
      ['Código',           'left'  ],
      ['Descrição',        'left'  ],
      ['UM',               'center'],
      ['Grupo',            'center'],
      ['Qtd. Saída',       'right' ],
      ['Custo Médio (R$)', 'right' ],
      ['Valor Total (R$)', 'right' ],
      ['Referência',       'left'  ],
    ];
    headers.forEach(([label, align], c) => {
      ws[this.enc(row, c)] = { v: label, t: 's', s: this.sHeader(align) };
    });
    row++;

    // Dados
    dados.forEach((m, i) => {
      const even  = i % 2 === 1;
      const valor = (m.qtd_saida ?? 0) * (m.custo_medio ?? 0);
      this.n(ws, row, 0, i + 1,            this.sData('center', even), '#,##0');
      this.s(ws, row, 1, this.formatDate(m.data_operacao), this.sData('center', even));
      this.s(ws, row, 2, m.produto_codigo, this.sData('left', even));
      this.s(ws, row, 3, m.produto_desc,   this.sData('left', even));
      this.s(ws, row, 4, m.unidade,        this.sData('center', even));
      this.s(ws, row, 5, m.grupo,          this.sData('center', even));
      this.n(ws, row, 6, m.qtd_saida ?? 0, this.sData('right', even), '#,##0.00');
      this.n(ws, row, 7, m.custo_medio ?? 0, this.sData('right', even), '"R$"\\ #,##0.00');
      this.n(ws, row, 8, valor,            this.sData('right', even), '"R$"\\ #,##0.00');
      this.s(ws, row, 9, m.referencia,     this.sData('left', even));
      row++;
    });

    // Total
    ws[this.enc(row, 0)] = { v: 'TOTAL', t: 's', s: this.sTotal('left') };
    for (let c = 1; c < 6; c++) this.s(ws, row, c, '', this.sTotal());
    this.n(ws, row, 6, resumo.qtdTotal,   this.sTotal('right'), '#,##0.00');
    this.s(ws, row, 7, '', this.sTotal());
    this.n(ws, row, 8, resumo.valorTotal, this.sTotal('right'), '"R$"\\ #,##0.00');
    this.s(ws, row, 9, '', this.sTotal());
    row++;

    ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: NC - 1 } });
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: NC - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: NC - 1 } },
    ];
    ws['!rows'] = [{ hpt: 26 }, { hpt: 16 }, { hpt: 22 }];
    ws['!cols'] = [
      { wch: 5  }, { wch: 12 }, { wch: 13 }, { wch: 36 }, { wch: 6  },
      { wch: 8  }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
    ];

    const wb: WorkBook = XLSX.utils.book_new();
    wb.Props = { Title: `Saídas por Período — ${periodo} dias`, Company: 'Diamante Energia' };
    XLSX.utils.book_append_sheet(wb, ws, 'Saídas por Período');
    XLSX.writeFile(wb, `saidas_periodo_${periodo}d_${this.todayStr()}.xlsx`);
  }

  // ── Exportar Fechamento do Fundo Fixo ─────────────────────────────────────
  // Mesmo layout da planilha que já era usada para pedir aprovação por e-mail:
  // duas tabelas (Cartão / Reembolsos), cada uma com seu total e as referências
  // (limite mensal, total sacado no mês, saldo em caixa) logo abaixo.

  private tabelaFechamento(
    ws: WorkSheet, rowInicial: number, NC: number, titulo: string, linhas: FechamentoFundoFixoLinha[],
  ): { proximaLinha: number; linhaTotal: number } {
    let row = rowInicial;

    this.fillRow(ws, row, NC, this.sSecao());
    ws[this.enc(row, 0)] = { v: titulo, t: 's', s: this.sSecao() };
    const linhaBanner = row;
    row++;

    const headers: Array<[string, 'left' | 'center' | 'right']> = [
      ['Nº',                        'center'],
      ['Fornecedor',                'left'  ],
      ['Solicitante',               'left'  ],
      ['Setor',                     'center'],
      ['Material',                  'left'  ],
      ['Valor',                     'right' ],
      ['Aprovador',                 'center'],
      ['Solicitação de Pagamento',  'center'],
    ];
    headers.forEach(([label, align], c) => {
      ws[this.enc(row, c)] = { v: label, t: 's', s: this.sHeader(align) };
    });
    row++;

    linhas.forEach((linha, i) => {
      const even = i % 2 === 1;
      this.n(ws, row, 0, i + 1,           this.sData('center', even), '#,##0');
      this.s(ws, row, 1, linha.fornecedor, this.sData('left', even));
      this.s(ws, row, 2, linha.solicitante, this.sData('left', even));
      this.s(ws, row, 3, linha.setor,      this.sData('center', even));
      this.s(ws, row, 4, linha.material,   this.sData('left', even));
      this.n(ws, row, 5, linha.valor,      this.sData('right', even), '"R$"\\ #,##0.00');
      this.s(ws, row, 6, linha.aprovador,  this.sData('center', even));
      this.s(ws, row, 7, '',               this.sData('center', even));
      row++;
    });

    if (linhas.length === 0) {
      for (let c = 0; c < NC; c++) this.s(ws, row, c, c === 0 ? 'Nenhum lançamento no mês' : '', this.sData('left'));
      row++;
    }

    const linhaTotal = row;
    const total = linhas.reduce((sum, l) => sum + l.valor, 0);
    for (let c = 0; c < 5; c++) this.s(ws, row, c, '', this.sData());
    this.n(ws, row, 5, total, this.sTotalSalmao(), '"R$"\\ #,##0.00');
    for (let c = 6; c < NC; c++) this.s(ws, row, c, '', this.sData());
    row++;

    ws['!merges'] = ws['!merges'] ?? [];
    (ws['!merges'] as { s: { r: number; c: number }; e: { r: number; c: number } }[]).push(
      { s: { r: linhaBanner, c: 0 }, e: { r: linhaBanner, c: NC - 1 } },
    );

    return { proximaLinha: row, linhaTotal };
  }

  exportarFechamentoFundoFixo(params: {
    mesLabel: string;
    cartao: FechamentoFundoFixoLinha[];
    reembolsos: FechamentoFundoFixoLinha[];
    limiteMensal: number;
    totalSacadoMes: number;
    saldoCaixaAtual: number;
  }): void {
    const NC = 8;
    const ws: WorkSheet = {};
    let row = 0;

    this.fillRow(ws, row, NC, this.sTitle());
    ws[this.enc(row, 0)] = { v: `FUNDO FIXO — FECHAMENTO DE ${params.mesLabel.toUpperCase()}`, t: 's', s: this.sTitle() };
    const linhaTitulo = row;
    row++;

    this.fillRow(ws, row, NC, this.sSub());
    ws[this.enc(row, 0)] = { v: `Gerado em ${this.nowStr()}`, t: 's', s: this.sSub() };
    const linhaSub = row;
    row++;
    row++; // espaço

    const cartaoResult = this.tabelaFechamento(ws, row, NC, 'CARTÃO CRÉDITO - FUNDO FIXO', params.cartao);
    row = cartaoResult.proximaLinha;
    this.n(ws, row, 5, params.limiteMensal, this.sReferenciaVerde(), '"R$"\\ #,##0.00');
    for (let c = 0; c < NC; c++) if (c !== 5) this.s(ws, row, c, '', this.sData());
    row++;
    row++; // espaço

    const reembolsosResult = this.tabelaFechamento(ws, row, NC, 'REEMBOLSOS', params.reembolsos);
    row = reembolsosResult.proximaLinha;
    this.n(ws, row, 5, params.totalSacadoMes, this.sReferenciaVerde(), '"R$"\\ #,##0.00');
    for (let c = 0; c < NC; c++) if (c !== 5) this.s(ws, row, c, '', this.sData());
    row++;
    this.n(ws, row, 5, params.saldoCaixaAtual, this.sCaixaAmarelo(), '"R$"\\ #,##0.00');
    this.s(ws, row, 6, 'Valor em caixa', this.sData('left'));
    for (let c = 0; c < NC; c++) if (c !== 5 && c !== 6) this.s(ws, row, c, '', this.sData());
    row++;

    ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: NC - 1 } });
    ws['!merges'] = [
      ...(ws['!merges'] as { s: { r: number; c: number }; e: { r: number; c: number } }[]),
      { s: { r: linhaTitulo, c: 0 }, e: { r: linhaTitulo, c: NC - 1 } },
      { s: { r: linhaSub, c: 0 }, e: { r: linhaSub, c: NC - 1 } },
    ];
    ws['!cols'] = [
      { wch: 5  }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 34 },
      { wch: 14 }, { wch: 14 }, { wch: 22 },
    ];

    const wb: WorkBook = XLSX.utils.book_new();
    wb.Props = { Title: `Fundo Fixo — Fechamento ${params.mesLabel}`, Company: 'Diamante Energia' };
    XLSX.utils.book_append_sheet(wb, ws, 'Fechamento');
    XLSX.writeFile(wb, `fundo_fixo_fechamento_${this.todayStr()}.xlsx`);
  }

  // ── Exportar Programação de Manutenção (semanal) ────────────────────────────
  // Usa ExcelJS (não xlsx-js-style) porque precisa embutir a logo da empresa de
  // verdade no arquivo — a outra biblioteca não suporta imagem. Cabeçalho de
  // colunas aparece uma vez só (fixo no topo ao rolar); cada técnico vira um
  // divisor leve, não um banner repetido — bem menos poluído que a réplica
  // anterior, mas mantém a mesma informação da planilha que o time já usava.

  // Paleta da marca Diamante (manual DD-0099-26 — mesmos tons de tailwind.config.cjs:
  // azul Pantone 300C #2039F9, laranja Pantone 1505C #DE7128), não uma paleta genérica
  // inventada pro Excel. Cor com propósito, não decoração: azul estrutura o documento
  // (cabeçalho, título, divisor de técnico, dia com OS marcada); laranja sinaliza
  // "indisponível" (folga/treinamento/exame médico/DSR — o mesmo conceito, só a cor
  // muda de intensidade pro fim de semana ficar um pouco mais discreto que o resto da
  // semana); cinza neutro pra reunião (é aviso, não ausência) e bordas. Sem paleta
  // arco-íris com uma cor nova por categoria.
  private readonly PROG_AZUL = 'FF2039F9';
  private readonly PROG_AZUL_TEXTO = 'FF0620E5';
  private readonly PROG_AZUL_CLARO = 'FFF0F2FF';
  private readonly PROG_AZUL_DIA = 'FF8895FC';
  private readonly PROG_BORDA = 'FFD9D9D9';
  private readonly PROG_ZEBRA = 'FFF7F8FC';
  private readonly PROG_LARANJA_BG = 'FFFDF6F2';
  private readonly PROG_LARANJA_TEXTO = 'FFBE5E1E';
  // DSR (fim de semana sem lançamento) — mesma família laranja, só um tico mais claro
  // (o próprio fundo já é uma faixa vertical grande, não precisa competir por atenção).
  private readonly PROG_DSR_BG = 'FFFAEAE0';
  private readonly PROG_DSR_TEXTO = 'FFBE5E1E';
  private readonly PROG_CINZA_BG = 'FFF1F5F9';
  private readonly PROG_CINZA_TEXTO = 'FF475569';

  private corAusenciaPorTipo(tipo: string): { bg: string; texto: string } {
    if (tipo === 'reuniao') return { bg: this.PROG_CINZA_BG, texto: this.PROG_CINZA_TEXTO };
    return { bg: this.PROG_LARANJA_BG, texto: this.PROG_LARANJA_TEXTO }; // folga/treinamento/exame_medico
  }

  // Feriado e folga pessoal (atestado, banco de horas etc.) usam o mesmo tipo 'folga'
  // no banco — não tem como diferenciar por tipo. O Portal lança feriado com a
  // descrição padrão "Feriado" (ver criarFolgaEmLote), então usa isso como sinal: só
  // quando a descrição bate exatamente com "Feriado" o rótulo muda, senão continua
  // "FOLGA" genérico.
  private labelFolga(descricao: string): string {
    return descricao.trim().toUpperCase() === 'FERIADO' ? 'FERIADO' : 'FOLGA';
  }

  // Best-effort: se a logo não carregar (rede, arquivo ausente), o export segue
  // sem ela em vez de falhar.
  private async carregarLogoBuffer(): Promise<ArrayBuffer | null> {
    try {
      const resp = await fetch('/company-logo.png');
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch {
      return null;
    }
  }

  private bordaFina(): Partial<ExcelJS.Borders> {
    const estilo: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: this.PROG_BORDA } };
    return { top: estilo, bottom: estilo, left: estilo, right: estilo };
  }

  // O Excel não recalcula a altura da linha sozinho pra texto quebrado (wrapText)
  // quando o arquivo é gerado por fora do Excel — Descrição/Recursos/LOTO longos (várias
  // pessoas/empresas na mesma OS, ex.: "ULTRALIMPO, ANDAIME, Alexandre Rodguires")
  // ficavam cortados ou desenhados por cima da linha de baixo. Calcula a altura certa a
  // partir de quantas linhas o texto realmente precisa — aproximação: 1 unidade de
  // largura de coluna ≈ 1 caractere da fonte padrão (não é exato, mas errar pra mais
  // altura é sempre melhor do que cortar texto).
  private estimarLinhas(texto: string | null | undefined, larguraColuna: number): number {
    if (!texto) return 1;
    const charsPorLinha = Math.max(1, Math.floor(larguraColuna));
    return texto.split('\n').reduce((total, linha) => total + Math.max(1, Math.ceil(linha.length / charsPorLinha)), 0);
  }

  private tabelaTecnicoExcelJs(
    ws: ExcelJS.Worksheet, rowInicial: number, NC: number, grupo: ProgramacaoSemanalGrupo, dias: ProgramacaoSemanalDia[],
  ): number {
    let row = rowInicial;

    // Divisor do técnico — leve (fundo claro + nome em negrito), não repete o
    // cabeçalho de colunas a cada bloco.
    const totalHoras = grupo.linhas.reduce((soma, l) => soma + (l.duracaoHoras ?? 0), 0);
    ws.getRow(row).height = 18;
    ws.mergeCells(row, 1, row, NC);
    const celDivisor = ws.getCell(row, 1);
    const partes = [grupo.tecnico];
    if (totalHoras > 0) partes.push(`${totalHoras.toFixed(2)}h programadas`);
    if (grupo.feriasAte) partes.push(`Férias até ${grupo.feriasAte}`);
    if (grupo.atestadoAte) partes.push(`Atestado até ${grupo.atestadoAte}`);
    celDivisor.value = partes.join('   ·   ');
    celDivisor.font = { bold: true, size: 10, color: { argb: this.PROG_AZUL_TEXTO } };
    celDivisor.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL_CLARO } };
    celDivisor.alignment = { horizontal: 'left', vertical: 'middle' };
    row++;

    const linhas = grupo.linhas.length > 0 ? grupo.linhas : null;
    const primeiraLinhaRow = row;

    if (!linhas) {
      const cel = ws.getCell(row, 2);
      cel.value = 'Nenhum lançamento na semana';
      cel.font = { italic: true, size: 9, color: { argb: 'FF999999' } };
      row++;
    } else {
      linhas.forEach((linha, idx) => {
        const numeroLabel = linha.tipo === 'folga' ? this.labelFolga(linha.descricao)
          : linha.tipo === 'treinamento' ? 'TREINAMENTO'
          : linha.tipo === 'exame_medico' ? 'EXAME MÉDICO'
          : linha.tipo === 'reuniao' ? 'REUNIÃO'
          : linha.numeroOs ? linha.numeroOs
          : linha.semOs ? 'SEM OS'
          : 'CRIAR OS';

        const fonteBase: Partial<ExcelJS.Font> = { size: 9, color: { argb: 'FF333333' } };
        // Zebrado bem sutil (cinza ~3%) só nas linhas de ordem — ajuda a escanear um
        // bloco com várias OS sem competir com as cores com propósito (laranja/cinza
        // dos banners, azul do dia marcado). Banners de ausência já têm cor própria,
        // não entram no zebrado.
        const zebra: ExcelJS.Fill | undefined = idx % 2 === 1
          ? { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_ZEBRA } } : undefined;
        // Sem altura fixa aqui — deixa o Excel calcular sozinho quando a descrição
        // quebra em mais de uma linha (wrapText), senão o texto fica cortado.

        // Folga/Treinamento/Exame médico/Reunião não têm OS/equipamento/LOTO — em vez
        // de espalhar campos vazios pelas 7 primeiras colunas, vira uma faixa única com
        // o rótulo centralizado, fácil de bater o olho na semana inteira. Fundo claro
        // (mesma paleta da tela), não sólido saturado — fica pesado numa planilha
        // inteira. Reunião ganha uma segunda linha (wrapText) pro horário/local não
        // ficar espremido junto do título.
        const ehAusenciaComBanner = linha.tipo === 'folga' || linha.tipo === 'treinamento'
          || linha.tipo === 'exame_medico' || linha.tipo === 'reuniao';

        if (ehAusenciaComBanner) {
          const cor = this.corAusenciaPorTipo(linha.tipo);
          ws.mergeCells(row, 1, row, 7);
          const cel = ws.getCell(row, 1);
          const detalheReuniao = [linha.recursos && linha.recursos !== '—' ? linha.recursos : null].filter(Boolean).join(' · ');
          if (linha.tipo === 'reuniao') {
            cel.value = detalheReuniao ? `${linha.descricao}\n${detalheReuniao}` : linha.descricao;
            cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            ws.getRow(row).height = 28; // Excel não estica altura sozinho em célula mesclada
          } else {
            cel.value = numeroLabel;
            cel.alignment = { horizontal: 'center', vertical: 'middle' };
          }
          cel.font = { bold: true, size: 10, color: { argb: cor.texto } };
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.bg } };
        } else {
          // Altura explícita pra caber o texto de todas as colunas que podem quebrar
          // linha (Descrição, Recursos, LOTO) — ver estimarLinhas.
          const larguraDesc = (ws.getColumn(2).width as number | undefined) ?? 46;
          const larguraRec = (ws.getColumn(5).width as number | undefined) ?? 24;
          const larguraLoto = (ws.getColumn(6).width as number | undefined) ?? 15;
          const linhasNecessarias = Math.max(
            this.estimarLinhas(linha.descricao, larguraDesc),
            this.estimarLinhas(linha.recursos, larguraRec),
            this.estimarLinhas(linha.loto, larguraLoto),
            1,
          );
          ws.getRow(row).height = Math.max(15, linhasNecessarias * 13);

          const cOs = ws.getCell(row, 1);
          cOs.value = numeroLabel;
          cOs.font = fonteBase;
          cOs.alignment = { horizontal: 'center', vertical: 'middle' };
          if (zebra) cOs.fill = zebra;

          const cDesc = ws.getCell(row, 2);
          cDesc.value = linha.descricao;
          cDesc.font = fonteBase;
          cDesc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          if (zebra) cDesc.fill = zebra;

          const cDur = ws.getCell(row, 3);
          if (linha.duracaoHoras !== null) {
            cDur.value = linha.duracaoHoras;
            cDur.numFmt = '0.00';
          }
          cDur.font = fonteBase;
          cDur.alignment = { horizontal: 'center', vertical: 'middle' };
          if (zebra) cDur.fill = zebra;

          const cEquip = ws.getCell(row, 4);
          cEquip.value = linha.equipamento;
          cEquip.font = fonteBase;
          cEquip.alignment = { horizontal: 'center', vertical: 'middle' };
          if (zebra) cEquip.fill = zebra;

          const cRec = ws.getCell(row, 5);
          cRec.value = linha.recursos;
          cRec.font = fonteBase;
          cRec.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          if (zebra) cRec.fill = zebra;

          const cLoto = ws.getCell(row, 6);
          cLoto.value = linha.loto;
          cLoto.font = fonteBase;
          cLoto.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          if (zebra) cLoto.fill = zebra;

          const cArea = ws.getCell(row, 7);
          cArea.value = linha.areaAtuacao;
          cArea.font = fonteBase;
          cArea.alignment = { horizontal: 'center', vertical: 'middle' };
          if (zebra) cArea.fill = zebra;
        }

        dias.forEach((dia, i) => {
          const cel = ws.getCell(row, 8 + i);
          cel.alignment = { horizontal: 'center', vertical: 'middle' };
          if (!linha.diasPrevistos.includes(dia.data)) {
            if (!ehAusenciaComBanner && zebra) cel.fill = zebra;
            return;
          }
          if (linha.tipo === 'ordem') {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL_DIA } };
          } else {
            const cor = this.corAusenciaPorTipo(linha.tipo);
            // Treinamento não repete rótulo dia a dia — o banner da linha já diz
            // "TREINAMENTO" uma vez só; "TREINO" em cada dia marcado era redundante
            // (pedido do usuário). A cor de fundo sozinha já mostra quais dias são.
            const rotuloDia = linha.tipo === 'folga' ? this.labelFolga(linha.descricao)
              : linha.tipo === 'treinamento' ? null
              : linha.tipo === 'reuniao' ? 'REUNIÃO'
              : 'ASO';
            if (rotuloDia) {
              cel.value = rotuloDia;
              cel.font = { bold: true, size: 7, color: { argb: cor.texto } };
            }
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.bg } };
          }
        });

        for (let c = 1; c <= NC; c++) ws.getCell(row, c).border = this.bordaFina();
        row++;
      });
    }

    // DSR nos fins de semana em que o técnico não tem nenhum lançamento marcado —
    // fundo claro (mesma família laranja do resto, um tico mais claro), mesclado numa
    // célula só ao longo do bloco dele. Se ele precisar trabalhar no sábado/domingo
    // (tem algo em diasPrevistos naquele dia), não mexe — os marcadores normais da
    // linha continuam valendo.
    const ultimaLinhaRow = row - 1;
    dias.forEach((dia, i) => {
      if (dia.label !== 'SAB' && dia.label !== 'DOM') return;
      const temTrabalho = linhas?.some(l => l.diasPrevistos.includes(dia.data)) ?? false;
      if (temTrabalho) return;
      const col = 8 + i;
      if (ultimaLinhaRow > primeiraLinhaRow) {
        ws.mergeCells(primeiraLinhaRow, col, ultimaLinhaRow, col);
      }
      const cel = ws.getCell(primeiraLinhaRow, col);
      cel.value = 'DSR';
      cel.font = { bold: true, size: 8, color: { argb: this.PROG_DSR_TEXTO } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_DSR_BG } };
      cel.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let r = primeiraLinhaRow; r <= ultimaLinhaRow; r++) {
        ws.getCell(r, col).border = this.bordaFina();
      }
    });

    row++; // espaço entre blocos de técnico
    return row;
  }

  // Monta o workbook em si (sem baixar) — separado de exportarProgramacaoSemanal pra
  // reusar o mesmo builder se aparecer outro consumidor do Excel além do download direto.
  private async construirWorkbookProgramacao(params: {
    semanaLabel: string;
    numeroSemana: number;
    areaLabel: string;
    dias: ProgramacaoSemanalDia[];
    grupos: ProgramacaoSemanalGrupo[];
  }): Promise<{ wb: ExcelJS.Workbook; tituloPlanilha: string }> {
    const NC = 14;
    // Convenção fixa de nome (aba, título e arquivo): "Programação {Área} Semana {N}".
    const tituloPlanilha = `Programação ${params.areaLabel} Semana ${params.numeroSemana}`;
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal PPTM';
    wb.created = new Date();
    // showGridLines: false — sem as linhas de grade padrão do Excel por trás de tudo;
    // só as bordas finas que a gente desenha (bordaFina) marcam as células.
    const ws = wb.addWorksheet(this.nomeAbaSeguro(tituloPlanilha), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    });

    ws.columns = [
      { width: 13 }, { width: 46 }, { width: 9 }, { width: 16 }, { width: 24 },
      { width: 15 }, { width: 20 },
      { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 },
    ];

    const logoBuffer = await this.carregarLogoBuffer();
    if (logoBuffer) {
      const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 210, height: 63 } });
    }

    ws.getRow(1).height = 28;
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;

    ws.mergeCells(1, 3, 1, NC);
    const cTitulo = ws.getCell(1, 3);
    cTitulo.value = tituloPlanilha;
    cTitulo.font = { bold: true, size: 16, color: { argb: this.PROG_AZUL_TEXTO } };
    cTitulo.alignment = { horizontal: 'left', vertical: 'middle' };

    ws.mergeCells(2, 3, 2, NC);
    const cSub = ws.getCell(2, 3);
    cSub.value = params.semanaLabel;
    cSub.font = { size: 10, color: { argb: 'FF555555' } };
    cSub.alignment = { horizontal: 'left', vertical: 'middle' };

    // Régua fina fechando a "área de letterhead" (logo + título) antes da tabela
    // começar — sem isso o cabeçalho ficava meio solto, sem nada delimitando onde a
    // planilha de fato começa.
    for (let c = 1; c <= NC; c++) {
      ws.getCell(2, c).border = { bottom: { style: 'thin', color: { argb: 'FFB9C1FD' } } };
    }

    let row = 4;
    const headerRow = ws.getRow(row);
    headerRow.height = 26;
    const headersFixos: Array<[string, number]> = [
      ['OS', 1], ['Descrição', 2], ['Duração', 3], ['Equipamento', 4], ['Recursos', 5], ['LOTO', 6], ['Área Atuação', 7],
    ];
    const estiloHeader = (cel: ExcelJS.Cell) => {
      cel.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL } };
      cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    };
    headersFixos.forEach(([label, c]) => {
      const cel = headerRow.getCell(c);
      cel.value = label;
      estiloHeader(cel);
    });
    params.dias.forEach((dia, i) => {
      const cel = headerRow.getCell(8 + i);
      cel.value = `${dia.label}\n${dia.diaMes}`;
      estiloHeader(cel);
      cel.font = { ...cel.font, size: 8 };
    });
    row++;

    for (const grupo of params.grupos) {
      row = this.tabelaTecnicoExcelJs(ws, row, NC, grupo, params.dias);
    }

    ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 };
    // Repete a linha de cabeçalho em toda página impressa — sem isso, uma semana com
    // muitos técnicos (várias páginas) saía com as páginas 2+ sem nome de coluna nenhum.
    ws.pageSetup.printTitlesRow = '4:4';

    return { wb, tituloPlanilha };
  }

  private nomeArquivoProgramacao(tituloPlanilha: string): string {
    return `${tituloPlanilha.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')}.xlsx`;
  }

  async exportarProgramacaoSemanal(params: {
    semanaLabel: string;
    numeroSemana: number;
    areaLabel: string;
    dias: ProgramacaoSemanalDia[];
    grupos: ProgramacaoSemanalGrupo[];
  }): Promise<void> {
    const { wb, tituloPlanilha } = await this.construirWorkbookProgramacao(params);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.nomeArquivoProgramacao(tituloPlanilha);
    a.click();
    URL.revokeObjectURL(url);
  }

  // Export da tela de Planos de Manutenção — lista simples (sem grade de dias/semana),
  // uma linha por plano, mesmo padrão visual (logo, cor da marca) do export de
  // Programação. `titulo` já vem pronto do componente (ex.: "Planos de Manutenção —
  // Mecânica"), pra cobrir tanto exportar tudo quanto só a área filtrada na tela.
  async exportarPlanos(params: { titulo: string; linhas: PlanoManutencaoExportLinha[] }): Promise<void> {
    const colunas: { header: string; width: number }[] = [
      { header: 'Código', width: 10 },
      { header: 'Nome', width: 42 },
      { header: 'Equipamento', width: 24 },
      { header: 'TAG/KKS', width: 14 },
      { header: 'Área', width: 12 },
      { header: 'Especialidade', width: 20 },
      { header: 'Descrição', width: 36 },
      { header: 'Periodicidade', width: 16 },
      { header: 'Responsável', width: 18 },
      { header: 'Data Inicial', width: 12 },
      { header: 'Última Execução', width: 14 },
      { header: 'Próxima Execução', width: 15 },
      { header: 'Semana', width: 9 },
      { header: 'Status', width: 10 },
      { header: 'Tempo Estimado (h)', width: 12 },
      { header: 'HH Estimado', width: 10 },
      { header: 'Observações', width: 32 },
      { header: 'Checklist', width: 11 },
    ];
    const NC = colunas.length;

    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal PPTM';
    wb.created = new Date();
    const ws = wb.addWorksheet(this.nomeAbaSeguro(params.titulo), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    });
    ws.columns = colunas.map(c => ({ width: c.width }));

    const logoBuffer = await this.carregarLogoBuffer();
    if (logoBuffer) {
      const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 210, height: 63 } });
    }

    ws.getRow(1).height = 28;
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;

    ws.mergeCells(1, 3, 1, NC);
    const cTitulo = ws.getCell(1, 3);
    cTitulo.value = params.titulo;
    cTitulo.font = { bold: true, size: 16, color: { argb: this.PROG_AZUL_TEXTO } };
    cTitulo.alignment = { horizontal: 'left', vertical: 'middle' };

    ws.mergeCells(2, 3, 2, NC);
    const cSub = ws.getCell(2, 3);
    cSub.value = `${params.linhas.length} plano(s) — gerado em ${this.nowStr()}`;
    cSub.font = { size: 10, color: { argb: 'FF555555' } };
    cSub.alignment = { horizontal: 'left', vertical: 'middle' };

    for (let c = 1; c <= NC; c++) {
      ws.getCell(2, c).border = { bottom: { style: 'thin', color: { argb: 'FFB9C1FD' } } };
    }

    let row = 4;
    const headerRow = ws.getRow(row);
    headerRow.height = 24;
    colunas.forEach((c, i) => {
      const cel = headerRow.getCell(i + 1);
      cel.value = c.header;
      cel.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL } };
      cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    row++;

    const colunasComQuebra = new Set([2, 7, 17]); // Nome, Descrição, Observações
    for (const linha of params.linhas) {
      const valores = [
        linha.codigo, linha.nome, linha.equipamento, linha.tagKks, linha.area, linha.especialidade,
        linha.descricao, linha.periodicidade, linha.responsavel, linha.dataInicial, linha.ultimaExecucao,
        linha.proximaExecucao, linha.semanaPrevista, linha.status, linha.tempoEstimadoHoras, linha.hhEstimado,
        linha.observacoes, linha.checklist,
      ];
      valores.forEach((v, i) => {
        const c = i + 1;
        const cel = ws.getCell(row, c);
        cel.value = v;
        cel.font = c === 14
          ? { size: 9, bold: true, color: { argb: linha.status === 'Ativo' ? 'FF15803D' : 'FF64748B' } }
          : { size: 9 };
        cel.alignment = { vertical: 'top', wrapText: colunasComQuebra.has(c), horizontal: c === 14 ? 'center' : 'left' };
        cel.border = this.bordaFina();
      });
      const alturaLinhas = Math.max(
        this.estimarLinhas(linha.nome, 42), this.estimarLinhas(linha.descricao, 36), this.estimarLinhas(linha.observacoes, 32),
      );
      ws.getRow(row).height = Math.max(16, alturaLinhas * 14);
      row++;
    }

    ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 };
    ws.pageSetup.printTitlesRow = '4:4';
    // Filtro automático no cabeçalho — quem recebe a planilha filtra por área,
    // periodicidade, status etc. sem precisar voltar no Portal.
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(row - 1, 4), column: NC } };

    await this.baixarWorkbook(wb, params.titulo);
  }

  private async baixarWorkbook(wb: ExcelJS.Workbook, titulo: string): Promise<void> {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_\-]+/g, '_').replace(/_+/g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Mapa de intervenções (52 semanas) ─────────────────────────────────────
  // Mesma grade da tela Planos › Calendário › Mapa 52 semanas: uma linha por plano,
  // uma coluna por semana ISO, sigla da periodicidade na semana em que o plano sai.
  // Cor = periodicidade (mesma legenda da tela); forte = já programada (OS), clara =
  // prevista. Faixa de meses em cima, semana atual destacada, total por semana no fim.

  // Mesmas cores da tela (Tailwind sky/emerald/violet/amber/rose-500).
  private corDaSigla(sigla: string): string {
    switch (sigla) {
      case 'S': case 'Q': case '3S': return '0EA5E9';
      case 'M': return '10B981';
      case 'B': case 'T': case '4M': return '8B5CF6';
      case '6M': return 'F59E0B';
      default: return 'F43F5E';
    }
  }

  // Tom claro da mesma cor (mistura com branco) — "prevista".
  private clarear(hex: string, fracaoBranco = 0.6): string {
    const canal = (i: number) => {
      const v = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(v + (255 - v) * fracaoBranco).toString(16).padStart(2, '0');
    };
    return `${canal(0)}${canal(2)}${canal(4)}`.toUpperCase();
  }

  async exportarMapaIntervencoes(params: MapaIntervencoesExport): Promise<void> {
    const fixas: { header: string; width: number }[] = [
      { header: 'Código', width: 10 },
      { header: 'Plano', width: 40 },
      { header: 'Equipamento', width: 24 },
      { header: 'TAG/KKS', width: 15 },
      { header: 'Área', width: 10 },
      { header: 'Periodicidade', width: 13 },
    ];
    const NF = fixas.length;
    const NC = NF + params.semanas.length + 1; // + coluna "Total" no fim
    const colSemana = (i: number) => NF + 1 + i;
    const colTotal = NC;
    const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal PPTM';
    wb.created = new Date();
    const ws = wb.addWorksheet('Mapa 52 semanas', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', xSplit: NF, ySplit: 5, showGridLines: false }],
    });
    ws.columns = [
      ...fixas.map(c => ({ width: c.width })),
      ...params.semanas.map(() => ({ width: 4.3 })),
      { width: 7 },
    ];

    // Letterhead — mesmo padrão dos outros exports (logo, título azul, régua).
    const logoBuffer = await this.carregarLogoBuffer();
    if (logoBuffer) {
      const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 210, height: 63 } });
    }
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;
    ws.mergeCells(1, 3, 1, NC);
    Object.assign(ws.getCell(1, 3), {
      value: params.titulo,
      font: { bold: true, size: 16, color: { argb: this.PROG_AZUL_TEXTO } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });
    ws.mergeCells(2, 3, 2, NC);
    Object.assign(ws.getCell(2, 3), {
      value: `${params.subtitulo} — ${params.linhas.length} plano(s) — gerado em ${this.nowStr()}`,
      font: { size: 10, color: { argb: 'FF555555' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });
    for (let c = 1; c <= NC; c++) ws.getCell(2, c).border = { bottom: { style: 'thin', color: { argb: 'FFB9C1FD' } } };

    const estiloHeader = (cel: ExcelJS.Cell, atual = false) => {
      cel.font = { bold: true, size: 8, color: { argb: atual ? this.PROG_AZUL_TEXTO : 'FFFFFFFF' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: atual ? 'FFFDE68A' : this.PROG_AZUL } };
      cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cel.border = { left: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    };

    // Linha 4: faixa de meses (mês da quinta-feira da semana, regra ISO).
    const rowMes = 4;
    ws.getRow(rowMes).height = 16;
    let inicioBloco = 0;
    const mesDa = (i: number) => {
      const [a, m, d] = params.semanas[i].inicio.split('-').map(Number);
      return new Date(a, m - 1, d + 3).getMonth();
    };
    for (let i = 1; i <= params.semanas.length; i++) {
      if (i === params.semanas.length || mesDa(i) !== mesDa(inicioBloco)) {
        if (i - 1 > inicioBloco) ws.mergeCells(rowMes, colSemana(inicioBloco), rowMes, colSemana(i - 1));
        const cel = ws.getCell(rowMes, colSemana(inicioBloco));
        cel.value = MESES[mesDa(inicioBloco)];
        cel.font = { bold: true, size: 8, color: { argb: this.PROG_AZUL_TEXTO } };
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL_CLARO } };
        cel.alignment = { horizontal: 'center', vertical: 'middle' };
        cel.border = { left: { style: 'thin', color: { argb: 'FFB9C1FD' } }, right: { style: 'thin', color: { argb: 'FFB9C1FD' } } };
        inicioBloco = i;
      }
    }

    // Linha 5: cabeçalho de colunas (fixas + S1..S52 + Total).
    const rowHeader = 5;
    ws.getRow(rowHeader).height = 22;
    fixas.forEach((c, i) => { const cel = ws.getCell(rowHeader, i + 1); cel.value = c.header; estiloHeader(cel); });
    params.semanas.forEach((s, i) => {
      const cel = ws.getCell(rowHeader, colSemana(i));
      cel.value = `S${s.numero}`;
      estiloHeader(cel, s.numero === params.semanaAtual);
      cel.note = `Semana ${s.numero}: ${s.inicio.split('-').reverse().join('/')} a ${s.fim.split('-').reverse().join('/')}`;
    });
    estiloHeader(ws.getCell(rowHeader, colTotal));
    ws.getCell(rowHeader, colTotal).value = 'Total';

    // Linhas dos planos.
    let row = rowHeader + 1;
    const totalPorSemana = new Map<number, number>();
    for (const linha of params.linhas) {
      const fixasValores = [linha.codigo, linha.nome, linha.equipamento, linha.tagKks, linha.area,
        linha.mensalNaParada ? `${linha.periodicidade} (mensal na parada)` : linha.periodicidade];
      fixasValores.forEach((v, i) => {
        const cel = ws.getCell(row, i + 1);
        cel.value = v;
        cel.font = { size: 8, bold: i === 0 };
        cel.alignment = { vertical: 'middle', wrapText: i === 1 || i === 5 };
        cel.border = this.bordaFina();
      });
      const cor = this.corDaSigla(linha.sigla);
      let totalLinha = 0;
      params.semanas.forEach((s, i) => {
        const cel = ws.getCell(row, colSemana(i));
        cel.border = { top: { style: 'hair', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          left: { style: 'hair', color: { argb: 'FFE2E8F0' } }, right: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cel.alignment = { horizontal: 'center', vertical: 'middle' };
        const estado = linha.celulas[s.numero];
        if (!estado) {
          if (s.numero === params.semanaAtual) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };
          return;
        }
        totalLinha++;
        totalPorSemana.set(s.numero, (totalPorSemana.get(s.numero) ?? 0) + 1);
        cel.value = linha.sigla;
        const programada = estado === 'programada';
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${programada ? cor : this.clarear(cor)}` } };
        cel.font = { size: 7, bold: true, color: { argb: programada ? 'FFFFFFFF' : 'FF334155' } };
      });
      const celTotal = ws.getCell(row, colTotal);
      celTotal.value = totalLinha;
      celTotal.font = { size: 8, bold: true };
      celTotal.alignment = { horizontal: 'center', vertical: 'middle' };
      celTotal.border = this.bordaFina();
      ws.getRow(row).height = Math.max(15, this.estimarLinhas(linha.nome, 40) * 12);
      row++;
    }

    // Rodapé: intervenções por semana (carga) — mesma linha de total da tela.
    const rowTotal = row;
    ws.getRow(rowTotal).height = 18;
    ws.mergeCells(rowTotal, 1, rowTotal, NF);
    Object.assign(ws.getCell(rowTotal, 1), {
      value: 'Intervenções na semana',
      font: { bold: true, size: 9, color: { argb: this.PROG_AZUL_TEXTO } },
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    let totalGeral = 0;
    params.semanas.forEach((s, i) => {
      const n = totalPorSemana.get(s.numero) ?? 0;
      totalGeral += n;
      const cel = ws.getCell(rowTotal, colSemana(i));
      cel.value = n || null;
      cel.font = { bold: true, size: 8, color: { argb: this.PROG_AZUL_TEXTO } };
      cel.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.getCell(rowTotal, colTotal).value = totalGeral;
    ws.getCell(rowTotal, colTotal).font = { bold: true, size: 9, color: { argb: this.PROG_AZUL_TEXTO } };
    ws.getCell(rowTotal, colTotal).alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= NC; c++) {
      const cel = ws.getCell(rowTotal, c);
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AZUL_CLARO } };
      cel.border = { top: { style: 'thin', color: { argb: this.PROG_AZUL } } };
    }

    // Legenda.
    let rowLeg = rowTotal + 2;
    ws.getCell(rowLeg, 1).value = 'Legenda';
    ws.getCell(rowLeg, 1).font = { bold: true, size: 9 };
    const legenda: [string, string][] = [
      ['S', 'Semanal / quinzenal (S, Q, 3S)'], ['M', 'Mensal'], ['T', 'Bimestral / trimestral / 4M (B, T, 4M)'],
      ['6M', 'Semestral'], ['A', 'Anual / 2 anos (A, 2A)'],
    ];
    for (const [sigla, texto] of legenda) {
      rowLeg++;
      const cor = this.corDaSigla(sigla);
      const cel = ws.getCell(rowLeg, 1);
      cel.value = sigla;
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${cor}` } };
      cel.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
      cel.alignment = { horizontal: 'center' };
      ws.getCell(rowLeg, 2).value = texto;
      ws.getCell(rowLeg, 2).font = { size: 8 };
    }
    rowLeg++;
    Object.assign(ws.getCell(rowLeg, 1), { value: 'M', font: { bold: true, size: 8, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${this.corDaSigla('M')}` } }, alignment: { horizontal: 'center' } });
    Object.assign(ws.getCell(rowLeg, 2), { value: 'Cor forte = já programada (virou OS)', font: { size: 8 } });
    rowLeg++;
    Object.assign(ws.getCell(rowLeg, 1), { value: 'M', font: { bold: true, size: 8, color: { argb: 'FF334155' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${this.clarear(this.corDaSigla('M'))}` } }, alignment: { horizontal: 'center' } });
    Object.assign(ws.getCell(rowLeg, 2), { value: 'Cor clara = prevista (agenda do plano, ainda sem OS)', font: { size: 8 } });
    if (params.semanaAtual !== null) {
      rowLeg++;
      Object.assign(ws.getCell(rowLeg, 1), { value: `S${params.semanaAtual}`, font: { bold: true, size: 8, color: { argb: this.PROG_AZUL_TEXTO } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }, alignment: { horizontal: 'center' } });
      Object.assign(ws.getCell(rowLeg, 2), { value: 'Semana atual', font: { size: 8 } });
    }

    ws.autoFilter = { from: { row: rowHeader, column: 1 }, to: { row: Math.max(rowTotal - 1, rowHeader), column: NF } };
    ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
    ws.pageSetup.printTitlesRow = `${rowMes}:${rowHeader}`;
    ws.pageSetup.printTitlesColumn = 'A:B';

    await this.baixarWorkbook(wb, params.titulo);
  }

}
