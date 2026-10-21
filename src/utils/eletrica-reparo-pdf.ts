import type { jsPDF } from 'jspdf';
import { ReparoExterno } from '../models/eletrica-reparo.model';
import {
  REPARO_ENDERECO, REPARO_GARANTIA_LABEL, REPARO_VERIFICACOES_PADRAO, dataBr, numeroReparo,
} from './eletrica-reparo';
import {
  Escritor, Imagem, LARGURA, LINHA_TABELA, MARGEM, ROTULO, SUAVE, baixarBlob, cabecalhoFicha, carregarImagem, carregarLogo,
  imagemContida, moldurasFicha,
} from './pdf-ficha';

// PDF do "Relatório de Falha para Reparo Externo": mesmas 8 seções do Word que a Elétrica
// usava, no formato de ficha técnica (tabelas com linhas finas, rótulo à esquerda), com o
// logo da Diamante — é o documento que vai pro fornecedor.
// Gerado no navegador (jsPDF, carregado só quando alguém baixa) — sem function na Vercel.

function cabecalho(doc: jsPDF, r: ReparoExterno, logo: Imagem | null): number {
  return cabecalhoFicha(doc, 'Relatório de Falha para Reparo Externo', `Nº ${numeroReparo(r.numero)}`, logo);
}

function moldurasDePagina(doc: jsPDF, r: ReparoExterno): void {
  moldurasFicha(doc, 'Relatório de Falha para Reparo Externo', `${numeroReparo(r.numero)} · ${r.equipamento}`, numeroReparo(r.numero));
}

export async function gerarPdfReparo(r: ReparoExterno): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${numeroReparo(r.numero)} — Relatório de Falha para Reparo Externo`, author: 'Diamante Geração de Energia' });

  const [logo, ...fotos] = await Promise.all([
    carregarLogo(),
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
  baixarBlob(await gerarPdfReparo(r), nomeArquivoPdf(r));
}
