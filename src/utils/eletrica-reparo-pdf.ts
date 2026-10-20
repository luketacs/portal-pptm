import type { jsPDF } from 'jspdf';
import { ReparoExterno } from '../models/eletrica-reparo.model';
import {
  REPARO_ENDERECO, REPARO_GARANTIA_LABEL, REPARO_VERIFICACOES_PADRAO, dataBr, numeroReparo,
} from './eletrica-reparo';

// PDF do "Relatório de Falha para Reparo Externo": mesmas 8 seções do Word que a Elétrica
// usava, com a identidade da Diamante (logo + cores da marca) pra ir pro fornecedor.
// Gerado no navegador (jsPDF, carregado só quando alguém baixa) — sem function na Vercel.

type Rgb = [number, number, number];
const NAVY: Rgb = [43, 57, 144];
const AZUL_CLARO: Rgb = [59, 175, 227];
const LARANJA: Rgb = [238, 118, 35];
const TEXTO: Rgb = [30, 41, 59];
const CINZA: Rgb = [100, 116, 139];
const BORDA: Rgb = [226, 232, 240];
const FUNDO: Rgb = [248, 250, 252];
const FUNDO_AZUL: Rgb = [239, 246, 255];

const MARGEM = 15;
const LARGURA = 210 - MARGEM * 2;
const LIMITE_Y = 278; // abaixo disso é o rodapé
const TOPO_CONTINUACAO = 24;
const LINHA = 4.4; // altura de uma linha de texto 9,5pt
const RODAPE = 'Diamante Geração de Energia · Complexo Termoelétrico do Pecém';

interface Campo {
  rotulo: string;
  valor: string | null | undefined;
  largo?: boolean; // ocupa a linha inteira
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

  private fonte(estilo: 'normal' | 'bold' | 'italic', tamanho: number, cor: Rgb): void {
    this.doc.setFont('helvetica', estilo).setFontSize(tamanho).setTextColor(...cor);
  }

  private linhas(texto: string, largura: number): string[] {
    this.fonte('normal', 9.5, TEXTO);
    return this.doc.splitTextToSize(texto, largura) as string[];
  }

  // Título de seção: quadrado com o número + título em caixa alta + fio até a margem.
  secao(numero: number, titulo: string): void {
    this.garantirEspaco(32); // título nunca fica sozinho no pé da página
    this.y += 4;
    const doc = this.doc;
    doc.setFillColor(...NAVY).roundedRect(MARGEM, this.y - 4.6, 6.2, 6.2, 1, 1, 'F');
    this.fonte('bold', 9, [255, 255, 255]);
    doc.text(String(numero), MARGEM + 3.1, this.y - 0.4, { align: 'center' });
    this.fonte('bold', 10.5, NAVY);
    const t = titulo.toUpperCase();
    doc.text(t, MARGEM + 9, this.y);
    const fim = MARGEM + 9 + doc.getTextWidth(t) + 3;
    doc.setDrawColor(...BORDA).setLineWidth(0.3).line(fim, this.y - 1.5, MARGEM + LARGURA, this.y - 1.5);
    this.y += 6;
  }

  // Grade "rótulo pequeno em cima, valor embaixo", em N colunas.
  private montarLinhas(campos: Campo[], colunas: number, largura: number) {
    const gap = 6;
    const larguraCol = (largura - gap * (colunas - 1)) / colunas;
    const linhasGrade: { celulas: { campo: Campo; x: number; texto: string[] }[]; altura: number }[] = [];
    let atual: Campo[] = [];
    const fechar = (grupo: Campo[]) => {
      if (!grupo.length) return;
      const celulas = grupo.map((campo, i) => {
        const w = campo.largo ? largura : larguraCol;
        return { campo, x: i * (larguraCol + gap), texto: this.linhas(campo.valor?.trim() || '—', w) };
      });
      const maxLinhas = Math.max(...celulas.map(c => c.texto.length));
      linhasGrade.push({ celulas, altura: 7.6 + (maxLinhas - 1) * LINHA + 3.5 });
    };
    for (const campo of campos) {
      if (campo.largo) { fechar(atual); atual = []; fechar([campo]); continue; }
      atual.push(campo);
      if (atual.length === colunas) { fechar(atual); atual = []; }
    }
    fechar(atual);
    return linhasGrade;
  }

