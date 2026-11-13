import { AnaliseVibracao, EquipamentoVibracao, FatoresRolamento, Situacao } from '../models/mecanica-vibracao.model';
import {
  ALARME_LABEL, FUNDACAO_LABEL, GRUPO_ISO_LABEL, LIMITES_ISO, SITUACAO_DESCRICAO, SITUACAO_LABEL, SITUACOES, TIPO_INSPECAO_LABEL,
  alarmeDaLeitura, alteracaoPct, avisoTendencia, formatarPct, formatarValor, identificarFrequencia, numeroAnalise, zonaDaLeitura,
} from './mecanica-vibracao';
import { formatarNumero } from './eletrica-ensaio';
import { dataBr } from './eletrica-reparo';
import {
  Escritor, LARGURA, LINHA_TABELA, MARGEM, baixarBlob, cabecalhoFicha, carregarImagem, carregarLogo, imagemContida, moldurasFicha,
  secaoAnexos,
} from './pdf-ficha';

// Relatório de uma análise de vibração, na estrutura do relatório em Word que a equipe
// fazia (Objetivo, Escopo, Equipamento de coleta, Norma, Desenho, Valores globais,
// Tendência, Diagnóstico, Recomendações, Conclusão), no visual de ficha técnica do portal.

const TITULO_DOC = 'Relatório de Análise de Vibração';

export interface ContextoPdfVibracao {
  // Último valor de cada ponto antes desta coleta (pontoId → valor).
  anteriores?: Map<string, number>;
  // Fatores de rolamento por ponto (pra identificar a frequência achada).
  fatores?: Map<string, FatoresRolamento>;
  // Análises anteriores do equipamento (qualquer ordem).
  historico?: { numero: number; dataColeta: string; situacao: Situacao }[];
}

