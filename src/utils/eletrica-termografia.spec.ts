import { inflateSync } from 'zlib';
import { EnsaioIsolamento, LeituraIsolamento } from '../models/eletrica-ensaio.model';
import { EnsaioTermografia, PontoTermografia } from '../models/eletrica-termografia.model';
import {
  avaliarPontos, piorPrioridade, pontosPadrao, prioridadeAmbiente, prioridadeSimilares, resultadoTermografia,
} from './eletrica-termografia';
import { compararMotor, ensaioAnterior, formatarVariacao } from './eletrica-comparacao';
import { abasEnsaiosEletricos } from './eletrica-ensaios-excel';
import { gerarPdfTermografia } from './eletrica-termografia-pdf';

const ponto = (o: Partial<PontoTermografia>): PontoTermografia =>
  ({ ponto: 'P', grupo: null, criterio: 'conexao', temperaturaC: null, limiteC: null, ...o });

describe('Termografia — NETA MTS 100.18', () => {
  it('faixas de prioridade contra o ambiente e entre similares', () => {
    expect([0.5, 1, 10, 11, 20, 21, 40, 41].map(prioridadeAmbiente)).toEqual([null, 4, 4, 3, 3, 2, 2, 1]);
    expect([0.5, 1, 3, 4, 15, 16].map(prioridadeSimilares)).toEqual([null, 4, 4, 3, 3, 1]);
  });

  it('conexões: a fase quente é comparada com as outras do grupo', () => {
    const av = avaliarPontos([
      ponto({ ponto: 'A', grupo: 'Conexões', temperaturaC: 35 }),
      ponto({ ponto: 'B', grupo: 'Conexões', temperaturaC: 36 }),
      ponto({ ponto: 'C', grupo: 'Conexões', temperaturaC: 55 }),
    ], 30);
    expect(av[0].prioridade).toBe(4); // 5 °C acima do ambiente
    expect(av[2].dTSimilares).toBe(20);
    expect(av[2].prioridade).toBe(1); // > 15 °C entre similares
    expect(av[2].motivo).toBe('ΔT entre similares');
    expect(resultadoTermografia(av)).toBe('reprovado');
  });

  it('bobina só entre similares (não usa o ambiente); mancal pelo limite do fabricante', () => {
    const av = avaliarPontos([
      ponto({ ponto: 'Bobina A', grupo: 'Bobinas', criterio: 'similares', temperaturaC: 95 }),
      ponto({ ponto: 'Bobina B', grupo: 'Bobinas', criterio: 'similares', temperaturaC: 96 }),
      ponto({ ponto: 'Mancal LA', criterio: 'limite', limiteC: 90, temperaturaC: 84 }),
      ponto({ ponto: 'Carcaça', criterio: 'registro', temperaturaC: 70 }),
    ], 30);
    expect(av[0].prioridade).toBeNull();
    expect(av[1].prioridade).toBe(4);
    expect(av[2].prioridade).toBe(3); // a menos de 10 °C do limite
    expect(av[3].prioridade).toBeNull();
    expect(resultadoTermografia(av)).toBe('aprovado');
    expect(piorPrioridade(av)).toBe(3);
    expect(avaliarPontos([ponto({ criterio: 'limite', limiteC: 90, temperaturaC: 95 })], 30)[0].prioridade).toBe(1);
  });

  it('fica incompleto sem temperatura ou sem o limite do mancal', () => {
    expect(resultadoTermografia(avaliarPontos([ponto({ temperaturaC: null })], 30))).toBeNull();
    expect(resultadoTermografia(avaliarPontos([ponto({ criterio: 'limite', temperaturaC: 60 })], 30))).toBeNull();
  });

  it('pontos sugeridos por tipo de equipamento', () => {
    expect(pontosPadrao('motor').map(p => p.criterio)).toEqual(['conexao', 'conexao', 'conexao', 'limite', 'limite', 'registro']);
    expect(pontosPadrao('transformador').filter(p => p.grupo === 'Bobinas').every(p => p.criterio === 'similares')).toBe(true);
  });
});

const leitura = (o: Partial<LeituraIsolamento> = {}): LeituraIsolamento =>
  ({ circuito: 'A', r30s: 900, r1min: 1000, r10min: 2500, foraEscala: false, ...o });
