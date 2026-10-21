import { inflateSync } from 'zlib';
import { EnsaioIsolamento, LeituraIsolamento, Motor } from '../models/eletrica-ensaio.model';
import {
  avaliarCircuito, avaliarEnsaio, fatorCorrecao40, ipMinimo, irMinimoMohm, lerNumero, numeroEnsaio,
  tensaoEnsaioAdequada, tensaoEnsaioRecomendada, tipoBobinaSugerido,
} from './eletrica-ensaio';
import { gerarPdfEnsaio, nomeArquivoPdfEnsaio } from './eletrica-ensaio-pdf';
import { textoPdf } from './pdf-ficha';

const leitura = (o: Partial<LeituraIsolamento> = {}): LeituraIsolamento =>
  ({ circuito: 'A', r30s: 925, r1min: 975, r10min: 1009, foraEscala: false, ...o });

// Motor MT da planilha de exemplo (91ECA42AF001): 6300 V, classe F, bobina pré-formada.
const mt = { tensaoNominalV: 6300, classeIsolamento: 'F' as const, tipoBobina: 'pre_formada' as const };

describe('IEEE 43-2013', () => {
  it('formata o número do ensaio como EN-007', () => {
    expect(numeroEnsaio(7)).toBe('EN-007');
    expect(numeroEnsaio(null)).toBe('');
  });

  it('corrige a 40 °C: a resistência dobra a cada 10 °C abaixo de 40', () => {
    expect(fatorCorrecao40(40)).toBe(1);
    expect(fatorCorrecao40(30)).toBeCloseTo(0.5);
    expect(fatorCorrecao40(20)).toBeCloseTo(0.25);
    expect(fatorCorrecao40(50)).toBeCloseTo(2);
  });

  it('mínimo de IR pela tabela 3 e de IP pela tabela 4', () => {
    expect(irMinimoMohm('pre_formada', 6300)).toBe(100);
    expect(irMinimoMohm('randomica', 440)).toBe(5);
    expect(irMinimoMohm('antiga', 6300)).toBeCloseTo(7.3);
    expect(ipMinimo('A')).toBe(1.5);
    expect(ipMinimo('F')).toBe(2);
  });

  it('tensão de ensaio pela tabela 1', () => {
    expect(tensaoEnsaioRecomendada(440)).toEqual({ min: 500, max: 500 });
    expect(tensaoEnsaioRecomendada(4160)).toEqual({ min: 1000, max: 2500 });
    expect(tensaoEnsaioRecomendada(6300)).toEqual({ min: 2500, max: 5000 });
    expect(tensaoEnsaioAdequada(5000, 6300)).toBe(true);
    expect(tensaoEnsaioAdequada(1000, 6300)).toBe(false);
    expect(tipoBobinaSugerido(6300)).toBe('pre_formada');
    expect(tipoBobinaSugerido(380)).toBe('randomica');
  });

  it('motor da planilha de exemplo: IR alta mas IP 1,03 reprova (umidade/sujeira)', () => {
    const a = avaliarCircuito(leitura(), { ...mt, temperaturaC: 30 });
    expect(a.r1min40).toBeCloseTo(487.5);
    expect(a.ir).toBe('ok');
    expect(a.ip).toBeCloseTo(1.035, 3);
    expect(a.ipSituacao).toBe('falha');
    expect(a.situacao).toBe('reprovado');
  });

  it('aprova quando IR e IP atendem', () => {
    const a = avaliarCircuito(leitura({ r1min: 500, r10min: 1250 }), { ...mt, temperaturaC: 40 });
    expect(a.ip).toBeCloseTo(2.5);
    expect(a.situacao).toBe('aprovado');
  });

  it('reprova por IR abaixo do mínimo depois da correção', () => {
    // 180 MΩ a 30 °C = 90 MΩ a 40 °C < 100
    const a = avaliarCircuito(leitura({ r1min: 180, r10min: 500 }), { ...mt, temperaturaC: 30 });
    expect(a.ir).toBe('falha');
    expect(a.situacao).toBe('reprovado');
  });

  it('IP não se aplica acima de 5000 MΩ ou em fundo de escala — e aí o 10 min é dispensável', () => {
    const alto = avaliarCircuito(leitura({ r1min: 12000, r10min: null }), { ...mt, temperaturaC: 40 });
    expect(alto.ipSituacao).toBe('na');
    expect(alto.situacao).toBe('aprovado');
    const escala = avaliarCircuito(leitura({ r1min: 532000, r10min: 532000, foraEscala: true }), { ...mt, temperaturaC: 25 });
    expect(escala.ipSituacao).toBe('na');
    expect(escala.situacao).toBe('aprovado');
  });

  it('sem a leitura de 10 min (quando ela vale) o ensaio fica pendente', () => {
    const av = avaliarEnsaio([leitura({ r10min: null }), leitura({ circuito: 'B', r1min: 800, r10min: 2000 })], { ...mt, temperaturaC: 40 });
    expect(av.circuitos[0].situacao).toBe('pendente');
    expect(av.resultado).toBeNull();
    expect(av.menorR1min40).toBe(800);
  });

  it('um circuito reprovado reprova o ensaio, mesmo com outro pendente', () => {
    const av = avaliarEnsaio([leitura({ r1min: 10, r10min: 30 }), leitura({ circuito: 'B', r1min: null })], { ...mt, temperaturaC: 40 });
    expect(av.resultado).toBe('reprovado');
  });

  it('lê número do jeito que o pessoal digita', () => {
    expect(lerNumero('975')).toBe(975);
    expect(lerNumero('1.250')).toBe(1250);
    expect(lerNumero('1.250,5')).toBe(1250.5);
    expect(lerNumero('25,7')).toBe(25.7);
    expect(lerNumero('25.7')).toBe(25.7);
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
  });
});

