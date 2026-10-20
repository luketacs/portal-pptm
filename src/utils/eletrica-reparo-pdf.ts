import type { jsPDF } from 'jspdf';
import { ReparoExterno } from '../models/eletrica-reparo.model';
import {
  REPARO_ENDERECO, REPARO_GARANTIA_LABEL, REPARO_VERIFICACOES_PADRAO, dataBr, numeroReparo,
} from './eletrica-reparo';

// PDF do "Relatório de Falha para Reparo Externo": mesmas 8 seções do Word que a Elétrica
// usava, no formato de ficha técnica (tabelas com linhas finas, rótulo à esquerda), com o
// logo da Diamante — é o documento que vai pro fornecedor.
// Gerado no navegador (jsPDF, carregado só quando alguém baixa) — sem function na Vercel.

type Rgb = [number, number, number];
const TITULO: Rgb = [31, 45, 110];
const TEXTO: Rgb = [33, 33, 33];
const ROTULO: Rgb = [80, 80, 80];
const SUAVE: Rgb = [120, 120, 120];
const LINHA_TABELA: Rgb = [185, 185, 185];
const FUNDO_ROTULO: Rgb = [243, 243, 243];

const MARGEM = 15;
const LARGURA = 210 - MARGEM * 2;
const LIMITE_Y = 280; // abaixo disso é o rodapé
const TOPO_CONTINUACAO = 22;
const LINHA = 4.3; // altura de uma linha de texto 9pt
const RODAPE = 'Diamante Geração de Energia · Complexo Termoelétrico do Pecém';

interface Campo {
  rotulo: string;
  valor: string | null | undefined;
  largo?: boolean; // ocupa a linha inteira da tabela
}

interface Imagem {
  dataUrl: string;
  formato: 'PNG' | 'JPEG';
  largura: number;
  altura: number;
}

class Escritor {
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
    return this.doc.splitTextToSize(texto, largura) as string[];
  }

  secao(titulo: string): void {
    this.garantirEspaco(26); // título nunca fica sozinho no pé da página
    this.y += 5;
    this.fonte('bold', 10.5, TITULO);
    this.doc.text(titulo, MARGEM, this.y);
    this.doc.setDrawColor(...TITULO).setLineWidth(0.3).line(MARGEM, this.y + 1.6, MARGEM + LARGURA, this.y + 1.6);
    this.y += 5;
  }

  subtitulo(texto: string): void {
    this.garantirEspaco(18);
    this.fonte('bold', 9.5, TEXTO);
    this.doc.text(texto, MARGEM, this.y + 3.5);
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

interface OpcoesImagem {
  maxLado: number;
  // Fração da imagem a manter (0–1), pra cortar a margem branca do logo.
  recorte?: { x: number; y: number; w: number; h: number };
}

// Carrega e já reduz/recodifica em JPEG num canvas: o logo original tem 3539px e foto
// antiga pode não ter passado pela compressão do upload — sem isso o PDF passa de 10 MB.
async function carregarImagem(url: string, opcoes: OpcoesImagem): Promise<Imagem | null> {
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
function imagemContida(doc: jsPDF, img: Imagem, x: number, y: number, w: number, h: number): void {
  let iw = w;
  let ih = w * (img.altura / img.largura);
  if (ih > h) { ih = h; iw = h * (img.largura / img.altura); }
  doc.addImage(img.dataUrl, img.formato, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function cabecalho(doc: jsPDF, r: ReparoExterno, logo: Imagem | null): number {
  if (logo) {
    imagemContida(doc, logo, MARGEM, 10, 62, 13);
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...TITULO).text('DIAMANTE', MARGEM, 19);
  }
  const direita = MARGEM + LARGURA;
  doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(...TITULO);
  doc.text('Relatório de Falha para Reparo Externo', direita, 15.5, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...ROTULO);
  doc.text(`Nº ${numeroReparo(r.numero)}`, direita, 21, { align: 'right' });
  doc.setDrawColor(...TITULO).setLineWidth(0.5).line(MARGEM, 27, direita, 27);
  return 31;
}

function moldurasDePagina(doc: jsPDF, r: ReparoExterno): void {
  const total = doc.getNumberOfPages();
  const direita = MARGEM + LARGURA;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SUAVE);
      doc.text('Relatório de Falha para Reparo Externo', MARGEM, 12);
      doc.text(`${numeroReparo(r.numero)} · ${r.equipamento}`.slice(0, 70), direita, 12, { align: 'right' });
      doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).line(MARGEM, 14.5, direita, 14.5);
    }
    doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).line(MARGEM, 285, direita, 285);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SUAVE);
    doc.text(RODAPE, MARGEM, 289.5);
    doc.text(`${numeroReparo(r.numero)}  ·  Página ${p} de ${total}`, direita, 289.5, { align: 'right' });
  }
}

