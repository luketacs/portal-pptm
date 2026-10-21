import type { jsPDF } from 'jspdf';

// Peças do PDF em formato de ficha técnica (tabelas rótulo | valor com linhas finas,
// títulos em azul sublinhados, logo da Diamante). Usado pelo Reparo Externo e pelos
// Ensaios de Motores — mudar o visual aqui muda nos dois.

export type Rgb = [number, number, number];
export const TITULO: Rgb = [31, 45, 110];
export const TEXTO: Rgb = [33, 33, 33];
export const ROTULO: Rgb = [80, 80, 80];
export const SUAVE: Rgb = [120, 120, 120];
export const LINHA_TABELA: Rgb = [185, 185, 185];
export const FUNDO_ROTULO: Rgb = [243, 243, 243];

export const MARGEM = 15;
export const LARGURA = 210 - MARGEM * 2;
export const LIMITE_Y = 280; // abaixo disso é o rodapé
export const TOPO_CONTINUACAO = 22;
export const LINHA = 4.3; // altura de uma linha de texto 9pt
export const RODAPE = 'Diamante Geração de Energia · Complexo Termoelétrico do Pecém';

export interface Campo {
  rotulo: string;
  valor: string | null | undefined;
  largo?: boolean; // ocupa a linha inteira da tabela
}

export interface Imagem {
  dataUrl: string;
  formato: 'PNG' | 'JPEG';
  largura: number;
  altura: number;
}

// A Helvetica embutida do jsPDF só tem o conjunto WinAnsi: Ω, ≥, ≤, →, −, Δ saem como lixo.
// Δ vira D (notação IEC de ligação: Dyn, Dd).
export function textoPdf(texto: string): string {
  return texto.replace(/Ω/g, 'Ohm').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/−/g, '-').replace(/Δ/g, 'D');
}

export class Escritor {
  y = 0;
  constructor(public doc: jsPDF) {}

  garantirEspaco(altura: number): void {
    if (this.y + altura > LIMITE_Y) {
      this.doc.addPage();
      this.y = TOPO_CONTINUACAO;
    }
  }

  private fonte(estilo: 'normal' | 'bold', tamanho: number, cor: Rgb): void {
    this.doc.setFont('helvetica', estilo).setFontSize(tamanho).setTextColor(...cor);
  }

  private quebrar(texto: string, largura: number, estilo: 'normal' | 'bold' = 'normal', tamanho = 9): string[] {
    this.doc.setFont('helvetica', estilo).setFontSize(tamanho);
    return this.doc.splitTextToSize(textoPdf(texto), largura) as string[];
  }

  secao(titulo: string): void {
    this.garantirEspaco(26); // título nunca fica sozinho no pé da página
    this.y += 5;
    this.fonte('bold', 10.5, TITULO);
    this.doc.text(textoPdf(titulo), MARGEM, this.y);
    this.doc.setDrawColor(...TITULO).setLineWidth(0.3).line(MARGEM, this.y + 1.6, MARGEM + LARGURA, this.y + 1.6);
    this.y += 5;
  }

  subtitulo(texto: string): void {
    this.garantirEspaco(18);
    this.fonte('bold', 9.5, TEXTO);
    this.doc.text(textoPdf(texto), MARGEM, this.y + 3.5);
    this.y += 5.5;
  }

  paragrafo(texto: string): void {
    const linhas = this.quebrar(texto, LARGURA);
    for (const l of linhas) {
      this.garantirEspaco(LINHA);
      this.fonte('normal', 9, TEXTO);
      this.doc.text(l, MARGEM, this.y + 3.2);
      this.y += LINHA;
    }
    this.y += 1.5;
  }

