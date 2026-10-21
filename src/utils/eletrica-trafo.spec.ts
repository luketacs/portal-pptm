import { inflateSync } from 'zlib';
import { CriterioTrafo, EnsaioTrafo, LeituraIsolamentoTrafo, Transformador } from '../models/eletrica-trafo.model';
import {
  avaliarIsolamentoTrafo, avaliarOhmica, avaliarTrafo, avaliarTtr, circuitosIsolamento, fatorCorrecao20, fatorCorrecao75,
  irMinimoTrafoMohm, isolamentoVazio, ohmicaVazia, paresEnrolamento, paresTtr, relacaoCalculada, tensaoCircuito,
  tensaoEnsaioTrafo, tensoesTexto, ttrVazio,
} from './eletrica-trafo';
import { gerarPdfEnsaioTrafo, nomeArquivoPdfEnsaioTrafo } from './eletrica-trafo-pdf';

// TC-05 da planilha de exemplo: 13,8 kV Δ / 690 V (1X em Δ, 2X em Y), seco, 12 pulsos.
const tc05: CriterioTrafo = {
  tensaoPrimariaV: 13800, tapTensaoV: 13800, ligacaoPrimaria: 'D',
  secundarios: [{ nome: '1X', tensaoV: 690, ligacao: 'D' }, { nome: '2X', tensaoV: 690, ligacao: 'Y' }],
  meioIsolante: 'seco', materialEnrolamento: 'cobre', classeIsolamento: 'F',
};

const leitura = (o: Partial<LeituraIsolamentoTrafo>): LeituraIsolamentoTrafo =>
  ({ circuito: 'H-TE', tensaoV: 5000, r30s: null, r1min: null, r10min: null, foraEscala: false, ...o });