export async function gerarPdfVibracao(a: AnaliseVibracao, eq: EquipamentoVibracao, ctx: ContextoPdfVibracao = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const numero = numeroAnalise(a.numero);
  doc.setProperties({ title: `${numero} — ${TITULO_DOC} — ${eq.tag}`, author: 'Diamante Geração de Energia' });

  const w = new Escritor(doc);
  w.y = cabecalhoFicha(doc, TITULO_DOC, `Nº ${numero} · KKS ${eq.tag}`, await carregarLogo());

  w.tabela([
    { rotulo: 'KKS', valor: eq.tag },
    { rotulo: 'Data da medição', valor: dataBr(a.dataColeta) },
    { rotulo: 'Descrição', valor: eq.descricao, largo: true },
    { rotulo: 'Área', valor: eq.area },
    { rotulo: 'OS', valor: a.osNumero },
    { rotulo: 'Status', valor: SITUACAO_LABEL[a.situacao].toUpperCase() },
    { rotulo: 'Tipo', valor: TIPO_INSPECAO_LABEL[a.tipoInspecao] },
    { rotulo: 'Executante', valor: a.criadoPorNome },
    { rotulo: 'Gestor da área', valor: a.gestorArea },
  ], 2, 30);

  w.secao('1. Objetivo');
  w.paragrafo(`Apresentar e analisar os dados obtidos na coleta de vibração do conjunto ${eq.tag}${eq.descricao ? ` (${eq.descricao})` : ''}, `
    + 'comparando os valores medidos com os parâmetros de referência e os critérios normativos aplicáveis, para identificar desvios de '
    + 'comportamento, avaliar a condição mecânica do equipamento e subsidiar a decisão sobre intervenções de manutenção.');

  w.secao('2. Equipamento de coleta');
  w.tabela([
    { rotulo: 'Coletor', valor: a.instrumento },
    { rotulo: 'Nº de série', valor: a.instrumentoSerie },
    { rotulo: 'Sensor', valor: a.sensor },
    { rotulo: 'Validade da calibração', valor: a.calibracaoValidade ? dataBr(a.calibracaoValidade) : null },
    { rotulo: 'Rotação na coleta', valor: a.rotacaoRpm !== null ? `${formatarNumero(a.rotacaoRpm, 1)} rpm` : null },
    { rotulo: 'Condição de operação', valor: a.condicaoOperacao },
  ], 2, 34);

  w.secao('3. Norma ISO 20816-3');
  const limites = eq.grupoIso && eq.fundacao ? LIMITES_ISO[eq.grupoIso][eq.fundacao] : null;
  w.tabela([
    {
      rotulo: 'Equipamento',
      valor: eq.grupoIso && eq.fundacao
        ? `${GRUPO_ISO_LABEL[eq.grupoIso]}, fundação ${FUNDACAO_LABEL[eq.fundacao].toLowerCase()}. Limites em velocidade (mm/s RMS): `
          + `A até ${formatarNumero(limites![0])}, B até ${formatarNumero(limites![1])}, C até ${formatarNumero(limites![2])}; acima, D.`
        : 'Grupo e fundação não informados no cadastro.',
      largo: true,
    },
    ...SITUACOES.map(s => ({ rotulo: SITUACAO_LABEL[s], valor: SITUACAO_DESCRICAO[s], largo: true })),
  ], 1, 34);

  let secao = 4;
  if (eq.desenhoUrl) {
    const img = await carregarImagem(eq.desenhoUrl, { maxLado: 1600 });
    if (img) {
      w.secao(`${secao++}. Desenho / pontos de coleta`);
      const h = Math.min(80, LARGURA * (img.altura / img.largura));
      w.garantirEspaco(h + 4);
      doc.setDrawColor(...LINHA_TABELA).setLineWidth(0.2).rect(MARGEM, w.y, LARGURA, h + 3, 'S');
      imagemContida(doc, img, MARGEM + 1.5, w.y + 1.5, LARGURA - 3, h);
      w.y += h + 6;
    }
  }

  w.secao(`${secao++}. Valores globais do conjunto`);
  const avisos: string[] = [];
  w.tabelaColunas(
    ['Ponto', 'Unidade', 'Último valor', 'Valor anterior', '% alteração', 'Alarme SKF', 'Zona ISO'],
    [38, 18, 22, 24, 22, 28, LARGURA - 152],
    a.leituras.map(l => {
      const anterior = l.pontoId ? ctx.anteriores?.get(l.pontoId) ?? null : null;
      const alarme = alarmeDaLeitura(l);
      const zona = zonaDaLeitura(l, eq.grupoIso, eq.fundacao);
      const tend = avisoTendencia(l.valor, anterior, l.grandeza);
      if (tend) avisos.push(`${l.ponto}: ${tend}`);
      return [
        l.ponto, l.unidade, formatarValor(l.valor), formatarValor(anterior), formatarPct(alteracaoPct(l.valor, anterior)),
        alarme ? ALARME_LABEL[alarme] : '---', zona ?? '—',
      ];
    }),
    [false, true, true, true, true, true, true],
  );

  const detalhadas = a.leituras.filter(l => l.fatorCrista !== null || l.curtose !== null || l.frequenciaHz !== null || l.observacao);
  if (detalhadas.length) {
    w.secao(`${secao++}. Forma de onda e espectro`);
    w.tabelaColunas(
      ['Ponto', 'Fator de crista', 'Curtose', 'Frequência', 'Identificação', 'Observação'],
      [38, 22, 18, 22, 36, LARGURA - 136],
      detalhadas.map(l => {
        const fatores = l.pontoId ? ctx.fatores?.get(l.pontoId) : undefined;
        const ident = fatores ? identificarFrequencia(l.frequenciaHz, a.rotacaoRpm, fatores)[0] : undefined;
        return [
          l.ponto, formatarValor(l.fatorCrista), formatarValor(l.curtose),
          l.frequenciaHz !== null ? `${formatarNumero(l.frequenciaHz, 2)} Hz` : '—',
          ident ? `${ident.rotulo} – ${ident.nome}` : '—', l.observacao ?? '—',
        ];
      }),
      [false, true, true, true, false, false],
    );
  }

  w.secao(`${secao++}. Tendência`);
  const historico = [...(ctx.historico ?? []).filter(h => h.numero !== a.numero), { numero: a.numero, dataColeta: a.dataColeta, situacao: a.situacao }]
    .sort((x, y) => (x.dataColeta < y.dataColeta ? -1 : x.dataColeta > y.dataColeta ? 1 : x.numero - y.numero))
    .slice(-8);
  w.tabelaColunas(
    ['Análise', 'Data', 'Status'],
    [40, 40, LARGURA - 80],
    historico.map(h => [numeroAnalise(h.numero), dataBr(h.dataColeta), SITUACAO_LABEL[h.situacao]]),
    [false, true, false],
  );
  if (avisos.length) avisos.forEach(t => w.paragrafo(`Atenção – ${t}`));

  w.secao(`${secao++}. Diagnóstico`);
  w.tabela([
    { rotulo: 'Modos de falha', valor: a.modosFalha.join('; ') || 'Nenhum identificado', largo: true },
    { rotulo: 'Análise', valor: a.diagnostico, largo: true },
  ], 1, 34);

  w.secao(`${secao++}. Recomendações`);
  w.tabela([
    { rotulo: 'Recomendação', valor: a.recomendacao, largo: true },
    { rotulo: 'Prazo', valor: a.prazo ? dataBr(a.prazo) : null, largo: true },
  ], 1, 34);

  w.secao(`${secao++}. Conclusão`);
  w.tabela([{ rotulo: 'Status', valor: `${SITUACAO_LABEL[a.situacao]} – ${SITUACAO_DESCRICAO[a.situacao]}`, largo: true }], 1, 34);
  if (a.conclusao) w.paragrafo(a.conclusao);

  if (a.observacoes) {
    w.secao(`${secao++}. Observações`);
    w.paragrafo(a.observacoes);
  }
  await secaoAnexos(w, `${secao}. Espectros e anexos`, a.anexos);

  moldurasFicha(doc, TITULO_DOC, `${numero} · ${eq.tag}`, numero);
  return doc.output('blob');
}

export function nomeArquivoPdfVibracao(a: AnaliseVibracao, eq: EquipamentoVibracao): string {
  const tag = eq.tag.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `${numeroAnalise(a.numero)}_Vibracao_${tag}_${a.dataColeta}.pdf`;
}

export async function baixarPdfVibracao(a: AnaliseVibracao, eq: EquipamentoVibracao, ctx: ContextoPdfVibracao = {}): Promise<void> {
  baixarBlob(await gerarPdfVibracao(a, eq, ctx), nomeArquivoPdfVibracao(a, eq));
}
