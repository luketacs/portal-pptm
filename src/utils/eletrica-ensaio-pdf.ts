import { EnsaioIsolamento, Motor } from '../models/eletrica-ensaio.model';
import {
  CLASSE_LABEL, IR_LIMITE_IP_MOHM, RESULTADO_LABEL, TIPO_BOBINA_CURTO, TIPO_BOBINA_LABEL, avaliarEnsaio, circuitoLabel, criterioDoEnsaio,
  fatorCorrecao40, formatarIndice, formatarMohm, formatarNumero, ipMinimo, irMinimoMohm, numeroEnsaio,
  potenciaTexto, temperaturaCorrecao, tensaoEnsaioAdequada, tensaoEnsaioRecomendada,
} from './eletrica-ensaio';
import { dataBr } from './eletrica-reparo';
import { Escritor, LARGURA, baixarBlob, cabecalhoFicha, carregarLogo, moldurasFicha } from './pdf-ficha';

// PDF do ensaio de resistência de isolamento — mesma ficha técnica do Reparo Externo.
// Substitui a planilha "ENSAIO DE MOTORES - MT" impressa. Gerado no navegador (jsPDF).

const TITULO_DOC = 'Ensaio de Resistência de Isolamento';

const SITUACAO_TEXTO = { aprovado: 'Aprovado', reprovado: 'Reprovado', pendente: 'Incompleto' } as const;

const comUnidade = (v: number | null, unidade: string, casas = 1) => (v === null ? null : `${formatarNumero(v, casas)} ${unidade}`);

