import type { jsPDF } from 'jspdf';
import { ReparoExterno } from '../models/eletrica-reparo.model';
import { REPARO_ENDERECO, REPARO_VERIFICACOES_PADRAO, dataBr, numeroReparo } from './eletrica-reparo';

// PDF no layout do "Relatório de Falha para Reparo Externo" (Word que a Elétrica usava):
// mesmas 8 seções, na mesma ordem, pra o fornecedor receber o documento de sempre.
// Gerado no navegador (jsPDF, carregado só quando alguém baixa) — sem function na Vercel.

const MARGEM = 15;
const LARGURA = 210 - MARGEM * 2;
const ALTURA_UTIL = 297 - MARGEM - 18; // reserva o rodapé
const AZUL: [number, number, number] = [30, 58, 138];

class Escritor {
  y = MARGEM;
  constructor(public doc: jsPDF) {}

  garantirEspaco(altura: number): void {
    if (this.y + altura > ALTURA_UTIL) {
      this.doc.addPage();
      this.y = MARGEM;
    }
  }

  secao(titulo: string): void {
    this.garantirEspaco(14);
    this.y += 4;
    this.doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...AZUL);
    this.doc.text(titulo, MARGEM, this.y);
    this.doc.setDrawColor(...AZUL).setLineWidth(0.3).line(MARGEM, this.y + 1.5, MARGEM + LARGURA, this.y + 1.5);
    this.doc.setTextColor(0, 0, 0);
    this.y += 7;
  }

  paragrafo(texto: string, opts: { negrito?: boolean; recuo?: number } = {}): void {
    const recuo = opts.recuo ?? 0;
    this.doc.setFont('helvetica', opts.negrito ? 'bold' : 'normal').setFontSize(10);
    const linhas = this.doc.splitTextToSize(texto, LARGURA - recuo) as string[];
    for (const linha of linhas) {
      this.garantirEspaco(5);
      this.doc.text(linha, MARGEM + recuo, this.y);
      this.y += 5;
    }
  }

  // "Rótulo: valor" com o rótulo em negrito, quebrando o valor nas linhas seguintes.
  campo(rotulo: string, valor: string | null | undefined, recuo = 0): void {
    const r = `${rotulo}: `;
    this.doc.setFont('helvetica', 'bold').setFontSize(10);
    const larguraRotulo = this.doc.getTextWidth(r);
    this.doc.setFont('helvetica', 'normal');
    const linhas = this.doc.splitTextToSize(valor?.trim() || '—', LARGURA - recuo - larguraRotulo) as string[];
    this.garantirEspaco(5);
    this.doc.setFont('helvetica', 'bold').text(r, MARGEM + recuo, this.y);
    this.doc.setFont('helvetica', 'normal');
    linhas.forEach((linha, i) => {
      if (i > 0) { this.y += 5; this.garantirEspaco(5); }
      this.doc.text(linha, MARGEM + recuo + larguraRotulo, this.y);
    });
    this.y += 5;
  }

  // Caixinha de marcação desenhada (a fonte padrão não tem o caractere ☑).
  marcacao(texto: string, marcado: boolean, recuo = 0): void {
    this.doc.setFont('helvetica', 'normal').setFontSize(10);
    const linhas = this.doc.splitTextToSize(texto, LARGURA - recuo - 7) as string[];
    this.garantirEspaco(5 * linhas.length);
    const x = MARGEM + recuo;
    this.doc.setDrawColor(0, 0, 0).setLineWidth(0.25).rect(x, this.y - 3.2, 3.5, 3.5);
    if (marcado) {
      this.doc.setLineWidth(0.5).line(x + 0.6, this.y - 1.4, x + 1.5, this.y - 0.2).line(x + 1.5, this.y - 0.2, x + 3, this.y - 2.7);
    }
    linhas.forEach(linha => { this.doc.text(linha, x + 6, this.y); this.y += 5; });
  }
}

async function carregarImagem(url: string): Promise<{ dataUrl: string; largura: number; altura: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return { dataUrl, largura: img.naturalWidth, altura: img.naturalHeight };
  } catch {
    return null;
  }
}