export async function gerarPdfReparo(r: ReparoExterno): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${numeroReparo(r.numero)} — Relatório de Falha para Reparo Externo`, author: 'Diamante Geração de Energia' });

  const [logo, ...fotos] = await Promise.all([
    // O PNG do logo tem ~15% de margem branca em volta; corta pra ele aparecer maior.
    carregarImagem('/company-logo.png', { maxLado: 1200, recorte: { x: 0.14, y: 0.17, w: 0.72, h: 0.68 } }),
    ...r.fotos.map(f => carregarImagem(f.url, { maxLado: 1400 })),
  ]);

  const e = new Escritor(doc);
  e.y = cabecalho(doc, r, logo);

  // Mesma linha do Word: "Responsável pelo relatório: ...   Data: ..."
  e.tabela([
    { rotulo: 'Responsável', valor: r.solicitanteNome },
    { rotulo: 'Data', valor: r.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) },
  ], 2, 28);

  e.secao('1. Identificação do equipamento');
  e.tabela([
    { rotulo: 'Equipamento', valor: r.equipamento },
    { rotulo: 'Fabricante / Modelo', valor: r.fabricanteModelo },
    { rotulo: 'Nº de série', valor: r.numeroSerie },
    { rotulo: 'TAG / Código', valor: r.tagSap },
    { rotulo: 'Localização', valor: r.localizacao },
    { rotulo: 'Tempo de operação', valor: r.tempoOperacao },
  ], 2);

  e.secao('2. Resumo da ocorrência');
  e.paragrafo(r.resumo);

  e.secao('3. Descrição dos defeitos');
  if (!r.defeitos.length) e.paragrafo('Nenhum defeito detalhado.');
  r.defeitos.forEach((d, i) => {
    e.subtitulo(`Defeito ${i + 1} – ${d.titulo || 'sem título'}`);
    e.tabela([
      ...(d.sintoma ? [{ rotulo: 'Sintoma', valor: d.sintoma }] : []),
      ...(d.evolucao ? [{ rotulo: 'Evolução', valor: d.evolucao }] : []),
      ...(d.situacaoAtual ? [{ rotulo: 'Situação atual', valor: d.situacaoAtual }] : []),
      { rotulo: 'Causa provável', valor: d.causaProvavel || 'Não identificada em campo.' },
    ], 1);
  });

  e.secao('4. Verificações realizadas em campo');
  const extras = r.verificacoes.filter(v => !REPARO_VERIFICACOES_PADRAO.includes(v));
  e.tabelaColunas(
    ['Verificação', 'Realizada'],
    [LARGURA - 26, 26],
    [
      ...REPARO_VERIFICACOES_PADRAO.map(v => [v, r.verificacoes.includes(v) ? 'Sim' : 'Não']),
      ...extras.map(v => [v, 'Sim']),
    ],
    [false, true],
  );
  if (r.verificacaoResultado) e.tabela([{ rotulo: 'Resultado', valor: r.verificacaoResultado }], 1);

  e.secao('5. Histórico');
  e.tabela([
    { rotulo: 'Início dos sintomas', valor: dataBr(r.dataInicioSintomas) },
    { rotulo: 'Falha total', valor: dataBr(r.dataFalhaTotal) },
    { rotulo: 'Garantia', valor: r.garantia ? REPARO_GARANTIA_LABEL[r.garantia] : null, largo: true },
    { rotulo: 'Intervenções anteriores', valor: r.intervencoesAnteriores, largo: true },
  ], 2);

  e.secao('6. Serviço solicitado');
  e.paragrafo(r.servicoSolicitado);

  e.secao('7. Dados para contato e retorno');
  e.tabela([
    { rotulo: 'Contato', valor: r.contatoNome },
    { rotulo: 'Telefone', valor: r.contatoTelefone },
    { rotulo: 'E-mail', valor: r.contatoEmail, largo: true },
    { rotulo: 'Endereço', valor: REPARO_ENDERECO, largo: true },
  ], 2);

  if (r.fotos.length) {
    e.secao('8. Fotos do equipamento');
    const gap = 5;
    const w = (LARGURA - gap) / 2;
    const hImg = 66;
    const hCelula = hImg + 7;
    for (let i = 0; i < r.fotos.length; i += 2) {
      e.garantirEspaco(hCelula + 2);
      for (let j = 0; j < 2 && i + j < r.fotos.length; j++) {
        const x = MARGEM + j * (w + gap);
        const img = fotos[i + j];
        doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).rect(x, e.y, w, hImg, 'S');
        if (img) {
          imagemContida(doc, img, x + 1.5, e.y + 1.5, w - 3, hImg - 3);
        } else {
          doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SUAVE).text('Foto indisponível', x + w / 2, e.y + hImg / 2, { align: 'center' });
        }
        const legenda = `Foto ${i + j + 1}${r.fotos[i + j].legenda ? ` – ${r.fotos[i + j].legenda}` : ''}`;
        doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...ROTULO);
        doc.text(doc.splitTextToSize(legenda, w)[0] as string, x, e.y + hImg + 4.5);
      }
      e.y += hCelula + 2;
    }
  }

  moldurasDePagina(doc, r);
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
