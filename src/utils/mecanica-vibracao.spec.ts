import { inflateSync } from 'zlib';
import { AnaliseVibracao, EquipamentoVibracao, LeituraVibracao } from '../models/mecanica-vibracao.model';
import {
  alarmeLeitura, alteracaoPct, avisoTendencia, frequenciasDefeito, grandezaDoNome, identificarFrequencia, numeroAnalise,
  piorSituacao, statusSugerido, zonaDaLeitura, zonaIso,
} from './mecanica-vibracao';
import { gerarPdfVibracao } from './mecanica-vibracao-pdf';

const leitura = (o: Partial<LeituraVibracao>): LeituraVibracao => ({
  pontoId: 'p1', ponto: 'MG02 \\ RD 3HE', grandeza: 'envelope', unidade: 'gE', valor: null,
  alarmeAlerta: 4.5, alarmePerigo: 7.1, fatorCrista: null, curtose: null, frequenciaHz: null, observacao: null, ...o,
});
const vel = (ponto: string, valor: number) =>
  leitura({ pontoId: ponto, ponto, grandeza: 'velocidade', unidade: 'mm/s', valor, alarmeAlerta: null, alarmePerigo: null });

describe('Vibração — alarmes do SKF', () => {
  it('compara o valor com alerta e perigo do ponto (no limite já conta)', () => {
    expect(alarmeLeitura(3.309, 4.5, 7.1)).toBe('normal');
    expect(alarmeLeitura(4.5, 4.5, 7.1)).toBe('alerta');
    expect(alarmeLeitura(7.1, 4.5, 7.1)).toBe('perigo');
    expect(alarmeLeitura(9, null, 7.1)).toBe('perigo');
    expect(alarmeLeitura(5, 4.5, null)).toBe('alerta');
  });

  it('sem valor ou sem alarme cadastrado não avalia (no SKF aparece "---")', () => {
    expect(alarmeLeitura(null, 4.5, 7.1)).toBeNull();
    expect(alarmeLeitura(3, null, null)).toBeNull();
  });
});

