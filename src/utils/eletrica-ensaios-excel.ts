import { EnsaioIsolamento, Motor, MovimentoEquipamento } from '../models/eletrica-ensaio.model';
import { EnsaioTrafo, Transformador } from '../models/eletrica-trafo.model';
import { EnsaioTermografia } from '../models/eletrica-termografia.model';
import {
  CLASSE_LABEL, RESULTADO_LABEL, SITUACAO_LABEL, TIPO_ACIONAMENTO_LABEL, TIPO_BOBINA_CURTO, avaliarEnsaio, circuitoLabel, criterioDoEnsaio,
  numeroEnsaio, temperaturaCorrecao,
} from './eletrica-ensaio';
import { MEIO_LABEL, avaliarTrafo, circuitoTrafoLabel, tensoesTexto } from './eletrica-trafo';
import { CRITERIO_PONTO_LABEL, PRIORIDADE_ACAO, avaliarPontos } from './eletrica-termografia';
import { dataBr } from './eletrica-reparo';

// Monta as abas do Excel dos Ensaios Elétricos: cadastro (motores, trafos), uma linha por
// medição em cada tipo de ensaio (fácil de filtrar e fazer gráfico no Excel) e o
// histórico de situação/trocas. Números vão como número (não texto) pra dar pra somar.

type Celula = string | number | null;
interface Aba {
  nome: string;
  colunas: { header: string; width: number; quebra?: boolean }[];
  linhas: Celula[][];
}

const n = (v: number | null | undefined, casas = 2): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(casas));

