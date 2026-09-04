import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx-js-style';
import type { CellStyle, WorkSheet, WorkBook } from 'xlsx-js-style';
import * as ExcelJS from 'exceljs';
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
  status: string;
}

export interface ProgramacaoSemanalGrupo {
  tecnico: string;
  linhas: ProgramacaoSemanalLinha[];
  feriasAte?: string; // "DD/MM/AAAA" — presente quando o técnico está de férias na semana
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

  private readonly PROG_NAVY = 'FF1F4E79';
  private readonly PROG_NAVY_CLARO = 'FFEBF1F8';
  private readonly PROG_BORDA = 'FFD9D9D9';
  private readonly PROG_DIA_ORDEM = 'FFDCE6F1';
  // DSR (fim de semana sem lançamento) — fundo claro, sem chamar mais atenção que o
  // resto da planilha.
  private readonly PROG_AUSENCIA_BG = 'FFFDE9D9';
  private readonly PROG_AUSENCIA_TEXTO = 'FFC0392B';
  // Cores por tipo de ausência — mesma paleta (fundo claro + texto colorido) usada na
  // tela do Portal pros badges de Folga/Treinamento/Exame Médico/Reunião, só que em
  // hex pro Excel. Nada de fundo sólido saturado — fica pesado numa planilha inteira.
  private readonly PROG_FOLGA_BG = 'FFFEE2E2';
  private readonly PROG_FOLGA_TEXTO = 'FFB91C1C';
  private readonly PROG_TREINAMENTO_BG = 'FFE0E7FF';
  private readonly PROG_TREINAMENTO_TEXTO = 'FF4338CA';
  private readonly PROG_EXAME_BG = 'FFCCFBF1';
  private readonly PROG_EXAME_TEXTO = 'FF0F766E';
  private readonly PROG_REUNIAO_BG = 'FFE0F2FE';
  private readonly PROG_REUNIAO_TEXTO = 'FF0369A1';