const motor: Motor = {
  id: 'm1', tag: '91ECA42AF001', situacao: 'instalado', aplicacao: 'Bomba de água de alimentação B', descricao: 'Motor da bomba', localInstalacao: 'TT24', fabricante: 'WEG',
  modelo: 'HGF 315 C/D/E', numeroSerie: null, potenciaKw: 220, potenciaCv: 300, tensaoV: 6300, correnteA: 25.7,
  frequenciaHz: 60, fatorServico: 1, rotacaoRpm: 1781, classeIsolamento: 'F', tipoBobina: 'pre_formada',
  observacoes: null, criadoPorNome: 'Lucas', createdAt: new Date(), updatedAt: new Date(),
};

const ensaio: EnsaioIsolamento = {
  id: 'e1', numero: 3, equipamentoId: 'm1', dataEnsaio: '2026-10-21', osNumero: '123456', instrumento: 'Megôhmetro digital',
  instrumentoModelo: 'Fluke 1550C', tensaoAplicadaV: 5000, temperaturaAmbienteC: 30, temperaturaEnrolamentoC: null, umidadePct: 75,
  ...mt,
  medicoes: [leitura(), leitura({ circuito: 'B', r30s: 782, r1min: 803, r10min: 841 }), leitura({ circuito: 'C', foraEscala: true })],
  resultado: 'reprovado', executantes: [{ nome: 'Fulano de Tal', matricula: '1234' }], observacoes: 'Enrolamento úmido.', anexos: [],
  criadoPorId: 'u1', criadoPorNome: 'Lucas', createdAt: new Date(), updatedAt: new Date(),
};

describe('PDF do ensaio', () => {
  it('troca símbolos que a fonte do PDF não tem', () => {
    expect(textoPdf('≥ 100 MΩ → ok')).toBe('>= 100 MOhm -> ok');
    expect(textoPdf('13.800 V (Δ/Δ-Y)')).toBe('13.800 V (D/D-Y)');
  });

  it('gera um PDF válido com as seções do ensaio', async () => {
    const blob = await gerarPdfEnsaio(ensaio, motor);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const bruto = Buffer.from(bytes).toString('latin1');
    const texto = [...bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(m => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } })
      .join('\n');
    ['EN-003', '91ECA42AF001', 'Bomba de água de alimentação B', 'Instalado', 'Dados do motor', 'IEEE 43-2013', 'Fase A', 'Fulano de Tal', 'REPROVADO', 'fundo de escala']
      .forEach(t => expect(texto).toContain(t));
    expect(texto).not.toContain('Ω');
  });

  it('nome do arquivo leva número, TAG e data', () => {
    expect(nomeArquivoPdfEnsaio(ensaio, motor)).toBe('EN-003_Ensaio_Isolamento_91ECA42AF001_2026-10-21.pdf');
  });
});