export async function gerarPdfEnsaio(e: EnsaioIsolamento, m: Motor): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${numeroEnsaio(e.numero)} — ${TITULO_DOC} — ${m.tag}`, author: 'Diamante Geração de Energia' });

  const criterio = criterioDoEnsaio(e);
  const av = avaliarEnsaio(e.medicoes, criterio);
  const temp = temperaturaCorrecao(e);
  const rec = tensaoEnsaioRecomendada(e.tensaoNominalV);

  const w = new Escritor(doc);
  w.y = cabecalhoFicha(doc, TITULO_DOC, `Nº ${numeroEnsaio(e.numero)} · Motor ${m.tag}`, await carregarLogo());

  w.tabela([
    { rotulo: 'Data do ensaio', valor: dataBr(e.dataEnsaio) },
    { rotulo: 'OS', valor: e.osNumero },
    { rotulo: 'Resultado', valor: `${RESULTADO_LABEL[e.resultado].toUpperCase()} (IEEE 43-2013)` },
    { rotulo: 'Lançado por', valor: e.criadoPorNome },
  ], 2, 30);

  w.secao('1. Dados do motor');
  w.tabela([
    { rotulo: 'TAG', valor: m.tag },
    { rotulo: 'Local de instalação', valor: m.localInstalacao },
    { rotulo: 'Descrição', valor: m.descricao, largo: true },
    { rotulo: 'Fabricante', valor: m.fabricante },
    { rotulo: 'Modelo', valor: m.modelo },
    { rotulo: 'Nº de série', valor: m.numeroSerie },
    { rotulo: 'Potência', valor: potenciaTexto(m.potenciaKw, m.potenciaCv) },
    { rotulo: 'Tensão nominal', valor: comUnidade(e.tensaoNominalV, 'V') },
    { rotulo: 'Corrente', valor: comUnidade(m.correnteA, 'A', 2) },
    { rotulo: 'Frequência', valor: comUnidade(m.frequenciaHz, 'Hz') },
    { rotulo: 'Fator de serviço', valor: m.fatorServico !== null ? formatarNumero(m.fatorServico, 2) : null },
    { rotulo: 'Rotação', valor: comUnidade(m.rotacaoRpm, 'rpm', 0) },
    { rotulo: 'Classe de isolamento', valor: CLASSE_LABEL[e.classeIsolamento] },
    { rotulo: 'Tipo de bobina', valor: TIPO_BOBINA_LABEL[e.tipoBobina], largo: true },
  ], 2);

  w.secao('2. Condições do ensaio');
  const tensaoTexto = `${formatarNumero(e.tensaoAplicadaV, 0)} V CC`
    + (tensaoEnsaioAdequada(e.tensaoAplicadaV, e.tensaoNominalV) ? '' : ` (fora da faixa recomendada: ${rec.min === rec.max ? `${rec.min} V` : `${rec.min}–${rec.max} V`})`);
  w.tabela([
    { rotulo: 'Instrumento', valor: e.instrumento },
    { rotulo: 'Marca / Modelo', valor: e.instrumentoModelo },
    { rotulo: 'Tensão aplicada', valor: tensaoTexto, largo: true },
    { rotulo: 'Temp. ambiente', valor: comUnidade(e.temperaturaAmbienteC, '°C') },
    { rotulo: 'Temp. enrolamento', valor: comUnidade(e.temperaturaEnrolamentoC, '°C') ?? 'Não medida (usada a ambiente)' },
    { rotulo: 'Umidade relativa', valor: comUnidade(e.umidadePct, '%', 0) },
    { rotulo: 'Correção a 40 °C', valor: `${formatarNumero(temp)} °C → Kt = ${formatarIndice(fatorCorrecao40(temp))}` },
    {
      rotulo: 'Executantes',
      valor: e.executantes.map(x => (x.matricula ? `${x.nome} (mat. ${x.matricula})` : x.nome)).join('; ') || 'Não informados',
      largo: true,
    },
  ], 2, 34);

  w.secao('3. Resistência de isolamento (MΩ)');
  w.tabelaColunas(
    ['Circuito', '30 s', '1 min', '10 min', '1 min a 40 °C', 'IA', 'IP', 'Situação'],
    [36, 18, 18, 18, 26, 16, 18, LARGURA - 150],
    e.medicoes.map((l, i) => {
      const a = av.circuitos[i];
      const ip = a.ipSituacao === 'na' ? 'N/A' : formatarIndice(a.ip);
      return [
        circuitoLabel(l.circuito) + (l.foraEscala ? ' *' : ''),
        formatarMohm(l.r30s), formatarMohm(l.r1min), formatarMohm(l.r10min),
        formatarMohm(a.r1min40), formatarIndice(a.ia), ip, SITUACAO_TEXTO[a.situacao],
      ];
    }),
    [false, true, true, true, true, true, true, true],
  );
  const notas = [
    ...(e.medicoes.some(l => l.foraEscala) ? ['* Leitura em fundo de escala do instrumento: valor real maior que o indicado; IP não se aplica.'] : []),
    ...av.circuitos.filter(a => a.ipMotivoNa && !a.ipMotivoNa.includes('escala'))
      .map(a => `${circuitoLabel(a.circuito)}: IP não se aplica (${a.ipMotivoNa}).`),
  ];
  notas.forEach(n => w.paragrafo(n));

  w.secao('4. Critério de avaliação — IEEE 43-2013');
  const regraIr = e.tipoBobina === 'antiga' ? 'kV + 1, fabricado antes de 1970' : `bobina ${TIPO_BOBINA_CURTO[e.tipoBobina].toLowerCase()}`;
  w.tabela([
    { rotulo: 'IR 1 min a 40 °C', valor: `≥ ${formatarMohm(irMinimoMohm(e.tipoBobina, e.tensaoNominalV))} MΩ — ${regraIr} (tabela 3). Correção: R40 = R(T) × 0,5^((40 − T)/10).`, largo: true },
    { rotulo: 'Índice de polarização', valor: `≥ ${formatarIndice(ipMinimo(e.classeIsolamento))} para classe ${e.classeIsolamento} (tabela 4); não se aplica se IR 1 min a 40 °C > ${IR_LIMITE_IP_MOHM.toLocaleString('pt-BR')} MΩ. IA (R1min / R30s) é só informativo.`, largo: true },
  ], 1, 44);

  if (e.observacoes) {
    w.secao('5. Observações');
    w.paragrafo(e.observacoes);
  }

  moldurasFicha(doc, TITULO_DOC, `${numeroEnsaio(e.numero)} · ${m.tag}`, numeroEnsaio(e.numero));
  return doc.output('blob');
}

export function nomeArquivoPdfEnsaio(e: EnsaioIsolamento, m: Motor): string {
  const tag = m.tag.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `${numeroEnsaio(e.numero)}_Ensaio_Isolamento_${tag}_${e.dataEnsaio}.pdf`;
}

export async function baixarPdfEnsaio(e: EnsaioIsolamento, m: Motor): Promise<void> {
  baixarBlob(await gerarPdfEnsaio(e, m), nomeArquivoPdfEnsaio(e, m));
}