  medirGrade(campos: Campo[], colunas: number, largura = LARGURA): number {
    return this.montarLinhas(campos, colunas, largura).reduce((s, l) => s + l.altura, 0);
  }

  grade(campos: Campo[], colunas: number, x = MARGEM, largura = LARGURA, quebraPagina = true): void {
    for (const linha of this.montarLinhas(campos, colunas, largura)) {
      if (quebraPagina) this.garantirEspaco(linha.altura);
      for (const c of linha.celulas) {
        this.fonte('bold', 7, CINZA);
        this.doc.text(c.campo.rotulo.toUpperCase(), x + c.x, this.y + 3);
        this.fonte('normal', 9.5, TEXTO);
        c.texto.forEach((t, i) => this.doc.text(t, x + c.x, this.y + 7.6 + i * LINHA));
      }
      this.y += linha.altura;
    }
  }

  // Texto corrido dentro de uma caixa com fio colorido à esquerda.
  caixaTexto(texto: string, fundo: Rgb, fio: Rgb): void {
    const linhas = this.linhas(texto, LARGURA - 10);
    const altura = linhas.length * LINHA + 6;
    if (altura > LIMITE_Y - TOPO_CONTINUACAO) {
      // Texto enorme: sem caixa, quebrando página normalmente.
      linhas.forEach(l => { this.garantirEspaco(LINHA); this.fonte('normal', 9.5, TEXTO); this.doc.text(l, MARGEM, this.y + 3); this.y += LINHA; });
      this.y += 3;
      return;
    }
    this.garantirEspaco(altura);
    this.doc.setFillColor(...fundo).rect(MARGEM, this.y, LARGURA, altura, 'F');
    this.doc.setFillColor(...fio).rect(MARGEM, this.y, 1.2, altura, 'F');
    this.fonte('normal', 9.5, TEXTO);
    linhas.forEach((l, i) => this.doc.text(l, MARGEM + 6, this.y + 6.5 + i * LINHA));
    this.y += altura + 3;
  }

  // Cartão de um defeito: faixa laranja à esquerda, título e os 4 campos em 2 colunas.
  defeito(numero: number, titulo: string, campos: Campo[]): void {
    const larguraInterna = LARGURA - 12;
    const alturaGrade = this.medirGrade(campos, 2, larguraInterna);
    const altura = 12 + alturaGrade + 1;
    this.garantirEspaco(altura);
    const doc = this.doc;
    doc.setFillColor(...FUNDO).setDrawColor(...BORDA).setLineWidth(0.25).roundedRect(MARGEM, this.y, LARGURA, altura, 1.5, 1.5, 'FD');
    doc.setFillColor(...LARANJA).rect(MARGEM, this.y, 1.4, altura, 'F');
    this.fonte('bold', 7, LARANJA);
    doc.text(`DEFEITO ${numero}`, MARGEM + 6, this.y + 5.5);
    this.fonte('bold', 10.5, TEXTO);
    doc.text(doc.splitTextToSize(titulo || '—', larguraInterna - 22)[0] as string, MARGEM + 6 + 20, this.y + 5.6);
    const topo = this.y;
    this.y += 9;
    this.grade(campos, 2, MARGEM + 6, larguraInterna, false);
    this.y = topo + altura + 3;
  }

  // Item de checklist: caixa azul preenchida com ✓ quando feito, contorno cinza quando não.
  marcacao(texto: string, marcado: boolean): void {
    const linhas = this.linhas(texto, LARGURA - 8);
    this.garantirEspaco(linhas.length * LINHA + 1.5);
    caixaMarcacao(this.doc, MARGEM, this.y, marcado);
    this.fonte('normal', 9.5, marcado ? TEXTO : CINZA);
    linhas.forEach((l, i) => this.doc.text(l, MARGEM + 7, this.y + 3.2 + i * LINHA));
    this.y += linhas.length * LINHA + 1.5;
  }
}