  private corAusenciaPorTipo(tipo: string): { bg: string; texto: string } {
    switch (tipo) {
      case 'folga': return { bg: this.PROG_FOLGA_BG, texto: this.PROG_FOLGA_TEXTO };
      case 'treinamento': return { bg: this.PROG_TREINAMENTO_BG, texto: this.PROG_TREINAMENTO_TEXTO };
      case 'exame_medico': return { bg: this.PROG_EXAME_BG, texto: this.PROG_EXAME_TEXTO };
      default: return { bg: this.PROG_REUNIAO_BG, texto: this.PROG_REUNIAO_TEXTO }; // reuniao
    }
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
    celDivisor.value = partes.join('   ·   ');
    celDivisor.font = { bold: true, size: 10, color: { argb: this.PROG_NAVY } };
    celDivisor.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_NAVY_CLARO } };
    celDivisor.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    row++;

    const linhas = grupo.linhas.length > 0 ? grupo.linhas : null;
    const primeiraLinhaRow = row;

    if (!linhas) {
      const cel = ws.getCell(row, 2);
      cel.value = 'Nenhum lançamento na semana';
      cel.font = { italic: true, size: 9, color: { argb: 'FF999999' } };
      row++;
    } else {
      linhas.forEach(linha => {
        const numeroLabel = linha.tipo === 'folga' ? this.labelFolga(linha.descricao)
          : linha.tipo === 'treinamento' ? 'TREINAMENTO'
          : linha.tipo === 'exame_medico' ? 'EXAME MÉDICO'
          : linha.tipo === 'reuniao' ? 'REUNIÃO'
          : linha.numeroOs ? linha.numeroOs
          : linha.semOs ? 'SEM OS'
          : 'CRIAR OS';

        const fonteBase: Partial<ExcelJS.Font> = { size: 9, color: { argb: 'FF333333' } };
        // Sem altura fixa aqui — deixa o Excel calcular sozinho quando a descrição
        // quebra em mais de uma linha (wrapText), senão o texto fica cortado.

        // Folga/Treinamento/Exame médico/Reunião não têm OS/equipamento/LOTO — em vez
        // de espalhar campos vazios pelas 7 primeiras colunas, vira uma faixa única com
        // o rótulo centralizado, fácil de bater o olho na semana inteira. Fundo claro
        // (mesma paleta da tela), não sólido saturado — fica pesado numa planilha
        // inteira. Reunião ainda carrega o título e o horário/local no mesmo texto,
        // senão essa informação se perde (não tem coluna própria pra isso).
        const ehAusenciaComBanner = linha.tipo === 'folga' || linha.tipo === 'treinamento'
          || linha.tipo === 'exame_medico' || linha.tipo === 'reuniao';

        if (ehAusenciaComBanner) {
          const cor = this.corAusenciaPorTipo(linha.tipo);
          ws.mergeCells(row, 1, row, 7);
          const cel = ws.getCell(row, 1);
          cel.value = linha.tipo === 'reuniao'
            ? `${numeroLabel} — ${linha.descricao}${linha.recursos && linha.recursos !== '—' ? ' (' + linha.recursos + ')' : ''}`
            : numeroLabel;
          cel.font = { bold: true, size: 10, color: { argb: cor.texto } };
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.bg } };
          cel.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          const cOs = ws.getCell(row, 1);
          cOs.value = numeroLabel;
          cOs.font = fonteBase;
          cOs.alignment = { horizontal: 'center', vertical: 'middle' };

          const cDesc = ws.getCell(row, 2);
          cDesc.value = linha.descricao;
          cDesc.font = fonteBase;
          cDesc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

          const cDur = ws.getCell(row, 3);
          if (linha.duracaoHoras !== null) {
            cDur.value = linha.duracaoHoras;
            cDur.numFmt = '0.00';
          }
          cDur.font = fonteBase;
          cDur.alignment = { horizontal: 'center', vertical: 'middle' };

          const cEquip = ws.getCell(row, 4);
          cEquip.value = linha.equipamento;
          cEquip.font = fonteBase;
          cEquip.alignment = { horizontal: 'left', vertical: 'middle' };

          const cRec = ws.getCell(row, 5);
          cRec.value = linha.recursos;
          cRec.font = fonteBase;
          cRec.alignment = { horizontal: 'left', vertical: 'middle' };

          const cLoto = ws.getCell(row, 6);
          cLoto.value = linha.loto;
          cLoto.font = fonteBase;
          cLoto.alignment = { horizontal: 'center', vertical: 'middle' };

          const cArea = ws.getCell(row, 7);
          cArea.value = linha.areaAtuacao;
          cArea.font = fonteBase;
          cArea.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        dias.forEach((dia, i) => {
          const cel = ws.getCell(row, 8 + i);
          cel.alignment = { horizontal: 'center', vertical: 'middle' };
          if (!linha.diasPrevistos.includes(dia.data)) return;
          if (linha.tipo === 'ordem') {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_DIA_ORDEM } };
          } else {
            const cor = this.corAusenciaPorTipo(linha.tipo);
            cel.value = linha.tipo === 'folga' ? this.labelFolga(linha.descricao) : linha.tipo === 'treinamento' ? 'TREINO' : linha.tipo === 'reuniao' ? 'REUNIÃO' : 'ASO';
            cel.font = { bold: true, size: 7, color: { argb: cor.texto } };
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.bg } };
          }
        });

        const cStatus = ws.getCell(row, 15);
        cStatus.value = linha.status;
        cStatus.font = fonteBase;
        cStatus.alignment = { horizontal: 'center', vertical: 'middle' };

        for (let c = 1; c <= NC; c++) ws.getCell(row, c).border = this.bordaFina();
        row++;
      });
    }

    // DSR nos fins de semana em que o técnico não tem nenhum lançamento marcado —
    // fundo claro (mesmo tom pastel do resto), mesclado numa célula só ao longo do
    // bloco dele. Se ele precisar trabalhar no sábado/domingo (tem algo em
    // diasPrevistos naquele dia), não mexe — os marcadores normais da linha
    // continuam valendo.
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
      cel.font = { bold: true, size: 8, color: { argb: this.PROG_AUSENCIA_TEXTO } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_AUSENCIA_BG } };
      cel.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let r = primeiraLinhaRow; r <= ultimaLinhaRow; r++) {
        ws.getCell(r, col).border = this.bordaFina();
      }
    });

    row++; // espaço entre blocos de técnico
    return row;
  }

  async exportarProgramacaoSemanal(params: {
    semanaLabel: string;
    areaLabel: string;
    dias: ProgramacaoSemanalDia[];
    grupos: ProgramacaoSemanalGrupo[];
  }): Promise<void> {
    const NC = 15;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal PPTM';
    wb.created = new Date();
    const ws = wb.addWorksheet('Programação', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 5 }],
    });

    ws.columns = [
      { width: 13 }, { width: 46 }, { width: 9 }, { width: 16 }, { width: 12 },
      { width: 10 }, { width: 20 },
      { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 },
      { width: 10 },
    ];

    const logoBuffer = await this.carregarLogoBuffer();
    if (logoBuffer) {
      const logoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
      ws.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 150, height: 45 } });
    }

    ws.getRow(1).height = 22;
    ws.getRow(2).height = 16;
    ws.getRow(3).height = 14;
    ws.getRow(4).height = 8;

    ws.mergeCells(1, 3, 1, NC);
    const cTitulo = ws.getCell(1, 3);
    cTitulo.value = `Programação de Manutenção — ${params.areaLabel}`;
    cTitulo.font = { bold: true, size: 14, color: { argb: this.PROG_NAVY } };
    cTitulo.alignment = { horizontal: 'left', vertical: 'middle' };

    ws.mergeCells(2, 3, 2, NC);
    const cSub = ws.getCell(2, 3);
    cSub.value = params.semanaLabel;
    cSub.font = { size: 10, color: { argb: 'FF555555' } };
    cSub.alignment = { horizontal: 'left', vertical: 'middle' };

    ws.mergeCells(3, 3, 3, NC);
    const cGerado = ws.getCell(3, 3);
    cGerado.value = `Gerado em ${this.nowStr()}`;
    cGerado.font = { size: 8, italic: true, color: { argb: 'FF999999' } };
    cGerado.alignment = { horizontal: 'left', vertical: 'middle' };

    let row = 5;
    const headerRow = ws.getRow(row);
    headerRow.height = 26;
    const headersFixos: Array<[string, number]> = [
      ['OS', 1], ['Descrição', 2], ['Duração', 3], ['Equipamento', 4], ['Recursos', 5], ['LOTO', 6], ['Área Atuação', 7],
    ];
    const estiloHeader = (cel: ExcelJS.Cell) => {
      cel.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.PROG_NAVY } };
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
    const cStatusHeader = headerRow.getCell(15);
    cStatusHeader.value = 'Status';
    estiloHeader(cStatusHeader);
    row++;

    for (const grupo of params.grupos) {
      row = this.tabelaTecnicoExcelJs(ws, row, NC, grupo, params.dias);
    }

    ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `programacao_${params.areaLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')}_${this.todayStr()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
