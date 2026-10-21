import { EnsaioTrafo, Transformador } from '../models/eletrica-trafo.model';
import { CLASSE_LABEL, RESULTADO_LABEL, SITUACAO_LABEL, rotuloAplicacao, rotuloLocal, formatarIndice, formatarMohm, formatarNumero, numeroEnsaio } from './eletrica-ensaio';
import {
  INDICE_MINIMO, MATERIAL_LABEL, MEIO_LABEL, OHMICA_DESEQUILIBRIO_MAX_PCT, TTR_DESVIO_MAX_PCT, avaliarTrafo,
  circuitoTrafoLabel, fatorCorrecao20, formatarPct, formatarRelacao, temperaturaEnsaio, tensoesTexto,
} from './eletrica-trafo';
import { dataBr } from './eletrica-reparo';
import { Escritor, LARGURA, baixarBlob, cabecalhoFicha, carregarLogo, moldurasFicha, secaoAnexos, secaoComparacao } from './pdf-ficha';
import { compararTrafo, linhasComparacao } from './eletrica-comparacao';

// PDF do ensaio de transformador — o "check list de ensaios elétricos" da planilha do
// TC-05, na mesma ficha técnica do Reparo Externo e do ensaio de motor.

const TITULO_DOC = 'Ensaios Elétricos de Transformador';
const SITUACAO_TEXTO = { aprovado: 'Aprovado', reprovado: 'Reprovado', pendente: 'Incompleto' } as const;
const comUnidade = (v: number | null, unidade: string, casas = 1) => (v === null ? null : `${formatarNumero(v, casas)} ${unidade}`);