  // Tabela rótulo | valor, com 1 ou 2 pares por linha. Rótulo em célula cinza-clara.
  tabela(campos: Campo[], paresPorLinha: 1 | 2, larguraRotulo = 40): void {
    const linhas: Campo[][] = [];
    let atual: Campo[] = [];
    for (const c of campos) {
      if (c.largo || paresPorLinha === 1) {
        if (atual.length) linhas.push(atual);
        linhas.push([c]);
        atual = [];
        continue;
      }
      atual.push(c);
      if (atual.length === paresPorLinha) { linhas.push(atual); atual = []; }
    }
    if (atual.length) linhas.push(atual);

    const larguraPar = LARGURA / paresPorLinha;
    for (const linha of linhas) {
      const celulas = linha.map((c, i) => {
        const larguraTotal = linha.length === 1 ? LARGURA : larguraPar;
        const x = MARGEM + i * larguraPar;
        const larguraValor = larguraTotal - larguraRotulo;
        return {
          x, larguraTotal, larguraValor,
          rotulo: this.quebrar(c.rotulo, larguraRotulo - 3, 'normal', 8.5),
          valor: this.quebrar(c.valor?.trim() || '—', larguraValor - 3),
        };
      });
      const n = Math.max(...celulas.flatMap(c => [c.rotulo.length, c.valor.length]));
      const altura = n * LINHA + 3.2;
      this.garantirEspaco(altura);
      const doc = this.doc;
      doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2);
      for (const c of celulas) {
        doc.setFillColor(...FUNDO_ROTULO).rect(c.x, this.y, larguraRotulo, altura, 'FD');
        doc.rect(c.x + larguraRotulo, this.y, c.larguraValor, altura, 'S');
        this.fonte('normal', 8.5, ROTULO);
        c.rotulo.forEach((t, i) => doc.text(t, c.x + 1.8, this.y + 4.8 + i * LINHA));
        this.fonte('normal', 9, TEXTO);
        c.valor.forEach((t, i) => doc.text(t, c.x + larguraRotulo + 1.8, this.y + 4.8 + i * LINHA));
      }
      this.y += altura;
    }
    this.y += 2;
  }

  // Tabela com cabeçalho e colunas fixas (verificações).
  tabelaColunas(cabecalho: string[], larguras: number[], linhas: string[][], alinharCentro: boolean[]): void {
    const desenharLinha = (valores: string[], cabeca: boolean) => {
      const textos = valores.map((v, i) => this.quebrar(v, larguras[i] - 3.6, cabeca ? 'bold' : 'normal', cabeca ? 8.5 : 9));
      const altura = Math.max(...textos.map(t => t.length)) * LINHA + 3.2;
      this.garantirEspaco(altura);
      const doc = this.doc;
      let x = MARGEM;
      doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2);
      textos.forEach((t, i) => {
        if (cabeca) doc.setFillColor(...FUNDO_ROTULO).rect(x, this.y, larguras[i], altura, 'FD');
        else doc.rect(x, this.y, larguras[i], altura, 'S');
        this.fonte(cabeca ? 'bold' : 'normal', cabeca ? 8.5 : 9, cabeca ? ROTULO : TEXTO);
        t.forEach((l, j) => {
          if (alinharCentro[i]) doc.text(l, x + larguras[i] / 2, this.y + 4.8 + j * LINHA, { align: 'center' });
          else doc.text(l, x + 1.8, this.y + 4.8 + j * LINHA);
        });
        x += larguras[i];
      });
      this.y += altura;
    };
    desenharLinha(cabecalho, true);
    linhas.forEach(l => desenharLinha(l, false));
    this.y += 2;
  }
}

export interface OpcoesImagem {
  maxLado: number;
  // Fração da imagem a manter (0–1), pra cortar a margem branca do logo.
  recorte?: { x: number; y: number; w: number; h: number };
}

// Carrega e já reduz/recodifica em JPEG num canvas: o logo original tem 3539px e foto
// antiga pode não ter passado pela compressão do upload — sem isso o PDF passa de 10 MB.
export async function carregarImagem(url: string, opcoes: OpcoesImagem): Promise<Imagem | null> {
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
    const original: Imagem = {
      dataUrl,
      formato: dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG',
      largura: img.naturalWidth,
      altura: img.naturalHeight,
    };
    if (typeof document === 'undefined') return original; // testes (node)

    const r = opcoes.recorte ?? { x: 0, y: 0, w: 1, h: 1 };
    const sx = img.naturalWidth * r.x;
    const sy = img.naturalHeight * r.y;
    const sw = img.naturalWidth * r.w;
    const sh = img.naturalHeight * r.h;
    const escala = Math.min(1, opcoes.maxLado / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * escala);
    canvas.height = Math.round(sh * escala);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; // PNG transparente vira fundo branco no JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), formato: 'JPEG', largura: canvas.width, altura: canvas.height };
  } catch {
    return null;
  }
}

// Desenha a imagem inteira (sem cortar) centralizada na caixa.
export function imagemContida(doc: jsPDF, img: Imagem, x: number, y: number, w: number, h: number): void {
  let iw = w;
  let ih = w * (img.altura / img.largura);
  if (ih > h) { ih = h; iw = h * (img.largura / img.altura); }
  doc.addImage(img.dataUrl, img.formato, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}


export function cabecalhoFicha(doc: jsPDF, titulo: string, subtitulo: string, logo: Imagem | null): number {
  if (logo) {
    imagemContida(doc, logo, MARGEM, 10, 62, 13);
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...TITULO).text('DIAMANTE', MARGEM, 19);
  }
  const direita = MARGEM + LARGURA;
  doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(...TITULO);
  doc.text(textoPdf(titulo), direita, 15.5, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...ROTULO);
  doc.text(textoPdf(subtitulo), direita, 21, { align: 'right' });
  doc.setDrawColor(...TITULO).setLineWidth(0.5).line(MARGEM, 27, direita, 27);
  return 31;
}

// Cabeçalho de continuação (página 2 em diante) e rodapé com "Página N de M".
export function moldurasFicha(doc: jsPDF, titulo: string, identificacao: string, numero: string): void {
  const total = doc.getNumberOfPages();
  const direita = MARGEM + LARGURA;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SUAVE);
      doc.text(titulo, MARGEM, 12);
      doc.text(textoPdf(identificacao).slice(0, 70), direita, 12, { align: 'right' });
      doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).line(MARGEM, 14.5, direita, 14.5);
    }
    doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).line(MARGEM, 285, direita, 285);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SUAVE);
    doc.text(RODAPE, MARGEM, 289.5);
    doc.text(`${numero}  ·  Página ${p} de ${total}`, direita, 289.5, { align: 'right' });
  }
}

// Logo da Diamante já recortado (o PNG tem ~15% de margem branca em volta).
export function carregarLogo(): Promise<Imagem | null> {
  return carregarImagem('/company-logo.png', { maxLado: 1200, recorte: { x: 0.14, y: 0.17, w: 0.72, h: 0.68 } });
}

export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
