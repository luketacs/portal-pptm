import { EnsaioTermografia } from '../models/eletrica-termografia.model';
import { RESULTADO_LABEL, formatarNumero, numeroEnsaio } from './eletrica-ensaio';
import {
  CRITERIO_PONTO_LABEL, PRIORIDADE_ACAO, avaliarPontos, formatarTemp,
} from './eletrica-termografia';
import { dataBr } from './eletrica-reparo';
import { Escritor, LARGURA, baixarBlob, cabecalhoFicha, carregarLogo, moldurasFicha, secaoAnexos } from './pdf-ficha';

// PDF da termografia — mesma ficha técnica dos outros ensaios, com as imagens térmicas
// anexadas no fim.

const TITULO_DOC = 'Inspeção Termográfica';

export interface EquipamentoResumo {
  tag: string;
  tipo: 'motor' | 'transformador';
  descricao: string | null;
  aplicacao: string | null;
  localInstalacao: string | null;
}

export async function gerarPdfTermografia(e: EnsaioTermografia, eq: EquipamentoResumo): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${numeroEnsaio(e.numero)} — ${TITULO_DOC} — ${eq.tag}`, author: 'Diamante Geração de Energia' });
  const av = avaliarPontos(e.pontos, e.temperaturaAmbienteC);

  const w = new Escritor(doc);
  w.y = cabecalhoFicha(doc, TITULO_DOC, `Nº ${numeroEnsaio(e.numero)} · ${eq.tipo === 'motor' ? 'Motor' : 'Transformador'} ${eq.tag}`, await carregarLogo());

  w.tabela([
    { rotulo: 'Data', valor: dataBr(e.dataEnsaio) },
    { rotulo: 'OS', valor: e.osNumero },
    { rotulo: 'Resultado', valor: `${RESULTADO_LABEL[e.resultado].toUpperCase()} (ANSI/NETA MTS 100.18)` },
    { rotulo: 'Lançado por', valor: e.criadoPorNome },
  ], 2, 30);

  w.secao('1. Equipamento e condições');
  const c = e.condicoes;
  w.tabela([
    { rotulo: 'TAG', valor: eq.tag },
    { rotulo: 'Tipo', valor: eq.tipo === 'motor' ? 'Motor' : 'Transformador' },
    { rotulo: 'Descrição', valor: eq.descricao, largo: true },
    { rotulo: 'Aplicação', valor: eq.aplicacao },
    { rotulo: 'Local', valor: eq.localInstalacao },
    { rotulo: 'Câmera', valor: e.instrumentoModelo },
    { rotulo: 'Temp. ambiente', valor: `${formatarNumero(e.temperaturaAmbienteC)} °C` },
    { rotulo: 'Carga', valor: c.cargaPct !== null ? `${formatarNumero(c.cargaPct, 0)}% da nominal` : null },
    { rotulo: 'Emissividade', valor: c.emissividade !== null ? formatarNumero(c.emissividade, 2) : null },
    { rotulo: 'Distância', valor: c.distanciaM !== null ? `${formatarNumero(c.distanciaM)} m` : null },
    { rotulo: 'Umidade', valor: e.umidadePct !== null ? `${formatarNumero(e.umidadePct, 0)}%` : null },
    {
      rotulo: 'Executantes',
      valor: e.executantes.map(x => (x.matricula ? `${x.nome} (mat. ${x.matricula})` : x.nome)).join('; ') || 'Não informados',
      largo: true,
    },
  ], 2, 30);

  w.secao('2. Pontos inspecionados');
  w.tabelaColunas(
    ['Ponto', 'Grupo', 'Critério', 'Temp.', 'Dif. amb.', 'Dif. simil.', 'Prioridade / ação'],
    [44, 22, 30, 17, 17, 17, LARGURA - 147],
    e.pontos.map((p, i) => {
      const a = av[i];
      const criterio = p.criterio === 'limite' && p.limiteC !== null ? `Limite ${formatarNumero(p.limiteC, 0)} °C` : CRITERIO_PONTO_LABEL[p.criterio];
      return [
        p.ponto, p.grupo ?? '—', criterio, formatarTemp(p.temperaturaC), formatarTemp(a.dTAmbiente, true), formatarTemp(a.dTSimilares, true),
        a.prioridade ? `${a.prioridade} – ${PRIORIDADE_ACAO[a.prioridade]}` : (p.criterio === 'registro' ? 'Registrado' : 'Normal'),
      ];
    }),
    [false, false, false, true, true, true, false],
  );

  w.secao('3. Critério — ANSI/NETA MTS, tabela 100.18');
  w.tabela([
    { rotulo: 'Prioridade 1', valor: 'Diferença entre similares > 15 °C ou contra o ambiente > 40 °C — reparar imediatamente.', largo: true },
    { rotulo: 'Prioridade 2', valor: 'Diferença contra o ambiente de 21 a 40 °C — monitorar até corrigir.', largo: true },
    { rotulo: 'Prioridade 3', valor: 'Diferença entre similares de 4 a 15 °C ou contra o ambiente de 11 a 20 °C — reparar quando possível.', largo: true },
    { rotulo: 'Prioridade 4', valor: 'Diferença entre similares de 1 a 3 °C ou contra o ambiente de 1 a 10 °C — investigar.', largo: true },
    { rotulo: 'Outros pontos', valor: 'Mancal: limite do fabricante (acima = prioridade 1; até 10 °C abaixo = prioridade 3). Bobinas: só entre similares. Reprova com prioridade 1 ou 2.', largo: true },
  ], 1, 30);

  let secao = 4;
  if (e.observacoes) {
    w.secao(`${secao++}. Observações`);
    w.paragrafo(e.observacoes);
  }
  await secaoAnexos(w, `${secao}. Imagens térmicas e anexos`, e.anexos);

  moldurasFicha(doc, TITULO_DOC, `${numeroEnsaio(e.numero)} · ${eq.tag}`, numeroEnsaio(e.numero));
  return doc.output('blob');
}

export function nomeArquivoPdfTermografia(e: EnsaioTermografia, eq: EquipamentoResumo): string {
  const tag = eq.tag.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `${numeroEnsaio(e.numero)}_Termografia_${tag}_${e.dataEnsaio}.pdf`;
}

export async function baixarPdfTermografia(e: EnsaioTermografia, eq: EquipamentoResumo): Promise<void> {
  baixarBlob(await gerarPdfTermografia(e, eq), nomeArquivoPdfTermografia(e, eq));
}
