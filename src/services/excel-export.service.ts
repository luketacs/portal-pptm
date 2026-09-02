import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx-js-style';
import type { CellStyle, WorkSheet, WorkBook } from 'xlsx-js-style';
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
// ATUAÇÃO, 7 colunas de dia (datas reais + SEG..DOM) e STATUS, um bloco por técnico
// com o nome mesclado na lateral. Não replica marcadores manuais que a planilha
// original tinha (DSR, "trab", "BH") porque o Portal não rastreia esses códigos —
// só marca os dias em que a linha está prevista.
export interface ProgramacaoSemanalLinha {
  tipo: 'ordem' | 'folga' | 'treinamento';
  numeroOs: string | null;
  semOs: boolean;
  descricao: string;
  duracaoHoras: number | null;
  equipamento: string;
  recursos: string;
  loto: string;
  areaAtuacao: string;
  diasPrevistos: string[]; // datas ISO ('YYYY-MM-DD') dentro da semana exportada
  status: string;
}

export interface ProgramacaoSemanalGrupo {
  tecnico: string;
  linhas: ProgramacaoSemanalLinha[];
}

export interface ProgramacaoSemanalDia {
  data: string;   // ISO
  diaMes: string; // "27/7" — igual ao cabeçalho da planilha original
  label: string;  // "SEG"
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

  // ── Estilos — Programação de Manutenção (cores conferidas na planilha original) ──