describe('NETA MTS — transformador', () => {
  it('monta os circuitos e pares na ordem da planilha', () => {
    expect(circuitosIsolamento(tc05.secundarios)).toEqual(['H-TE', 'H-1X', 'H-2X', '1X-TE', '2X-TE', '1X-2X']);
    expect(paresEnrolamento('H', 'D')).toEqual(['H1-H3', 'H2-H1', 'H3-H2']);
    expect(paresEnrolamento('2X', 'Y')).toEqual(['2X1-2X0', '2X2-2X0', '2X3-2X0']);
    expect(paresTtr('D', tc05.secundarios[1])).toEqual(['H1-H3 / 2X1-2X0', 'H2-H1 / 2X2-2X0', 'H3-H2 / 2X3-2X0']);
    expect(ohmicaVazia(tc05).map(o => o.enrolamento)).toEqual(['H', '1X', '2X']);
    expect(ttrVazio(tc05).map(t => t.secundario)).toEqual(['1X', '2X']);
  });

  it('tensão do circuito = a do enrolamento de maior tensão; mínimo e tensão de ensaio pela tabela 100.5', () => {
    expect(tensaoCircuito('H-1X', tc05)).toBe(13800);
    expect(tensaoCircuito('1X-2X', tc05)).toBe(690);
    expect(irMinimoTrafoMohm(13800, 'seco')).toBe(25000);
    expect(irMinimoTrafoMohm(690, 'seco')).toBe(5000);
    expect(irMinimoTrafoMohm(380, 'oleo')).toBe(100);
    expect(tensaoEnsaioTrafo(13800)).toBe(5000);
    expect(tensaoEnsaioTrafo(690)).toBe(2500);
    expect(isolamentoVazio(tc05).map(l => l.tensaoV)).toEqual([5000, 5000, 5000, 2500, 2500, 2500]);
  });

  it('corrige o isolamento a 20 °C (dobra a cada 10 °C acima)', () => {
    expect(fatorCorrecao20(20)).toBe(1);
    expect(fatorCorrecao20(30)).toBeCloseTo(2);
    expect(fatorCorrecao20(40)).toBeCloseTo(4);
  });

  it('planilha TC-05: H-TE aprova, H-1X reprova pelo IP 0,87', () => {
    const hte = avaliarIsolamentoTrafo(leitura({ r30s: 150000, r1min: 174000, r10min: 226000 }), tc05, 25);
    expect(hte.ip).toBeCloseTo(1.299, 3);
    expect(hte.situacao).toBe('aprovado');
    const h1x = avaliarIsolamentoTrafo(leitura({ circuito: 'H-1X', r30s: 145000, r1min: 179500, r10min: 157000 }), tc05, 25);
    expect(h1x.ip).toBeCloseTo(0.875, 3);
    expect(h1x.indiceSituacao).toBe('falha');
    expect(h1x.situacao).toBe('reprovado');
  });

  it('fundo de escala: índice não se aplica; sem 10 min vale o IA', () => {
    const escala = avaliarIsolamentoTrafo(leitura({ circuito: '1X-2X', tensaoV: 2500, r30s: 532000, r1min: 532000, r10min: 532000, foraEscala: true }), tc05, 25);
    expect(escala.indiceSituacao).toBe('na');
    expect(escala.situacao).toBe('aprovado');
    const soIa = avaliarIsolamentoTrafo(leitura({ r30s: 100000, r1min: 120000 }), tc05, 20);
    expect(soIa.indiceTipo).toBe('IA');
    expect(soIa.situacao).toBe('aprovado');
    const nada = avaliarIsolamentoTrafo(leitura({ r1min: 120000 }), tc05, 20);
    expect(nada.situacao).toBe('pendente');
  });

  it('reprova IR abaixo do mínimo e avisa tensão de ensaio baixa', () => {
    const a = avaliarIsolamentoTrafo(leitura({ tensaoV: 1000, r30s: 9000, r1min: 10000, r10min: 15000 }), tc05, 20);
    expect(a.ir).toBe('falha');
    expect(a.tensaoBaixa).toBe(true);
  });

  it('relação calculada do TTR: Δ/Δ = 20 e Δ/Y = 34,641 (como na planilha)', () => {
    expect(relacaoCalculada(13800, 'D', tc05.secundarios[0])).toBeCloseTo(20, 6);
    expect(relacaoCalculada(13800, 'D', tc05.secundarios[1])).toBeCloseTo(34.641, 3);
    expect(relacaoCalculada(13800, 'Y', { nome: 'X', tensaoV: 380, ligacao: 'Y' })).toBeCloseTo(36.316, 3);
  });

  it('TTR aprova até ±0,5% e reprova acima', () => {
    const ok = avaliarTtr({ secundario: '1X', pares: [{ par: 'a', medida: 20.05 }, { par: 'b', medida: 19.98 }, { par: 'c', medida: 20.09 }] }, tc05);
    expect(ok.maiorDesvioPct).toBeCloseTo(0.45, 2);
    expect(ok.situacao).toBe('aprovado');
    const ruim = avaliarTtr({ secundario: '2X', pares: [{ par: 'a', medida: 34.64 }, { par: 'b', medida: 34.9 }, { par: 'c', medida: 34.6 }] }, tc05);
    expect(ruim.situacao).toBe('reprovado');
  });

  it('resistência ôhmica: diferença entre fases até 2% e correção a 75 °C', () => {
    expect(fatorCorrecao75('cobre', 20)).toBeCloseTo(309.5 / 254.5, 6);
    const ok = avaliarOhmica({ enrolamento: 'H', pares: [{ par: 'a', valor: 1000 }, { par: 'b', valor: 1010 }, { par: 'c', valor: 1005 }] }, 'cobre', 20);
    expect(ok.desequilibrioPct).toBeCloseTo(0.995, 2);
    expect(ok.situacao).toBe('aprovado');
    const ruim = avaliarOhmica({ enrolamento: '1X', pares: [{ par: 'a', valor: 1.0 }, { par: 'b', valor: 1.05 }, { par: 'c', valor: 1.0 }] }, 'cobre', 20);
    expect(ruim.situacao).toBe('reprovado');
  });

  it('ensaio só com a parte feita; qualquer reprovação reprova; leitura faltando = incompleto', () => {
    const base = { criterio: tc05, temperaturaAmbienteC: 25, temperaturaEnrolamentoC: null, ohmica: [], ttr: [] };
    expect(avaliarTrafo({ ...base, isolamento: [leitura({ r30s: 150000, r1min: 174000, r10min: 226000 })] }).resultado).toBe('aprovado');
    expect(avaliarTrafo({ ...base, isolamento: [leitura({ r1min: 174000 })] }).resultado).toBeNull();
    expect(avaliarTrafo({ ...base, isolamento: [leitura({ r1min: 174000 }), leitura({ circuito: 'H-1X', r30s: 145000, r1min: 179500, r10min: 157000 })] }).resultado).toBe('reprovado');
    expect(avaliarTrafo({ ...base, isolamento: [] }).resultado).toBeNull();
  });

  it('texto das tensões', () => {
    expect(tensoesTexto(13800, 'D', tc05.secundarios)).toBe('13.800 / 690 V (Δ/Δ-Y)');
  });
});