const ensaioMotor = (o: Partial<EnsaioIsolamento>): EnsaioIsolamento => ({
  id: 'x', numero: 1, equipamentoId: 'm1', dataEnsaio: '2026-01-10', osNumero: null, instrumento: null, instrumentoModelo: null,
  tensaoAplicadaV: 5000, temperaturaAmbienteC: 40, temperaturaEnrolamentoC: null, umidadePct: null, tensaoNominalV: 6300,
  classeIsolamento: 'F', tipoBobina: 'pre_formada', medicoes: [leitura()], resultado: 'aprovado', executantes: [], observacoes: null,
  anexos: [], criadoPorId: null, criadoPorNome: 'T', createdAt: new Date(), updatedAt: new Date(), ...o,
});

describe('Comparação com o ensaio anterior', () => {
  it('acha o anterior por data e número', () => {
    const a = ensaioMotor({ id: 'a', numero: 1, dataEnsaio: '2025-06-01' });
    const b = ensaioMotor({ id: 'b', numero: 5, dataEnsaio: '2026-01-10' });
    const c = ensaioMotor({ id: 'c', numero: 6, dataEnsaio: '2026-01-10' });
    expect(ensaioAnterior([a, b, c], c)?.id).toBe('b');
    expect(ensaioAnterior([a, b, c], b)?.id).toBe('a');
    expect(ensaioAnterior([a, b, c], a)).toBeNull();
  });

  it('avisa queda de 50% ou mais da IR corrigida', () => {
    const antes = ensaioMotor({ id: 'a', medicoes: [leitura({ r1min: 1000 })] });
    const agora = ensaioMotor({ id: 'b', medicoes: [leitura({ r1min: 400, r10min: 1000 })] });
    const itens = compararMotor(agora, antes);
    const ir = itens.find(i => i.grandeza.startsWith('IR'))!;
    expect(ir.variacaoPct).toBeCloseTo(-60);
    expect(ir.alerta).toContain('Queda de 60%');
    expect(compararMotor(ensaioMotor({ medicoes: [leitura({ r1min: 800, r10min: 2000 })] }), antes).find(i => i.grandeza.startsWith('IR'))!.alerta).toBeNull();
    expect(formatarVariacao(-60)).toBe('-60,0%');
  });
});

describe('Excel dos ensaios', () => {
  it('monta uma aba por assunto, uma linha por medição', () => {
    const abas = abasEnsaiosEletricos({
      motores: [], trafos: [], ensaiosMotor: [ensaioMotor({ medicoes: [leitura(), leitura({ circuito: 'B' })] })],
      ensaiosTrafo: [], termografias: [], movimentos: [],
    });
    expect(abas.map(a => a.nome)).toEqual(['Motores', 'Transformadores', 'Isolamento motores', 'Trafos - isolamento', 'Trafos - ohmica e TTR', 'Termografia', 'Situacao e trocas']);
    const iso = abas.find(a => a.nome === 'Isolamento motores')!;
    expect(iso.linhas.length).toBe(2);
    expect(iso.linhas[0].length).toBe(iso.colunas.length);
    expect(typeof iso.linhas[0][8]).toBe('number'); // 1 min vai como número
  });
});

describe('PDF da termografia', () => {
  it('gera um PDF válido com pontos e prioridade', async () => {
    const e: EnsaioTermografia = {
      id: 't', numero: 21, equipamentoId: 'm1', dataEnsaio: '2026-10-21', osNumero: '5555', instrumento: 'Câmera termográfica', instrumentoModelo: 'FLIR E8',
      temperaturaAmbienteC: 30, umidadePct: 60, condicoes: { cargaPct: 80, emissividade: 0.95, distanciaM: 1.5 },
      pontos: [ponto({ ponto: 'Conexão fase A', grupo: 'Conexões', temperaturaC: 35 }), ponto({ ponto: 'Conexão fase C', grupo: 'Conexões', temperaturaC: 55 })],
      resultado: 'reprovado', executantes: [{ nome: 'Fulano', matricula: '1' }], observacoes: null, anexos: [],
      criadoPorId: null, criadoPorNome: 'Lucas', createdAt: new Date(), updatedAt: new Date(),
    };
    const blob = await gerarPdfTermografia(e, { tag: '91ECA42AF001', tipo: 'motor', descricao: null, aplicacao: 'Bomba B', localInstalacao: 'TT24' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const bruto = Buffer.from(bytes).toString('latin1');
    const texto = [...bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(m => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } })
      .join('\n');
    ['EN-021', 'Inspe', 'Conexão fase C', 'imediatamente', '100.18', 'REPROVADO'].forEach(t => expect(texto).toContain(t));
  });
});