  private sProgHeader(): CellStyle {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
      fill: { fgColor: { rgb: 'FF7E1D' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: 'FFFFFF' } }, bottom: { style: 'thin', color: { rgb: 'FFFFFF' } } },
    };
  }

  private sProgSubHeader(): CellStyle {
    return {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 9 },
      fill: { fgColor: { rgb: '0070C0' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  private sProgTecnico(): CellStyle {
    return {
      font: { bold: true, sz: 10, color: { rgb: '1A1A1A' } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: 'DDDDDD' } } },
    };
  }

  private sProgDado(align: 'left' | 'center' | 'right' = 'left'): CellStyle {
    return {
      font: { sz: 9, color: { rgb: '333333' } },
      alignment: { horizontal: align, vertical: 'center', wrapText: align === 'left' },
    };
  }

  private sProgDiaOrdem(): CellStyle {
    return { fill: { fgColor: { rgb: 'DCE6F1' }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center' } };
  }

  private sProgDiaAusencia(): CellStyle {
    return {
      font: { bold: true, sz: 8, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: 'FF0000' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
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
  // Réplica do layout da planilha que o time já usava: cabeçalho ORDEM/DESCRIÇÃO/
  // DURAÇÃO/EQUIPAMENTO/RECURSOS/LOTO/ÁREA DE ATUAÇÃO + 7 colunas de dia (datas
  // reais + SEG..DOM) + STATUS, repetido por técnico, com o nome mesclado na
  // lateral esquerda do bloco inteiro.

  private tabelaTecnicoOriginal(
    ws: WorkSheet, rowInicial: number, NC: number, grupo: ProgramacaoSemanalGrupo, dias: ProgramacaoSemanalDia[],
  ): number {
    let row = rowInicial;

    // Cabeçalho de colunas (laranja) — igual ao original.
    ws[this.enc(row, 0)] = { v: '', t: 's', s: this.sProgHeader() };
    const headersFixos: Array<[string, number]> = [
      ['ORDEM', 1], ['DESCRIÇÃO DA ATIVIDADE', 2], ['DURAÇÃO', 3], ['EQUIPAMENTO', 4],
      ['RECURSOS', 5], ['LOTO', 6], ['ÁREA DE ATUAÇÃO', 7],
    ];
    headersFixos.forEach(([label, c]) => { ws[this.enc(row, c)] = { v: label, t: 's', s: this.sProgHeader() }; });
    dias.forEach((dia, i) => { ws[this.enc(row, 8 + i)] = { v: dia.diaMes, t: 's', s: this.sProgHeader() }; });
    ws[this.enc(row, 15)] = { v: 'STATUS', t: 's', s: this.sProgHeader() };
    row++;

    // Sub-cabeçalho (azul) com SEG..DOM sob as datas — igual ao original.
    this.fillRow(ws, row, NC, this.sProgSubHeader());
    dias.forEach((dia, i) => { ws[this.enc(row, 8 + i)] = { v: dia.label, t: 's', s: this.sProgSubHeader() }; });
    row++;

    const linhaBlocoInicio = row;
    const linhas = grupo.linhas.length > 0 ? grupo.linhas : null;

    if (!linhas) {
      this.s(ws, row, 1, '', this.sProgDado('center'));
      this.s(ws, row, 2, 'Nenhum lançamento na semana', this.sProgDado('left'));
      for (let c = 3; c < 8; c++) this.s(ws, row, c, '', this.sProgDado('left'));
      for (let c = 8; c < 15; c++) this.s(ws, row, c, '', this.sProgDado('center'));
      this.s(ws, row, 15, '', this.sProgDado('center'));
      row++;
    } else {
      linhas.forEach(linha => {
        const numeroLabel = linha.tipo === 'folga' ? 'FOLGA'
          : linha.tipo === 'treinamento' ? 'TREINAMENTO'
          : linha.numeroOs ? linha.numeroOs
          : linha.semOs ? 'SEM OS'
          : 'CRIAR OS';
        this.s(ws, row, 1, numeroLabel, this.sProgDado('center'));
        this.s(ws, row, 2, linha.descricao, this.sProgDado('left'));
        if (linha.duracaoHoras !== null) {
          this.n(ws, row, 3, linha.duracaoHoras, this.sProgDado('center'), '0.00');
        } else {
          this.s(ws, row, 3, '', this.sProgDado('center'));
        }
        this.s(ws, row, 4, linha.equipamento, this.sProgDado('left'));
        this.s(ws, row, 5, linha.recursos, this.sProgDado('left'));
        this.s(ws, row, 6, linha.loto, this.sProgDado('center'));
        this.s(ws, row, 7, linha.areaAtuacao, this.sProgDado('left'));

        dias.forEach((dia, i) => {
          const c = 8 + i;
          if (!linha.diasPrevistos.includes(dia.data)) {
            this.s(ws, row, c, '', this.sProgDado('center'));
          } else if (linha.tipo === 'ordem') {
            ws[this.enc(row, c)] = { v: '', t: 's', s: this.sProgDiaOrdem() };
          } else {
            ws[this.enc(row, c)] = { v: linha.tipo === 'folga' ? 'FOLGA' : 'TREINO', t: 's', s: this.sProgDiaAusencia() };
          }
        });

        this.s(ws, row, 15, linha.status, this.sProgDado('center'));
        row++;
      });
    }

    // Nome do técnico mesclado por toda a altura do bloco.
    ws[this.enc(linhaBlocoInicio, 0)] = { v: grupo.tecnico, t: 's', s: this.sProgTecnico() };
    for (let r = linhaBlocoInicio + 1; r < row; r++) {
      ws[this.enc(r, 0)] = { v: '', t: 's', s: this.sProgTecnico() };
    }
    ws['!merges'] = ws['!merges'] ?? [];
    (ws['!merges'] as { s: { r: number; c: number }; e: { r: number; c: number } }[]).push(
      { s: { r: linhaBlocoInicio, c: 0 }, e: { r: row - 1, c: 0 } },
    );

    row++; // espaço entre blocos de técnico
    return row;
  }

  exportarProgramacaoSemanal(params: {
    semanaLabel: string;
    areaLabel: string;
    dias: ProgramacaoSemanalDia[];
    grupos: ProgramacaoSemanalGrupo[];
  }): void {
    const NC = 16;
    const ws: WorkSheet = {};
    ws['!merges'] = [];
    let row = 0;

    this.fillRow(ws, row, NC, this.sTitle());
    ws[this.enc(row, 0)] = { v: `PROGRAMAÇÃO MANUTENÇÃO ${params.areaLabel.toUpperCase()} - ${params.semanaLabel}`, t: 's', s: this.sTitle() };
    const linhaTitulo = row;
    row++;
    row++; // espaço

    for (const grupo of params.grupos) {
      row = this.tabelaTecnicoOriginal(ws, row, NC, grupo, params.dias);
    }

    ws['!ref']    = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: NC - 1 } });
    (ws['!merges'] as { s: { r: number; c: number }; e: { r: number; c: number } }[]).push(
      { s: { r: linhaTitulo, c: 0 }, e: { r: linhaTitulo, c: NC - 1 } },
    );
    ws['!cols'] = [
      { wch: 14 }, { wch: 10 }, { wch: 46 }, { wch: 9 }, { wch: 16 },
      { wch: 12 }, { wch: 10 }, { wch: 20 },
      { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 },
      { wch: 10 },
    ];

    const wb: WorkBook = XLSX.utils.book_new();
    wb.Props = { Title: `Programação ${params.areaLabel} — ${params.semanaLabel}`, Company: 'Diamante Energia' };
    XLSX.utils.book_append_sheet(wb, ws, 'Programação');
    XLSX.writeFile(wb, `programacao_${params.areaLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')}_${this.todayStr()}.xlsx`);
  }
}