export async function gerarPdfReparo(r: ReparoExterno): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const e = new Escritor(doc);

  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...AZUL);
  doc.text('Relatório de Falha para Reparo Externo', 105, e.y + 2, { align: 'center' });
  doc.setFontSize(11).text(numeroReparo(r.numero), 105, e.y + 8, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  e.y += 16;
  // Largura do rótulo medida ainda em negrito (é mais largo que o normal).
  const rotuloResp = 'Responsável pelo relatório: ';
  doc.setFont('helvetica', 'bold').setFontSize(10).text(rotuloResp, MARGEM, e.y);
  const larguraResp = doc.getTextWidth(rotuloResp);
  doc.setFont('helvetica', 'normal').text(r.solicitanteNome, MARGEM + larguraResp, e.y);
  const data = r.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  doc.setFont('helvetica', 'bold').text('Data: ', MARGEM + LARGURA - 32, e.y);
  const larguraData = doc.getTextWidth('Data: ');
  doc.setFont('helvetica', 'normal').text(data, MARGEM + LARGURA - 32 + larguraData, e.y);
  e.y += 4;

  e.secao('1. Identificação do equipamento');
  e.campo('Equipamento', r.equipamento);
  e.campo('Fabricante / Modelo', r.fabricanteModelo);
  e.campo('Nº de série', r.numeroSerie);
  e.campo('TAG / Código SAP', r.tagSap);
  e.campo('Localização', r.localizacao);
  e.campo('Tempo de operação (aprox.)', r.tempoOperacao);

  e.secao('2. Resumo da ocorrência');
  e.paragrafo(r.resumo);

  e.secao('3. Descrição dos defeitos');
  if (!r.defeitos.length) e.paragrafo('Nenhum defeito detalhado.');
  r.defeitos.forEach((d, i) => {
    e.garantirEspaco(12);
    e.paragrafo(`Defeito ${i + 1}: ${d.titulo || '—'}`, { negrito: true });
    if (d.sintoma) e.campo('Sintoma', d.sintoma, 4);
    if (d.evolucao) e.campo('Evolução', d.evolucao, 4);
    if (d.situacaoAtual) e.campo('Situação atual', d.situacaoAtual, 4);
    e.campo('Causa provável', d.causaProvavel || 'Não identificada em campo.', 4);
    e.y += 2;
  });

  e.secao('4. Verificações realizadas em campo');
  const extras = r.verificacoes.filter(v => !REPARO_VERIFICACOES_PADRAO.includes(v));
  REPARO_VERIFICACOES_PADRAO.forEach(v => e.marcacao(v, r.verificacoes.includes(v)));
  extras.forEach(v => e.marcacao(v, true));
  e.y += 1;
  e.campo('Resultado', r.verificacaoResultado);

  e.secao('5. Histórico');
  e.campo('Data do início dos sintomas', dataBr(r.dataInicioSintomas) || null);
  e.campo('Data da falha total', dataBr(r.dataFalhaTotal) || null);
  e.campo('Intervenções anteriores / reparos', r.intervencoesAnteriores);
  e.garantirEspaco(6);
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Garantia:', MARGEM, e.y);
  const yGarantia = e.y;
  const xBase = MARGEM + doc.getTextWidth('Garantia: ') + 2;
  // "Não sei" não tem caixa no relatório original: as duas ficam desmarcadas.
  [['vigente', 'Vigente'], ['expirada', 'Expirada']].forEach(([valor, rotulo], i) => {
    const x = xBase + i * 30;
    doc.setDrawColor(0, 0, 0).setLineWidth(0.25).rect(x, yGarantia - 3.2, 3.5, 3.5);
    if (r.garantia === valor) {
      doc.setLineWidth(0.5).line(x + 0.6, yGarantia - 1.4, x + 1.5, yGarantia - 0.2).line(x + 1.5, yGarantia - 0.2, x + 3, yGarantia - 2.7);
    }
    doc.setFont('helvetica', 'normal').text(rotulo, x + 5.5, yGarantia);
  });
  e.y += 6;

  e.secao('6. Serviço solicitado');
  e.paragrafo(r.servicoSolicitado);

  e.garantirEspaco(26); // título + contato + endereço na mesma página
  e.secao('7. Dados para contato e retorno');
  e.campo('Contato', [r.contatoNome, r.contatoTelefone, r.contatoEmail].filter(Boolean).join(' / ') || null);
  e.campo('Endereço', REPARO_ENDERECO);

  if (r.fotos.length) {
    e.secao('8. Fotos do equipamento');
    const imagens = await Promise.all(r.fotos.map(f => carregarImagem(f.url)));
    const colunas = 2;
    const gap = 6;
    const larguraCelula = (LARGURA - gap) / colunas;
    const alturaMax = 75;
    for (let i = 0; i < r.fotos.length; i += colunas) {
      const linha = r.fotos.slice(i, i + colunas).map((f, j) => ({ foto: f, img: imagens[i + j] }));
      const alturas = linha.map(({ img }) =>
        img ? Math.min(alturaMax, larguraCelula * (img.altura / img.largura)) : 20);
      const alturaLinha = Math.max(...alturas) + 9;
      e.garantirEspaco(alturaLinha);
      linha.forEach(({ foto, img }, j) => {
        const x = MARGEM + j * (larguraCelula + gap);
        if (img) {
          let w = larguraCelula;
          let h = w * (img.altura / img.largura);
          if (h > alturaMax) { h = alturaMax; w = h * (img.largura / img.altura); }
          doc.addImage(img.dataUrl, 'JPEG', x + (larguraCelula - w) / 2, e.y, w, h);
        } else {
          doc.setFont('helvetica', 'italic').setFontSize(9).text('(foto indisponível)', x + larguraCelula / 2, e.y + 10, { align: 'center' });
        }
        doc.setFont('helvetica', 'normal').setFontSize(9);
        doc.text(doc.splitTextToSize(foto.legenda || '', larguraCelula) as string[], x + larguraCelula / 2, e.y + alturas[j] + 5, { align: 'center' });
      });
      e.y += alturaLinha;
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120, 120, 120);
    doc.text(`${numeroReparo(r.numero)} · ${r.equipamento}`.slice(0, 90), MARGEM, 297 - 10);
    doc.text(`Página ${p} de ${total}`, 210 - MARGEM, 297 - 10, { align: 'right' });
  }

  return doc.output('blob');
}

export function nomeArquivoPdf(r: ReparoExterno): string {
  const equip = r.equipamento.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `${numeroReparo(r.numero)}_Relatorio_Reparo_Externo_${equip}.pdf`;
}

export async function baixarPdfReparo(r: ReparoExterno): Promise<void> {
  const blob = await gerarPdfReparo(r);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoPdf(r);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