describe('Vibração — ISO 20816-3 (status A/B/C/D)', () => {
  it('zonas por grupo e fundação (gráfico de severidade da equipe)', () => {
    expect([1.4, 1.5, 2.8, 2.9, 4.5, 4.6].map(v => zonaIso(v, '2', 'rigida'))).toEqual(['A', 'B', 'B', 'C', 'C', 'D']);
    expect([2.3, 4.5, 7.1, 7.2].map(v => zonaIso(v, '2', 'flexivel'))).toEqual(['A', 'B', 'C', 'D']);
    expect([2.3, 4.5, 7.1, 7.2].map(v => zonaIso(v, '1', 'rigida'))).toEqual(['A', 'B', 'C', 'D']);
    expect([3.5, 7.1, 11, 11.1].map(v => zonaIso(v, '1', 'flexivel'))).toEqual(['A', 'B', 'C', 'D']);
    expect([2.3, 4.5, 7.1, 7.2].map(v => zonaIso(v, '3', 'rigida'))).toEqual(['A', 'B', 'C', 'D']);
    expect([1.4, 2.8, 4.5, 4.6].map(v => zonaIso(v, '4', 'rigida'))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('só pontos de velocidade em mm/s com grupo e fundação cadastrados', () => {
    expect(zonaDaLeitura(vel('ME 01HV', 3.5), '2', 'rigida')).toBe('C');
    expect(zonaDaLeitura(leitura({ valor: 9 }), '2', 'rigida')).toBeNull(); // envelope: norma não cobre
    expect(zonaDaLeitura(vel('ME 01HV', 5), null, 'rigida')).toBeNull();
    expect(zonaDaLeitura(vel('ME 01HV', 5), '2', null)).toBeNull();
  });

  it('pior situação', () => {
    expect(piorSituacao([null, 'A', 'C', 'B'])).toBe('C');
    expect(piorSituacao([null])).toBeNull();
  });

  it('relatório real 10PAC12AP001 (07/07/2026, status A): bomba grupo 3 rígida dá A', () => {
    const leituras = [
      vel('ME 01HV', 1.412), vel('ME 01VV', 0.945), vel('ME 02HV', 0.769), vel('ME 02VV', 0.638), vel('ME 02AV', 0.979),
      vel('BC 03HV', 0.818), vel('BC 03VV', 0.933), vel('BC 03AV', 1.991),
      leitura({ ponto: 'BC 03HE03', valor: 1.808, alarmeAlerta: null, alarmePerigo: null }),
    ];
    expect(statusSugerido(leituras, '3', 'rigida')).toEqual({ situacao: 'A', motivo: expect.stringContaining('ME 01HV') });
    // Se fosse grupo 2 rígida, o 1,991 mm/s cairia em B.
    expect(statusSugerido(leituras, '2', 'rigida')).toEqual({ situacao: 'B', motivo: expect.stringContaining('ME 01HV') });
  });

  it('alarme do SKF sobe a sugestão: alerta → C, perigo → D', () => {
    const base = [vel('ME 01HV', 1)];
    expect(statusSugerido([...base, leitura({ valor: 5 })], '2', 'rigida')).toEqual({ situacao: 'C', motivo: expect.stringContaining('alerta') });
    expect(statusSugerido([...base, leitura({ valor: 8 })], '2', 'rigida').situacao).toBe('D');
    expect(statusSugerido([...base, leitura({ valor: 3 })], '2', 'rigida').situacao).toBe('A');
  });

  it('sem ISO nem alarme não sugere e diz por quê', () => {
    expect(statusSugerido([vel('ME 01HV', 1)], null, null)).toEqual({ situacao: null, motivo: expect.stringContaining('grupo e fundação') });
    expect(statusSugerido([leitura({ valor: 1, alarmeAlerta: null, alarmePerigo: null })], '2', 'rigida').motivo).toContain('Sem ponto de velocidade');
  });
});

describe('Vibração — nome do ponto do SKF', () => {
  it('grandeza pela letra da medida no fim do nome', () => {
    expect(['ME 01HA', 'ME 01HE03', 'ME 01HV', 'ME 02AV', 'BC 03TE', 'MG02 \\ RD 3HE', 'Mancal LA'].map(grandezaDoNome))
      .toEqual(['aceleracao', 'envelope', 'velocidade', 'velocidade', 'temperatura', 'envelope', null]);
  });
});

describe('Vibração — frequências de defeito', () => {
  it('converte fatores (múltiplos da rotação) em Hz', () => {
    const f = frequenciasDefeito(1780, { bpfo: 7.19, bpfi: 9.81, bsf: null, ftf: 0.4 });
    const hz = Object.fromEntries(f.map(x => [x.codigo, Math.round(x.hz * 10) / 10]));
    expect(hz).toEqual({ '1X': 29.7, '2X': 59.3, BPFO: 213.3, BPFI: 291, FTF: 11.9 });
  });

  it('identifica a frequência achada pelo inspetor (com harmônicas e tolerância de 3%)', () => {
    const fatores = { bpfo: 7.19, bpfi: 9.81, bsf: 2.9, ftf: 0.4 };
    expect(identificarFrequencia(213.3, 1780, fatores)[0]).toEqual(expect.objectContaining({ rotulo: 'BPFO', nome: expect.stringContaining('externa') }));
    expect(identificarFrequencia(426.6, 1780, fatores)[0].rotulo).toBe('2× BPFO');
    expect(identificarFrequencia(29.5, 1780, fatores)[0].rotulo).toBe('1X');
    expect(identificarFrequencia(150, 1780, fatores)).toEqual([]);
  });

  it('sem rotação não identifica', () => {
    expect(identificarFrequencia(213.3, null, { bpfo: 7.19, bpfi: null, bsf: null, ftf: null })).toEqual([]);
  });
});

describe('Vibração — tendência e número', () => {
  it('% de alteração igual ao relatório do SKF', () => {
    expect(Math.round(alteracaoPct(0.516, 0.428)! * 10) / 10).toBe(20.6);
    expect(Math.round(alteracaoPct(1.412, 0.691)!)).toBe(104);
    expect(alteracaoPct(1, null)).toBeNull();
  });

  it('avisa quando o valor dobra (menos temperatura)', () => {
    expect(avisoTendencia(4.2, 2)).toContain('2,1×');
    expect(avisoTendencia(3.9, 2)).toBeNull();
    expect(avisoTendencia(3, null)).toBeNull();
    expect(avisoTendencia(3, 0)).toBeNull();
    expect(avisoTendencia(90, 40, 'temperatura')).toBeNull();
  });

  it('número AV-001', () => {
    expect(numeroAnalise(1)).toBe('AV-001');
    expect(numeroAnalise(1234)).toBe('AV-1234');
  });
});

describe('Vibração — PDF', () => {
  it('gera o relatório na estrutura do Word da equipe', async () => {
    const analise: AnaliseVibracao = {
      id: 'a1', numero: 7, equipamentoId: 'e1', dataColeta: '2025-04-23', rotacaoRpm: 1780, condicaoOperacao: 'Carga normal',
      osNumero: '83868', tipoInspecao: 'programada', gestorArea: 'Jorge Bandeira', instrumento: 'SKF Microlog Analyzer GX75',
      sensor: 'Acelerômetro SKF CMSS2200 (100 mV/g)', instrumentoSerie: '1806057', calibracaoValidade: '2026-04-04',
      leituras: [
        leitura({ valor: 3.309, fatorCrista: 3.244, curtose: 3.284, frequenciaHz: 213.3 }),
        vel('BC 03AV', 3.6),
      ],
      modosFalha: ['Rolamento — pista externa (BPFO)'],
      diagnostico: 'Impactos a 213,3 Hz', recomendacao: 'Programar troca do rolamento', conclusao: 'Equipamento em alerta.', prazo: '2025-05-15',
      situacao: 'C', situacaoSugerida: 'C', anexos: [], observacoes: null, criadoPorId: 'u1', criadoPorNome: 'Assis Mesquita',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const equip: EquipamentoVibracao = {
      id: 'e1', tag: '91EAC06AF001', descricao: 'Acionamento', area: 'Carvão', tipoMaquina: 'Motor + redutor', fabricante: null, modelo: null,
      potenciaKw: 110, rotacaoRpm: 1780, grupoIso: '2', fundacao: 'rigida', desenhoUrl: null, observacoes: null, criadoPorNome: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const blob = await gerarPdfVibracao(analise, equip, {
      anteriores: new Map([['p1', 1.5]]),
      fatores: new Map([['p1', { bpfo: 7.19, bpfi: 9.81, bsf: 2.9, ftf: 0.4 }]]),
      historico: [{ numero: 3, dataColeta: '2025-01-10', situacao: 'B' }],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const bruto = Buffer.from(bytes).toString('latin1');
    const texto = [...bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(m => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } })
      .join('\n');
    ['AV-007', '91EAC06AF001', 'Alerta', 'Programada', 'GX75', '1806057', 'BPFO', '+120', 'AV-003', 'Programar troca', 'Equipamento em alerta', 'Objetivo']
      .forEach(t => expect(texto).toContain(t));
  });
});
