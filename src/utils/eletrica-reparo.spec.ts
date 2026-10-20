import { inflateSync } from 'zlib';
import { ReparoExterno } from '../models/eletrica-reparo.model';
import { REPARO_STATUS, REPARO_STATUS_LABEL, dataBr, numeroReparo, reparoEncerrado } from './eletrica-reparo';
import { gerarPdfReparo, nomeArquivoPdf } from './eletrica-reparo-pdf';

function reparo(overrides: Partial<ReparoExterno> = {}): ReparoExterno {
  return {
    id: 'r1', numero: 7, solicitanteId: 'u1', solicitanteNome: 'Neucivan Bezerra da Silva',
    equipamento: 'PanelView Plus 7', fabricanteModelo: 'Allen-Bradley', numeroSerie: '2711P-T12W22D8S',
    tagSap: null, localizacao: null, tempoOperacao: null,
    resumo: 'O equipamento apresenta dois defeitos independentes.',
    defeitos: [
      { titulo: 'Display com manchas', sintoma: 'Manchas visíveis', evolucao: '', situacaoAtual: 'Ilegível', causaProvavel: 'Desgaste' },
      { titulo: 'Falha de inicialização', sintoma: 'Demora', evolucao: 'Parou de iniciar', situacaoAtual: 'Não inicializa', causaProvavel: '' },
    ],
    verificacoes: ['Tentativa de reinicialização / reset.', 'Medição com osciloscópio'],
    verificacaoResultado: 'Sem alteração.',
    dataInicioSintomas: '2026-09-01', dataFalhaTotal: null, intervencoesAnteriores: null, garantia: 'expirada',
    servicoSolicitado: 'Diagnóstico e reparo.', contatoNome: 'Neucivan', contatoTelefone: '(85) 9 0000-0000', contatoEmail: null,
    fotos: [], status: 'aberto', statusObservacao: null, statusAtualizadoEm: null, statusAtualizadoPor: null,
    fornecedor: null, valorOrcamento: null, nfRemessa: null, previsaoRetorno: null, teamsEnviadoEm: null,
    createdAt: new Date('2026-10-07T12:00:00Z'),
    ...overrides,
  };
}

describe('eletrica-reparo utils', () => {
  it('formata o número do chamado como RE-007', () => {
    expect(numeroReparo(7)).toBe('RE-007');
    expect(numeroReparo(1234)).toBe('RE-1234');
    expect(numeroReparo(null)).toBe('');
  });

  it('converte data ISO pra dd/mm/aaaa sem mexer no fuso', () => {
    expect(dataBr('2026-10-01')).toBe('01/10/2026');
    expect(dataBr(null)).toBe('');
  });

  it('todo status tem rótulo e só concluído/inviável/cancelado encerram', () => {
    REPARO_STATUS.forEach(s => expect(REPARO_STATUS_LABEL[s]).toBeTruthy());
    expect(REPARO_STATUS_LABEL.disponivel_teste).toBe('Disponível para teste em campo');
    expect(REPARO_STATUS.filter(reparoEncerrado)).toEqual(['concluido', 'reparo_inviavel', 'cancelado']);
  });
});

describe('PDF do reparo externo', () => {
  it('gera um PDF válido com as seções do relatório', async () => {
    const blob = await gerarPdfReparo(reparo());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    // O PDF sai compactado (compress: true): descompacta os streams antes de procurar o texto.
    const bruto = Buffer.from(bytes).toString('latin1');
    const texto = [...bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map(m => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } })
      .join('\n');
    ['Reparo Externo', 'RE-007', 'Descrição dos defeitos', 'Display com manchas', 'Medição com osciloscópio']
      .forEach(t => expect(texto).toContain(t));
  });

  it('nome do arquivo leva número e equipamento sem acento', () => {
    expect(nomeArquivoPdf(reparo({ equipamento: 'Inversor de frequência' })))
      .toBe('RE-007_Relatorio_Reparo_Externo_Inversor_de_frequencia.pdf');
  });
});