export async function gerarPdfEnsaioTrafo(e: EnsaioTrafo, t: Transformador, anterior: EnsaioTrafo | null = null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${numeroEnsaio(e.numero)} — ${TITULO_DOC} — ${t.tag}`, author: 'Diamante Geração de Energia' });

  const c = e.criterio;
  const av = avaliarTrafo(e);
  const temp = temperaturaEnsaio(e);

  const w = new Escritor(doc);
  w.y = cabecalhoFicha(doc, TITULO_DOC, `Nº ${numeroEnsaio(e.numero)} · Transformador ${t.tag}`, await carregarLogo());

  w.tabela([
    { rotulo: 'Data do ensaio', valor: dataBr(e.dataEnsaio) },
    { rotulo: 'OS', valor: e.osNumero },
    { rotulo: 'Resultado', valor: `${RESULTADO_LABEL[e.resultado].toUpperCase()} (ANSI/NETA MTS)` },
    { rotulo: 'Lançado por', valor: e.criadoPorNome },
  ], 2, 30);

  w.secao('1. Dados do transformador');
  w.tabela([
    { rotulo: 'TAG', valor: t.tag },
    { rotulo: 'Situação', valor: SITUACAO_LABEL[t.situacao] },
    { rotulo: rotuloAplicacao(t.situacao), valor: t.aplicacao, largo: true },
    { rotulo: rotuloLocal(t.situacao), valor: t.localInstalacao, largo: true },
    { rotulo: 'Descrição', valor: t.descricao, largo: true },
    { rotulo: 'Fabricante', valor: t.fabricante },
    { rotulo: 'Modelo', valor: t.modelo },
    { rotulo: 'Nº de série', valor: t.numeroSerie },
    { rotulo: 'Código do produto', valor: t.codigoProduto },
    { rotulo: 'Potência', valor: comUnidade(t.potenciaKva, 'kVA') },
    { rotulo: 'Frequência', valor: comUnidade(t.frequenciaHz, 'Hz') },
    { rotulo: 'Tensões / ligação', valor: tensoesTexto(c.tensaoPrimariaV, c.ligacaoPrimaria, c.secundarios), largo: true },
    { rotulo: 'Meio isolante', valor: MEIO_LABEL[c.meioIsolante] },
    { rotulo: 'Enrolamento', valor: MATERIAL_LABEL[c.materialEnrolamento] },
    { rotulo: 'Classe de temperatura', valor: CLASSE_LABEL[c.classeIsolamento] },
    { rotulo: 'Elevação média', valor: comUnidade(t.elevacaoTemperaturaC, '°C') },
    { rotulo: 'Refrigeração', valor: t.refrigeracao },
    { rotulo: 'Grau de proteção', valor: t.grauProtecao },
    { rotulo: 'Relação / taps', valor: t.relacaoTaps },
    { rotulo: 'Norma de fabricação', valor: t.normaFabricacao },
  ], 2, 36);

  w.secao('2. Condições do ensaio');
  w.tabela([
    { rotulo: 'Instrumentos', valor: [e.instrumento, e.instrumentoModelo].filter(Boolean).join(' · ') || null, largo: true },
    { rotulo: 'Temp. ambiente', valor: comUnidade(e.temperaturaAmbienteC, '°C') },
    { rotulo: 'Temp. enrolamento', valor: comUnidade(e.temperaturaEnrolamentoC, '°C') ?? 'Não medida (usada a ambiente)' },
    { rotulo: 'Umidade relativa', valor: comUnidade(e.umidadePct, '%', 0) },
    { rotulo: 'Tap no TTR', valor: comUnidade(c.tapTensaoV, 'V') },
    {
      rotulo: 'Executantes',
      valor: e.executantes.map(x => (x.matricula ? `${x.nome} (mat. ${x.matricula})` : x.nome)).join('; ') || 'Não informados',
      largo: true,
    },
  ], 2, 34);

  let secao = 3;
  if (e.isolamento.length) {
    w.secao(`${secao++}. Resistência de isolamento (MΩ)`);
    w.tabelaColunas(
      ['Circuito', 'V CC', '30 s', '1 min', '10 min', '1 min 20 °C', 'Mínimo', 'IA', 'IP', 'Situação'],
      [26, 14, 18, 18, 18, 22, 18, 13, 13, LARGURA - 160],
      e.isolamento.map((l, i) => {
        const a = av.isolamento[i];
        return [
          circuitoTrafoLabel(l.circuito) + (l.foraEscala ? ' *' : ''),
          l.tensaoV ? formatarNumero(l.tensaoV, 0) : '—',
          formatarMohm(l.r30s), formatarMohm(l.r1min), formatarMohm(l.r10min), formatarMohm(a.r1min20), formatarMohm(a.minimo),
          formatarIndice(a.ia), a.indiceSituacao === 'na' ? 'N/A' : formatarIndice(a.ip), SITUACAO_TEXTO[a.situacao],
        ];
      }),
      [false, true, true, true, true, true, true, true, true, true],
    );
    const notas = [
      `Correção a 20 °C a partir de ${formatarNumero(temp)} °C: fator ${formatarIndice(fatorCorrecao20(temp))}.`,
      ...(e.isolamento.some(l => l.foraEscala) ? ['* Fundo de escala do instrumento: valor real maior que o indicado; índice não se aplica.'] : []),
      ...(av.isolamento.some(a => a.tensaoBaixa) ? ['Há circuito ensaiado abaixo da tensão mínima da NETA (tabela 100.5).'] : []),
    ];
    notas.forEach(n => w.paragrafo(n));
  }

  if (e.ohmica.length) {
    w.secao(`${secao++}. Resistência ôhmica dos enrolamentos (mΩ)`);
    w.tabelaColunas(
      ['Enrolamento', 'Leituras', 'Média a 75 °C', 'Diferença', 'Situação'],
      [24, LARGURA - 104, 30, 24, 26],
      e.ohmica.map((o, i) => {
        const a = av.ohmica[i];
        return [
          o.enrolamento,
          o.pares.map(p => `${p.par}: ${p.valor === null ? '—' : formatarNumero(p.valor, 4)}`).join('   '),
          a.media75 === null ? '—' : formatarNumero(a.media75, 3),
          formatarPct(a.desequilibrioPct),
          SITUACAO_TEXTO[a.situacao],
        ];
      }),
      [true, false, true, true, true],
    );
  }

  if (e.ttr.length) {
    w.secao(`${secao++}. Relação de transformação (TTR)`);
    const linhas: string[][] = [];
    e.ttr.forEach((x, i) => {
      const a = av.ttr[i];
      x.pares.forEach((p, k) => linhas.push([
        `H/${x.secundario}`, p.par, p.medida === null ? '—' : formatarNumero(p.medida, 4), formatarRelacao(a.calculada),
        formatarPct(a.desvios[k], true), k === 0 ? SITUACAO_TEXTO[a.situacao] : '',
      ]));
    });
    w.tabelaColunas(['Enrolamentos', 'Par', 'Medida', 'Calculada', 'Desvio', 'Situação'], [26, LARGURA - 128, 26, 26, 24, 26], linhas,
      [true, false, true, true, true, true]);
  }

  w.secao(`${secao++}. Critério de avaliação — ANSI/NETA MTS`);
  w.tabela([
    { rotulo: 'Isolamento', valor: `1 min corrigida a 20 °C ≥ mínimo da tabela 100.5 (${MEIO_LABEL[c.meioIsolante].toLowerCase()}: pela tensão do enrolamento). IP — ou IA, sem a leitura de 10 min — ≥ ${formatarIndice(INDICE_MINIMO)}.`, largo: true },
    { rotulo: 'Resistência ôhmica', valor: `Diferença entre fases do mesmo enrolamento ≤ ${OHMICA_DESEQUILIBRIO_MAX_PCT}% (IEEE C57.152). Média corrigida a 75 °C para comparar com ensaios anteriores.`, largo: true },
    { rotulo: 'TTR', valor: `Desvio ≤ ±${formatarNumero(TTR_DESVIO_MAX_PCT, 1)}% da relação calculada pelo tap e pelas ligações.`, largo: true },
  ], 1, 36);

  secaoComparacao(
    w, anterior ? `${secao++}. Comparação com o ensaio anterior (${numeroEnsaio(anterior.numero)}, ${dataBr(anterior.dataEnsaio)})` : `${secao++}. Comparação com o ensaio anterior`,
    anterior ? linhasComparacao(compararTrafo(e, anterior)) : [],
    'Primeiro ensaio deste transformador no portal.',
  );

  if (e.observacoes) {
    w.secao(`${secao++}. Observações`);
    w.paragrafo(e.observacoes);
  }

  await secaoAnexos(w, `${secao}. Anexos`, e.anexos);

  moldurasFicha(doc, TITULO_DOC, `${numeroEnsaio(e.numero)} · ${t.tag}`, numeroEnsaio(e.numero));
  return doc.output('blob');
}

export function nomeArquivoPdfEnsaioTrafo(e: EnsaioTrafo, t: Transformador): string {
  const tag = t.tag.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `${numeroEnsaio(e.numero)}_Ensaios_Transformador_${tag}_${e.dataEnsaio}.pdf`;
}

export async function baixarPdfEnsaioTrafo(e: EnsaioTrafo, t: Transformador, anterior: EnsaioTrafo | null = null): Promise<void> {
  baixarBlob(await gerarPdfEnsaioTrafo(e, t, anterior), nomeArquivoPdfEnsaioTrafo(e, t));
}