export function abasEnsaiosEletricos(dados: {
  motores: Motor[];
  trafos: Transformador[];
  ensaiosMotor: EnsaioIsolamento[];
  ensaiosTrafo: EnsaioTrafo[];
  termografias: EnsaioTermografia[];
  movimentos: MovimentoEquipamento[];
}): Aba[] {
  const tagPorId = new Map<string, string>([...dados.motores.map(m => [m.id, m.tag] as const), ...dados.trafos.map(t => [t.id, t.tag] as const)]);
  const tag = (id: string) => tagPorId.get(id) ?? '—';
  const abas: Aba[] = [];

  abas.push({
    nome: 'Motores',
    colunas: [
      { header: 'TAG', width: 18 }, { header: 'Situação', width: 11 }, { header: 'Aplicação / reserva de', width: 32, quebra: true },
      { header: 'Local', width: 20 }, { header: 'Descrição', width: 30, quebra: true }, { header: 'Fabricante', width: 14 },
      { header: 'Modelo', width: 16 }, { header: 'Nº série', width: 14 }, { header: 'Potência (kW)', width: 11 },
      { header: 'Potência (cv)', width: 11 }, { header: 'Tensão (V)', width: 10 }, { header: 'Corrente (A)', width: 10 },
      { header: 'Rotação (rpm)', width: 10 }, { header: 'Acionamento', width: 20 }, { header: 'Classe', width: 9 }, { header: 'Bobina', width: 16 },
    ],
    linhas: dados.motores.map(m => [
      m.tag, SITUACAO_LABEL[m.situacao], m.aplicacao, m.localInstalacao, m.descricao, m.fabricante, m.modelo, m.numeroSerie,
      n(m.potenciaKw), n(m.potenciaCv), n(m.tensaoV, 1), n(m.correnteA), m.rotacaoRpm,
      m.tipoAcionamento ? TIPO_ACIONAMENTO_LABEL[m.tipoAcionamento] : null, m.classeIsolamento, TIPO_BOBINA_CURTO[m.tipoBobina],
    ]),
  });

  abas.push({
    nome: 'Transformadores',
    colunas: [
      { header: 'TAG', width: 16 }, { header: 'Situação', width: 11 }, { header: 'Aplicação / reserva de', width: 30, quebra: true },
      { header: 'Local', width: 20 }, { header: 'Descrição', width: 30, quebra: true }, { header: 'Fabricante', width: 14 },
      { header: 'Nº série', width: 14 }, { header: 'Potência (kVA)', width: 11 }, { header: 'Tensões / ligação', width: 26 },
      { header: 'Meio isolante', width: 14 }, { header: 'Classe', width: 12 }, { header: 'Relação / taps', width: 20 },
    ],
    linhas: dados.trafos.map(t => [
      t.tag, SITUACAO_LABEL[t.situacao], t.aplicacao, t.localInstalacao, t.descricao, t.fabricante, t.numeroSerie, n(t.potenciaKva, 1),
      tensoesTexto(t.tensaoPrimariaV, t.ligacaoPrimaria, t.secundarios), MEIO_LABEL[t.meioIsolante], CLASSE_LABEL[t.classeIsolamento], t.relacaoTaps,
    ]),
  });

  abas.push({
    nome: 'Isolamento motores',
    colunas: [
      { header: 'Nº', width: 9 }, { header: 'Data', width: 11 }, { header: 'TAG', width: 18 }, { header: 'OS', width: 12 },
      { header: 'Circuito', width: 18 }, { header: 'Tensão aplicada (V)', width: 11 }, { header: 'Temp. correção (°C)', width: 11 },
      { header: '30 s (MΩ)', width: 11 }, { header: '1 min (MΩ)', width: 11 }, { header: '10 min (MΩ)', width: 11 },
      { header: '1 min a 40 °C (MΩ)', width: 13 }, { header: 'IA', width: 7 }, { header: 'IP', width: 7 },
      { header: 'Situação do circuito', width: 13 }, { header: 'Resultado do ensaio', width: 12 }, { header: 'Lançado por', width: 20 },
    ],
    linhas: dados.ensaiosMotor.flatMap(e => {
      const av = avaliarEnsaio(e.medicoes, criterioDoEnsaio(e));
      return e.medicoes.map((l, i) => {
        const a = av.circuitos[i];
        return [
          numeroEnsaio(e.numero), dataBr(e.dataEnsaio), tag(e.equipamentoId), e.osNumero, circuitoLabel(l.circuito) + (l.foraEscala ? ' (fundo de escala)' : ''),
          n(e.tensaoAplicadaV, 0), n(temperaturaCorrecao(e), 1), n(l.r30s), n(l.r1min), n(l.r10min), n(a.r1min40),
          n(a.ia), a.ipSituacao === 'na' ? 'N/A' : n(a.ip), a.situacao === 'aprovado' ? 'OK' : a.situacao === 'reprovado' ? 'Reprovado' : 'Incompleto',
          RESULTADO_LABEL[e.resultado], e.criadoPorNome,
        ];
      });
    }),
  });

  abas.push({
    nome: 'Trafos - isolamento',
    colunas: [
      { header: 'Nº', width: 9 }, { header: 'Data', width: 11 }, { header: 'TAG', width: 14 }, { header: 'Circuito', width: 14 },
      { header: 'Tensão (V)', width: 10 }, { header: '30 s (MΩ)', width: 11 }, { header: '1 min (MΩ)', width: 11 }, { header: '10 min (MΩ)', width: 11 },
      { header: '1 min a 20 °C (MΩ)', width: 13 }, { header: 'Mínimo (MΩ)', width: 11 }, { header: 'IA', width: 7 }, { header: 'IP', width: 7 },
      { header: 'Situação', width: 12 }, { header: 'Resultado do ensaio', width: 12 },
    ],
    linhas: dados.ensaiosTrafo.flatMap(e => {
      const av = avaliarTrafo(e);
      return e.isolamento.map((l, i) => {
        const a = av.isolamento[i];
        return [
          numeroEnsaio(e.numero), dataBr(e.dataEnsaio), tag(e.equipamentoId), circuitoTrafoLabel(l.circuito) + (l.foraEscala ? ' (fundo de escala)' : ''),
          n(l.tensaoV, 0), n(l.r30s), n(l.r1min), n(l.r10min), n(a.r1min20), n(a.minimo), n(a.ia), a.indiceSituacao === 'na' ? 'N/A' : n(a.ip),
          a.situacao === 'aprovado' ? 'OK' : a.situacao === 'reprovado' ? 'Reprovado' : 'Incompleto', RESULTADO_LABEL[e.resultado],
        ];
      });
    }),
  });

  abas.push({
    nome: 'Trafos - ohmica e TTR',
    colunas: [
      { header: 'Nº', width: 9 }, { header: 'Data', width: 11 }, { header: 'TAG', width: 14 }, { header: 'Ensaio', width: 16 },
      { header: 'Enrolamento', width: 12 }, { header: 'Par', width: 22 }, { header: 'Valor', width: 11 }, { header: 'Referência', width: 14 },
      { header: 'Diferença / desvio (%)', width: 13 }, { header: 'Situação', width: 12 },
    ],
    linhas: dados.ensaiosTrafo.flatMap(e => {
      const av = avaliarTrafo(e);
      const oh = e.ohmica.flatMap((o, i) => o.pares.map(p => [
        numeroEnsaio(e.numero), dataBr(e.dataEnsaio), tag(e.equipamentoId), 'Resistência ôhmica (mΩ)', o.enrolamento, p.par, n(p.valor, 4),
        av.ohmica[i].media75 !== null ? `média 75 °C ${n(av.ohmica[i].media75, 3)}` : null, n(av.ohmica[i].desequilibrioPct),
        av.ohmica[i].situacao === 'aprovado' ? 'OK' : av.ohmica[i].situacao === 'reprovado' ? 'Reprovado' : 'Incompleto',
      ] as Celula[]));
      const tt = e.ttr.flatMap((x, i) => x.pares.map((p, k) => [
        numeroEnsaio(e.numero), dataBr(e.dataEnsaio), tag(e.equipamentoId), 'TTR', `H/${x.secundario}`, p.par, n(p.medida, 4),
        `calculada ${n(av.ttr[i].calculada, 3)}`, n(av.ttr[i].desvios[k]),
        av.ttr[i].situacao === 'aprovado' ? 'OK' : av.ttr[i].situacao === 'reprovado' ? 'Reprovado' : 'Incompleto',
      ] as Celula[]));
      return [...oh, ...tt];
    }),
  });

  abas.push({
    nome: 'Termografia',
    colunas: [
      { header: 'Nº', width: 9 }, { header: 'Data', width: 11 }, { header: 'TAG', width: 16 }, { header: 'Ponto', width: 30 },
      { header: 'Grupo', width: 14 }, { header: 'Critério', width: 26 }, { header: 'Temp. (°C)', width: 10 }, { header: 'Ambiente (°C)', width: 10 },
      { header: 'ΔT ambiente', width: 10 }, { header: 'ΔT similares', width: 10 }, { header: 'Prioridade', width: 9 },
      { header: 'Ação', width: 24 }, { header: 'Carga (%)', width: 9 }, { header: 'Resultado', width: 12 },
    ],
    linhas: dados.termografias.flatMap(e => {
      const av = avaliarPontos(e.pontos, e.temperaturaAmbienteC);
      return e.pontos.map((p, i) => [
        numeroEnsaio(e.numero), dataBr(e.dataEnsaio), tag(e.equipamentoId), p.ponto, p.grupo,
        p.criterio === 'limite' && p.limiteC !== null ? `Limite ${p.limiteC} °C` : CRITERIO_PONTO_LABEL[p.criterio],
        n(p.temperaturaC, 1), n(e.temperaturaAmbienteC, 1), n(av[i].dTAmbiente, 1), n(av[i].dTSimilares, 1),
        av[i].prioridade, av[i].prioridade ? PRIORIDADE_ACAO[av[i].prioridade!] : null, n(e.condicoes.cargaPct, 0), RESULTADO_LABEL[e.resultado],
      ]);
    }),
  });

  abas.push({
    nome: 'Situacao e trocas',
    colunas: [
      { header: 'Data', width: 11 }, { header: 'TAG', width: 18 }, { header: 'Situação anterior', width: 12 }, { header: 'Situação nova', width: 12 },
      { header: 'Aplicação', width: 30, quebra: true }, { header: 'Local', width: 22 }, { header: 'Troca com', width: 16 },
      { header: 'Motivo', width: 30, quebra: true }, { header: 'Usuário', width: 20 },
    ],
    linhas: dados.movimentos.map(m => [
      dataBr(m.dataMovimento), tag(m.equipamentoId), m.situacaoAnterior ? SITUACAO_LABEL[m.situacaoAnterior] : '—', SITUACAO_LABEL[m.situacaoNova],
      m.aplicacaoNova, m.localNovo, m.substitutoTag, m.motivo, m.usuarioNome,
    ]),
  });

  return abas;
}