function caixaMarcacao(doc: jsPDF, x: number, yTopo: number, marcado: boolean): void {
  if (marcado) {
    doc.setFillColor(...NAVY).roundedRect(x, yTopo, 4, 4, 0.7, 0.7, 'F');
    doc.setDrawColor(255, 255, 255).setLineWidth(0.55)
      .line(x + 0.9, yTopo + 2.1, x + 1.7, yTopo + 3)
      .line(x + 1.7, yTopo + 3, x + 3.2, yTopo + 1.1);
  } else {
    doc.setDrawColor(...CINZA).setLineWidth(0.3).roundedRect(x, yTopo, 4, 4, 0.7, 0.7, 'S');
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

function cabecalho(doc: jsPDF, r: ReparoExterno, logo: Imagem | null, abertura: string): number {
  if (logo) {
    imagemContida(doc, logo, MARGEM, 9, 72, 15);
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text('DIAMANTE', MARGEM, 19);
  }
  const direita = MARGEM + LARGURA;
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...CINZA).text('RELATÓRIO DE FALHA PARA', direita, 14, { align: 'right' });
  doc.setFontSize(17).setTextColor(...NAVY).text('Reparo Externo', direita, 21.5, { align: 'right' });

  // Fio da marca: laranja + azul-claro + marinho.
  doc.setFillColor(...LARANJA).rect(MARGEM, 27, 18, 1.1, 'F');
  doc.setFillColor(...AZUL_CLARO).rect(MARGEM + 18, 27, 18, 1.1, 'F');
  doc.setFillColor(...NAVY).rect(MARGEM + 36, 27, LARGURA - 36, 1.1, 'F');

  // Faixa de dados do chamado.
  const yFaixa = 32;
  doc.setFillColor(...FUNDO).setDrawColor(...BORDA).setLineWidth(0.25).roundedRect(MARGEM, yFaixa, LARGURA, 15, 1.5, 1.5, 'FD');
  const itens: [string, string, boolean][] = [
    ['Nº do chamado', numeroReparo(r.numero), true],
    ['Data de abertura', abertura, false],
    ['Responsável pelo relatório', r.solicitanteNome, false],
    ['Garantia', r.garantia === 'vigente' || r.garantia === 'expirada' ? REPARO_GARANTIA_LABEL[r.garantia] : 'Não informada', false],
  ];
  const larguras = [30, 32, 78, LARGURA - 140];
  let x = MARGEM + 5;
  itens.forEach(([rotulo, valor, destaque], i) => {
    doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(...CINZA).text(rotulo.toUpperCase(), x, yFaixa + 5.5);
    doc.setFont('helvetica', 'bold').setFontSize(destaque ? 12 : 9.5).setTextColor(...(destaque ? NAVY : TEXTO));
    doc.text(doc.splitTextToSize(valor, larguras[i] - 4)[0] as string, x, yFaixa + 11.5);
    x += larguras[i];
  });
  return yFaixa + 15 + 2;
}

function moldurasDePagina(doc: jsPDF, r: ReparoExterno, geradoEm: string): void {
  const total = doc.getNumberOfPages();
  const direita = MARGEM + LARGURA;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...NAVY).text('Relatório de Falha para Reparo Externo', MARGEM, 13);
      doc.setTextColor(...CINZA).text(`${numeroReparo(r.numero)} · ${r.equipamento}`.slice(0, 70), direita, 13, { align: 'right' });
      doc.setDrawColor(...BORDA).setLineWidth(0.3).line(MARGEM, 16, direita, 16);
    }
    doc.setDrawColor(...BORDA).setLineWidth(0.3).line(MARGEM, 284, direita, 284);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...CINZA);
    doc.text(RODAPE, MARGEM, 289);
    doc.text(`Gerado pelo Portal PPTM em ${geradoEm}`, MARGEM, 292.5);
    doc.setFont('helvetica', 'bold').setTextColor(...NAVY).text(`Página ${p} de ${total}`, direita, 289, { align: 'right' });
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

  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  const e = new Escritor(doc);
  e.y = cabecalho(doc, r, logo, r.createdAt.toLocaleDateString('pt-BR', fuso));

  e.secao(1, 'Identificação do equipamento');
  e.grade([
    { rotulo: 'Equipamento', valor: r.equipamento },
    { rotulo: 'Fabricante / Modelo', valor: r.fabricanteModelo },
    { rotulo: 'Nº de série', valor: r.numeroSerie },
    { rotulo: 'TAG / Código', valor: r.tagSap },
    { rotulo: 'Localização', valor: r.localizacao },
    { rotulo: 'Tempo de operação (aprox.)', valor: r.tempoOperacao },
  ], 3);

  e.secao(2, 'Resumo da ocorrência');
  e.caixaTexto(r.resumo, FUNDO, AZUL_CLARO);

  e.secao(3, 'Descrição dos defeitos');
  if (!r.defeitos.length) e.caixaTexto('Nenhum defeito detalhado.', FUNDO, BORDA);
  r.defeitos.forEach((d, i) => e.defeito(i + 1, d.titulo, [
    { rotulo: 'Sintoma', valor: d.sintoma },
    { rotulo: 'Evolução', valor: d.evolucao },
    { rotulo: 'Situação atual', valor: d.situacaoAtual },
    { rotulo: 'Causa provável', valor: d.causaProvavel || 'Não identificada em campo.' },
  ]));

  e.secao(4, 'Verificações realizadas em campo');
  REPARO_VERIFICACOES_PADRAO.forEach(v => e.marcacao(v, r.verificacoes.includes(v)));
  r.verificacoes.filter(v => !REPARO_VERIFICACOES_PADRAO.includes(v)).forEach(v => e.marcacao(v, true));
  e.y += 1;
  e.grade([{ rotulo: 'Resultado', valor: r.verificacaoResultado, largo: true }], 1);

  e.secao(5, 'Histórico');
  e.grade([
    { rotulo: 'Início dos sintomas', valor: dataBr(r.dataInicioSintomas) },
    { rotulo: 'Data da falha total', valor: dataBr(r.dataFalhaTotal) },
    { rotulo: 'Garantia', valor: r.garantia ? REPARO_GARANTIA_LABEL[r.garantia] : null },
    { rotulo: 'Intervenções anteriores / reparos', valor: r.intervencoesAnteriores, largo: true },
  ], 3);

  e.secao(6, 'Serviço solicitado');
  e.caixaTexto(r.servicoSolicitado, FUNDO_AZUL, NAVY);

  e.garantirEspaco(40); // título + contato + endereço na mesma página
  e.secao(7, 'Dados para contato e retorno');
  // 2 colunas: e-mail corporativo é longo e quebrava no meio em 3 colunas.
  e.grade([
    { rotulo: 'Contato', valor: r.contatoNome },
    { rotulo: 'Telefone', valor: r.contatoTelefone },
    { rotulo: 'E-mail', valor: r.contatoEmail },
    { rotulo: 'Endereço', valor: REPARO_ENDERECO },
  ], 2);

  if (r.fotos.length) {
    e.secao(8, 'Fotos do equipamento');
    const gap = 6;
    const w = (LARGURA - gap) / 2;
    const hImg = 64;
    const hCelula = hImg + 8;
    for (let i = 0; i < r.fotos.length; i += 2) {
      e.garantirEspaco(hCelula + 3);
      for (let j = 0; j < 2 && i + j < r.fotos.length; j++) {
        const x = MARGEM + j * (w + gap);
        const img = fotos[i + j];
        doc.setFillColor(...FUNDO).setDrawColor(...BORDA).setLineWidth(0.25).roundedRect(x, e.y, w, hImg, 1.5, 1.5, 'FD');
        if (img) {
          imagemContida(doc, img, x + 2, e.y + 2, w - 4, hImg - 4);
        } else {
          doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...CINZA).text('(foto indisponível)', x + w / 2, e.y + hImg / 2, { align: 'center' });
        }
        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...TEXTO);
        doc.text(doc.splitTextToSize(r.fotos[i + j].legenda || `Foto ${i + j + 1}`, w)[0] as string, x + w / 2, e.y + hImg + 5, { align: 'center' });
      }
      e.y += hCelula + 3;
    }
  }

  moldurasDePagina(doc, r, new Date().toLocaleString('pt-BR', { ...fuso, dateStyle: 'short', timeStyle: 'short' }));
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