const trafo: Transformador = {
  id: 't1', tag: 'TC-05', situacao: 'reserva', aplicacao: 'TC-06', descricao: 'Trafo do inversor 12 pulsos', localInstalacao: null, fabricante: 'WEG', modelo: null,
  numeroSerie: '1009625352', codigoProduto: '11464990', normaFabricacao: 'NBR 10295/88', potenciaKva: 2500,
  tensaoPrimariaV: 13800, ligacaoPrimaria: 'D', secundarios: tc05.secundarios, frequenciaHz: 60, relacaoTaps: '15,18 ~ 12,42 x 0,69',
  meioIsolante: 'seco', materialEnrolamento: 'cobre', classeIsolamento: 'F', elevacaoTemperaturaC: 105, refrigeracao: 'AN',
  grauProtecao: 'IP 00', classeAmbiental: 'E2-C1-F0', massaKg: 6000, observacoes: null, criadoPorNome: 'Lucas',
  createdAt: new Date(), updatedAt: new Date(),
};

const ensaio: EnsaioTrafo = {
  id: 'e1', numero: 12, equipamentoId: 't1', dataEnsaio: '2026-09-04', osNumero: '998877', instrumento: null,
  instrumentoModelo: 'Fluke 1550C', temperaturaAmbienteC: 28, temperaturaEnrolamentoC: 30, umidadePct: 70, criterio: tc05,
  isolamento: [
    leitura({ r30s: 150000, r1min: 174000, r10min: 226000 }),
    leitura({ circuito: 'H-1X', r30s: 145000, r1min: 179500, r10min: 157000 }),
    leitura({ circuito: '1X-2X', tensaoV: 2500, r30s: 532000, r1min: 532000, r10min: 532000, foraEscala: true }),
  ],
  ohmica: [{ enrolamento: 'H', pares: [{ par: 'H1-H3', valor: 1000 }, { par: 'H2-H1', valor: 1010 }, { par: 'H3-H2', valor: 1005 }] }],
  ttr: [{ secundario: '1X', pares: [{ par: 'H1-H3 / 1X1-1X3', medida: 20.05 }, { par: 'H2-H1 / 1X2-1X1', medida: 19.98 }, { par: 'H3-H2 / 1X3-1X2', medida: 20.02 }] }],
  resultado: 'reprovado', executantes: [{ nome: 'Fulano de Tal', matricula: '1234' }], observacoes: 'IP baixo entre H e 1X.', anexos: [],
  criadoPorId: 'u1', criadoPorNome: 'Lucas', createdAt: new Date(), updatedAt: new Date(),
};

describe('PDF do ensaio de transformador', () => {
  it('gera um PDF válido com as três partes', async () => {
    const blob = await gerarPdfEnsaioTrafo(ensaio, trafo);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const bruto = Buffer.from(bytes).toString('latin1');
    const texto = [...bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(m => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } })
      .join('\n');
    ['EN-012', 'TC-05', 'Reserva de', 'TC-06', 'armazenamento', 'Resistência de isolamento', 'Resistência ôhmica', 'TTR', 'NETA', 'REPROVADO', 'Fulano de Tal']
      .forEach(t => expect(texto).toContain(t));
    expect(texto).not.toContain('Ω');
  });

  it('nome do arquivo', () => {
    expect(nomeArquivoPdfEnsaioTrafo(ensaio, trafo)).toBe('EN-012_Ensaios_Transformador_TC_05_2026-09-04.pdf');
  });
});
