import {
  calcularProximaData, dataLimiteComTolerancia, folgaCoberturaCiclo, JANELA_ALINHAMENTO_DIAS, periodicidadeEfetiva,
  periodicidadeEmDias, preventivaVencendo, primeiroIndiceAPartirDe, proximaDataFixa, PeriodicidadeUnidade, somarDias,
  somarPeriodos,
} from './manutencao-preventivas';
import { CategoriaIndicador, ManutencaoArea, ManutencaoOrdem, PlanoManutencao, SigmaPreventivaPendente } from '../models/manutencao-programacao.model';

// Deriva a categoria do indicador semanal (ver CategoriaIndicador) a partir do que já
// existe no plano — Mecânica/Elétrica não têm ambiguidade; Apoio precisa olhar
// `especialidade` (texto livre herdado do SIGMA, ex. "P-REFRIGERACAO-PREVENTIVA",
// "P-OPERACAO-LIMPEZA INDUSTRIAL") pra decidir entre as 3 opções. null quando não dá
// pra inferir (ex. SPCI, que ainda não tem nenhum Plano cadastrado) — a pessoa escolhe
// na hora de programar.
export function inferirCategoriaIndicador(especialidade: string | null, area: ManutencaoArea): CategoriaIndicador | null {
  if (area === 'MECANICA' || area === 'ELETRICA') return area;
  const esp = (especialidade ?? '').toUpperCase();
  if (esp.includes('REFRIGERA')) return 'REFRIGERACAO';
  if (esp.includes('OPERACAO') || esp.includes('LIMPEZA')) return 'LIMP_OPERACIONAL';
  if (esp.includes('SPCI')) return 'SPCI';
  return null;
}

// Mesma ideia de inferirCategoriaIndicador, mas a partir do nome da equipe/empresa de
// Apoio (tecnicoNome) — convenção real do sistema: SERVPLEX é quem faz Refrigeração,
// OPERAÇÃO é Limp Operacional, BMS é SPCI (ver "Apoio programa por empresa/equipe" em
// manutencao-programacao.component.ts). Usado como fallback quando ninguém escolheu a
// categoria manualmente, pra essas 3 equipes conhecidas não caírem em "Não
// classificado" à toa.
export function inferirCategoriaIndicadorPorTecnico(tecnicoNome: string): CategoriaIndicador | null {
  const nome = tecnicoNome.toUpperCase();
  if (nome.includes('SERVPLEX')) return 'REFRIGERACAO';
  if (nome.includes('OPERA')) return 'LIMP_OPERACIONAL';
  if (nome.includes('BMS')) return 'SPCI';
  return null;
}

// "Próxima execução" de um plano — substitui o antigo campo mutável `ultima_execucao`
// (ver PlanoPreventivo, aposentado): agora é sempre derivada do ciclo mais recente já
// registrado em manutencao_ciclos (ver ManutencaoPlanosService.ultimoCicloDoPlano).
// Sem ciclo nenhum ainda, a próxima execução é a própria data inicial do plano — todo
// plano novo TEM uma data de partida (diferente do sistema antigo, onde
// `ultimaExecucao=null` também significava "nunca executado", mas sem nenhuma data
// concreta pra calcular a partir dela). Isso corrige o bug de planosJaProgramados(): a
// próxima data avança de verdade a cada ciclo gravado, nunca repete uma data já coberta,
// então não precisa de nenhuma lista de exclusão separada.
export function proximaExecucaoPlano(
  dataInicial: string, valor: number, unidade: PeriodicidadeUnidade, ultimoCicloData: string | null,
): string {
  if (!ultimoCicloData) return dataInicial;
  return calcularProximaData(ultimoCicloData, valor, unidade)!;
}

export interface PlanoComProximaData extends PlanoManutencao {
  proximaData: string;
}

/** Agenda única para cadastro e programação: calendário fixo, parada e semanas fechadas. */
export function agendaDosPlanos(
  planos: PlanoManutencao[], ciclosPorPlano: ReadonlyMap<string, string | readonly string[] | null>,
  plantaParada: boolean, hojeInicioSemana: string, semanasFechadas: ReadonlyMap<string, unknown>,
): PlanoComProximaData[] {
  const referencia = primeiraSemanaAberta(hojeInicioSemana, semanasFechadas);
  return (['ELETRICA', 'MECANICA', 'APOIO'] as const).flatMap(area => {
    const agenda = planosComProximaExecucaoFixa(
      planos.filter(p => p.area === area), plantaParada, referencia, ciclosPorPlano,
    );
    return hojeInicioSemana >= '2026-09-21' ? alinharDatasPorEquipamento(agenda, janelaAlinhamentoDaArea(area)) : agenda;
  });
}

// Segunda-feira da primeira semana ainda aberta a partir de hoje — semana fechada não
// recebe mais programação, então a agenda (e o controle de não programadas) começa depois.
export function primeiraSemanaAberta(hojeInicioSemana: string, semanasFechadas: ReadonlyMap<string, unknown>): string {
  let referencia = hojeInicioSemana;
  while (semanasFechadas.has(referencia)) referencia = somarDias(referencia, 7);
  return referencia;
}

// Janela do alinhamento por equipamento, por área. Apoio: 21 dias (grupos de salas
// vizinhas, pouco volume — ver Prédio 25). Mecânica/Elétrica: só dentro da mesma semana
// (6 dias) — reportado: com 21 dias a semana 40 da Mecânica foi de ~45 pra 75
// preventivas, porque o alinhamento puxava pra ela tudo que era do mesmo KKS nas 3
// semanas seguintes (muitos planos por equipamento: TC EAC13, Stacker 01...), desfazendo
// o balanceamento da migration 058.
export function janelaAlinhamentoDaArea(area: ManutencaoArea): number {
  return area === 'APOIO' ? JANELA_ALINHAMENTO_DIAS : 6;
}

// Anexa a próxima execução calculada a cada plano ativo — insumo de sugestoesDaSemana e
// atrasadas, abaixo. `ultimoCicloPorPlano` vem de ManutencaoPlanosService.ultimoCicloDoPlano
// (um lookup por plano, calculado uma vez fora daqui pra não repetir o scan do ledger de
// ciclos por plano).
export function planosComProximaExecucao(
  planos: PlanoManutencao[], ultimoCicloPorPlano: Map<string, string | null>, plantaParada: boolean,
): PlanoComProximaData[] {
  return planos.filter(p => p.ativo).map(p => {
    const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada, p.area);
    const ultimoCiclo = ultimoCicloPorPlano.get(p.id) ?? null;
    const proximaData = proximaExecucaoPlano(p.dataInicial, efetiva.valor, efetiva.unidade, ultimoCiclo);
    return { ...p, proximaData };
  });
}

// Variante TIME-BASED de planosComProximaExecucao — usada pra Apoio/Mecânica/Elétrica
// (ver proximaDataFixa): a próxima execução vem da própria data_inicial do plano
// (âncora), avançando por ciclos fixos até a próxima ocorrência >= referenciaIso.
// Pedido do usuário: "não existe backlog, começando do zero" — a sequência de âncora
// nunca depende de QUANDO a execução real aconteceu.
//
// `ciclosPorPlano` (ver ManutencaoPlanosService.ciclosPorPlano): sem ele, a ocorrência
// calculada não sabia que já tinha sido programada nessa semana (ver proximaDataFixa) —
// o plano continuava aparecendo em "Preventivas vencendo" o resto da semana mesmo
// depois de virar uma OS. Todos os ciclos, não só o último: OS excluída numa semana
// volta pra lista mesmo com o plano já programado numa semana à frente.
export function planosComProximaExecucaoFixa(
  planos: PlanoManutencao[], plantaParada: boolean, referenciaIso: string,
  ciclosPorPlano: ReadonlyMap<string, string | readonly string[] | null> = new Map(),
): PlanoComProximaData[] {
  return planos.filter(p => p.ativo).map(p => {
    const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada, p.area);
    const ciclos = ciclosPorPlano.get(p.id) ?? null;
    const proximaData = proximaDataFixa(p.dataInicial, efetiva.valor, efetiva.unidade, referenciaIso, ciclos, p.agendaRigida);
    return { ...p, proximaData };
  });
}

// Salas/equipamentos fisicamente vizinhos que o usuário confirmou que devem sair
// SEMPRE juntos (mesma visita), mesmo sendo KKS distintos — "aproveitar a viagem".
// Cada array é um grupo; todo KKS dentro de um grupo aponta pra uma chave só em
// chaveEquipamento, abaixo. Confirmado pelo usuário em 2026-09-16.
const GRUPOS_EQUIPAMENTO_VIZINHO: readonly (readonly string[])[] = [
  // SERVPLEX
  ['90SAA05AH616', '90SAA05AH617', '90SAA05AH618', '90SAA05AH619', '90SAA05AH620'], // Prédio 25 — Coordenação e Engenharia
  ['AC90EAD01AH015', 'AC90EAD01AH017', 'AC90EAD01AH019', 'AC90EAD01AH020'], // Salas Elétricas Stacker 01/02
  ['AC90SAG03AH504', 'AC90SAG03AH505', 'AC90SAG03AH506', 'AC90SAG03AH508'], // CCOT 01/02, Automação, PT
  ['AC90SAS21AH507', 'AC90SAS21AH508', 'AC90SAS21AH509'], // Cofre, Planejamento/Supervisão, Oficina Elétrica
  ['AC91EAC01AH012', 'AC91EAC01AH013', 'AC91EAC01AH014'], // Salas Elétricas TC 05/06/07 (Self)
  ['SRC91EAD10AH004', 'SRC91EAD20AH004'], // Cabines Stacker 01/02 (refrigeração)
  ['AC90SAG03AH501', 'AC90SAG03AH502', 'AC90SAG03AH503'], // Sala 46 — SUP1/SUP2 pátio carvão + Self (confirmado em 2026-10-14)
  // BMS
  ['TCLD91EAC05AF001', 'TCLD91EAC06AF001', 'SPCI91EAC07'], // Torres de Transferência 05/06/07
  [
    'SPCI91EAD10', 'SPCI91EAD10001', 'SPCI91EAD10002', 'SPCI91EAD10003', 'SPCI91EAD10004',
    'SPCI91EAD10005', 'SPCI91EAD10006', 'SPCI91EAD20001', 'TC91ECA33AF001',
  ], // Stackers 01/02 + Correia ECA 33
  ['TC91ECA41AF001', 'TC91ECA42AF001'], // Correias ECA 41/42
  ['TC91ECA43AF001', 'TC91ECA44AF001'], // Correias ECA 43/44
];
const CHAVE_GRUPO_POR_KKS: ReadonlyMap<string, string> = new Map(
  GRUPOS_EQUIPAMENTO_VIZINHO.flatMap((grupo, i) => grupo.map(kks => [kks, `GRUPO_${i}`] as const)),
);

// Identificador de equipamento pra agrupamento (Regra A/B abaixo) — usa o TAG KKS
// (`tagKks`), não o nome livre (`equipamento`): pedido explícito do usuário ("a questão
// do mesmo equipamento é o mesmo KKS que quero dizer") — o mesmo equipamento físico
// pode estar escrito de formas diferentes entre planos distintos (abreviação, typo),
// enquanto o KKS é o identificador técnico estável. Sem KKS cadastrado, o plano nunca
// agrupa com nenhum outro — usa o próprio id (sempre único) como chave, em vez de
// arriscar juntar equipamentos diferentes por engano quando não dá pra confirmar que
// são o mesmo. Exceção: KKS que faz parte de um GRUPOS_EQUIPAMENTO_VIZINHO agrupa com
// os outros do mesmo grupo, não só consigo mesmo.
export function chaveEquipamento(p: Pick<PlanoManutencao, 'area' | 'tagKks' | 'id'>): string {
  const kks = p.tagKks?.trim();
  if (!kks) return `${p.area}||SEM_KKS:${p.id}`;
  const grupo = CHAVE_GRUPO_POR_KKS.get(kks);
  return grupo ? `${p.area}||${grupo}` : `${p.area}||KKS:${kks}`;
}

export interface PlanoAlinhadoPorEquipamento extends PlanoComProximaData {
  // Data original ANTES do alinhamento — null quando o plano não foi alinhado (é o
  // único do seu equipamento no mês, ou já era o mais cedo do grupo).
  proximaDataOriginal: string | null;
}

// Pedido do usuário: 2+ planos do MESMO equipamento (mesmo KKS, ver chaveEquipamento,
// dentro da mesma área) com próxima execução próxima não devem gerar visitas separadas
// (ex.: um plano mensal e um trimestral do mesmo equipamento saem juntos). Todo o bloco
// passa a usar a data MAIS CEDO entre eles — nunca a mais tarde, pra nenhum plano ficar
// mais atrasado do que já estava sozinho; o de ciclo mais longo só é atendido um pouco
// antes do que seu próprio cálculo pediria.
//
// Bloco = janela móvel de JANELA_ALINHAMENTO_DIAS a partir da data mais cedo, não mais
// "mesmo mês de calendário". Reportado: o corte por mês separava o grupo do Prédio 25
// (datas em 21/09, 28/09, 05/10...) em visitas de semanas seguidas, uma em cima da
// outra, só porque a virada do mês caía no meio. A janela também limita o quanto um
// plano é antecipado (antes: até ~30 dias), casando com folgaCoberturaCiclo — que é o
// que impede o plano antecipado de reaparecer na semana da sua data original.
export function alinharDatasPorEquipamento(
  planos: PlanoComProximaData[], janelaDias: number = JANELA_ALINHAMENTO_DIAS,
): PlanoAlinhadoPorEquipamento[] {
  const porEquipamento = new Map<string, number[]>();
  planos.forEach((p, i) => {
    // Agenda rígida (ver PlanoManutencao.agendaRigida): fica fora do alinhamento — nem é
    // antecipado, nem puxa os vizinhos pra sua data.
    if (p.agendaRigida) return;
    const chave = chaveEquipamento(p);
    const lista = porEquipamento.get(chave);
    if (lista) lista.push(i);
    else porEquipamento.set(chave, [i]);
  });

  const resultado: PlanoAlinhadoPorEquipamento[] = planos.map(p => ({ ...p, proximaDataOriginal: null }));

  for (const indices of porEquipamento.values()) {
    if (indices.length < 2) continue;
    const ordenados = [...indices].sort((a, b) => planos[a].proximaData.localeCompare(planos[b].proximaData));
    let dataAlvo = '';
    let limiteBloco = '';
    for (const i of ordenados) {
      const data = planos[i].proximaData;
      if (data > limiteBloco) {
        // Abre bloco novo: este plano é o mais cedo dele.
        dataAlvo = data;
        limiteBloco = somarDias(data, janelaDias);
      } else if (data !== dataAlvo && data <= somarDias(dataAlvo, antecipacaoMaxima(planos[i].periodicidadeValor, planos[i].periodicidadeUnidade))) {
        // Antecipa no máximo 1/3 do período DO PRÓPRIO plano, limitado à folga de cobertura
        // (semanal 2 dias, quinzenal 5, mensal 10, trimestral+ 21) — regra do usuário:
        // preventiva só pode ser antecipada até 1/3 do período. Reportado: L-OP-1S TRIPPERS (semanal) já programada
        // na S41 voltava pra S41 — a ocorrência seguinte (12/10) era puxada pra 05/10 pelo
        // vizinho quinzenal pendente, e a cada programação a próxima era puxada de novo.
        // Fora da folga, o plano fica na própria data (não faz sentido adiantar uma
        // semanal uma semana inteira).
        resultado[i] = { ...resultado[i], proximaData: dataAlvo, proximaDataOriginal: data };
      }
    }
  }
  return resultado;
}

// Quanto o alinhamento por equipamento pode antecipar um plano: 1/3 do período (mesma
// tolerância do atraso, ver dataLimiteComTolerancia), nunca além da folga de cobertura —
// senão o plano antecipado voltaria na semana da data original.
export function antecipacaoMaxima(valor: number, unidade: PeriodicidadeUnidade): number {
  return Math.min(folgaCoberturaCiclo(valor, unidade), Math.round(periodicidadeEmDias(valor, unidade) / 3));
}

/**
 * Data do ciclo a gravar quando a sugestão é programada: a ocorrência REAL do plano
 * (antes do alinhamento por equipamento), não a data antecipada pra sair junto com o
 * vizinho. Gravando a antecipada, plano de ciclo curto (folga de cobertura = 3/4 do
 * período, menor que a janela de 21 dias do Apoio) ficava com a ocorrência real
 * descoberta e voltava pra mesma semana mesmo depois de programado.
 */
export function dataCicloAoProgramar(p: PlanoComProximaData): string {
  return (p as Partial<PlanoAlinhadoPorEquipamento>).proximaDataOriginal ?? p.proximaData;
}

// Planos cuja próxima execução cai dentro da semana em exibição, ordenados por
// prioridade — mesma regra combinada com o usuário pro sistema antigo (ver
// preventivasVencendoTodas no componente): antes do corte de regras novas, só pela data
// mais urgente; depois, primeiro por periodicidade do CADASTRO mais longa (perder uma
// anual dói mais que perder uma mensal), desempatando pela mais urgente.
export function sugestoesDaSemana(
  planos: PlanoComProximaData[], inicioSemanaIso: string, fimSemanaIso: string, priorizarCicloLongo: boolean,
): PlanoComProximaData[] {
  return planos
    .filter(p => preventivaVencendo(p.proximaData, inicioSemanaIso, fimSemanaIso))
    .sort((a, b) => {
      if (!priorizarCicloLongo) return a.proximaData.localeCompare(b.proximaData);
      const diasA = periodicidadeEmDias(a.periodicidadeValor, a.periodicidadeUnidade);
      const diasB = periodicidadeEmDias(b.periodicidadeValor, b.periodicidadeUnidade);
      if (diasA !== diasB) return diasB - diasA;
      return a.proximaData.localeCompare(b.proximaData);
    });
}

export const EQUIPE_APOIO_NAO_CLASSIFICADA = 'NAO_CLASSIFICADO' as const;
export type ChaveEquipeApoio = CategoriaIndicador | typeof EQUIPE_APOIO_NAO_CLASSIFICADA;
export type LimitePorEquipeApoio = Partial<Record<ChaveEquipeApoio, number>>;

// Equipe sem limite configurado (ex.: MECANICA/ELETRICA nunca aparecem aqui, já que
// inferirCategoriaIndicadorPorTecnico só devolve REFRIGERACAO/LIMP_OPERACIONAL/SPCI/
// null) cai nesse teto conservador — nunca fica sem corte nenhum.
const LIMITE_PADRAO_EQUIPE_NAO_CONFIGURADA = 5;

// Cap do Apoio: no máx. N sugestões por equipe (SERVPLEX/OPERAÇÃO/BMS, ver
// inferirCategoriaIndicadorPorTecnico) por semana, UM LIMITE DIFERENTE POR EQUIPE (ver
// `limitePorEquipe`) — substitui, só pra área APOIO, o corte único de
// LOTE_PREVENTIVAS_POR_SEMANA no componente (que deixava uma equipe engolir o espaço
// das outras, reportado: 20 sugestões de Refrigeração, nada de Operação/BMS). Mesma
// filosofia do corte de área que já existe: fatia os N primeiros de uma fila JÁ
// ORDENADA por prioridade (ver sugestoesDaSemana), recalculada a cada render — quem não
// entra não é empurrado pra nenhuma data específica, só continua no backlog e aparece
// sozinho numa semana futura assim que virar top-N da fila da PRÓPRIA equipe.
//
// Cap ESTRITO em cima de PLANOS, não de "vagas"/equipamento — a versão anterior contava
// um grupo de mesmo equipamento+data como 1 vaga só, mas isso deixava passar 44 planos
// de uma vez quando muitas tarefas diferentes do mesmo KKS caíam juntas — o usuário
// confirmou que isso NUNCA pode acontecer, o corte é rígido, sem exceção.
// alinharDatasPorEquipamento continua alinhando a DATA de planos do mesmo equipamento
// (isso não infla contagem nenhuma), só o corte aqui virou sem exceção.
//
// Por que um número POR EQUIPE, e não mais um valor único (era 5 fixo pra todas):
// depois de migrar o Apoio pro modelo time-based (agenda fixa, sem backlog — ver
// proximaDataFixa) e corrigir os dados contra o SAP, uma semana normal de verdade já
// varia bastante de equipe pra equipe — em especial a OPERAÇÃO, que tem várias tarefas
// de ciclo CURTO (semanal/quinzenal, ex. "L-OP-1S TRIPPERS") que aparecem toda semana
// por definição, não por erro. Um teto único de 5 cortaria trabalho real e legítimo
// toda semana pra essa equipe. Por isso virou um teto por equipe, dimensionado acima do
// pico real observado — funciona como rede de segurança contra erro de cadastro (o
// cenário das 44 ordens de um erro de duplicação), não como limite de rotina.
//
// `responsavel` vazio/não reconhecido cai no balde NAO_CLASSIFICADO, com cota PRÓPRIA —
// assim não estoura silenciosamente o orçamento de uma equipe conhecida nem some da
// lista sem nenhum corte.
export function limitarPorEquipeApoio(
  planosOrdenados: PlanoComProximaData[], limitePorEquipe: LimitePorEquipeApoio,
): PlanoComProximaData[] {
  const contagemPorEquipe = new Map<ChaveEquipeApoio, number>();
  const resultado: PlanoComProximaData[] = [];
  for (const p of planosOrdenados) {
    const equipe = inferirCategoriaIndicadorPorTecnico(p.responsavel ?? '') ?? EQUIPE_APOIO_NAO_CLASSIFICADA;
    const limite = limitePorEquipe[equipe] ?? LIMITE_PADRAO_EQUIPE_NAO_CONFIGURADA;
    const usados = contagemPorEquipe.get(equipe) ?? 0;
    // Agenda rígida nunca é cortada (ver PlanoManutencao.agendaRigida) — mas conta na cota.
    if (usados >= limite && !p.agendaRigida) continue;
    contagemPorEquipe.set(equipe, usados + 1);
    resultado.push(p);
  }
  return resultado;
}

export interface ResumoEquipeApoio {
  equipe: ChaveEquipeApoio;
  total: number; // planos pendentes pra essa equipe
  mostrados: number; // quantos entraram no corte de limitePorEquipe
}

// Contagem por equipe (1 por PLANO, mesma unidade estrita de limitarPorEquipeApoio) pra
// montar o resumo "SERVPLEX: 5/12 · BMS: 3/3" no lugar do texto único "Mostrando N de M
// pendentes" que a área inteira usa hoje — mostrados é sempre min(total, limitePorEquipe)
// porque o corte é um top-N sequencial simples por equipe, sem nenhum outro motivo de
// exclusão.
export function resumoPorEquipeApoio(
  planosOrdenados: PlanoComProximaData[], limitePorEquipe: LimitePorEquipeApoio,
): ResumoEquipeApoio[] {
  const contar = (planos: PlanoComProximaData[]) => {
    const porEquipe = new Map<ChaveEquipeApoio, number>();
    for (const p of planos) {
      const equipe = inferirCategoriaIndicadorPorTecnico(p.responsavel ?? '') ?? EQUIPE_APOIO_NAO_CLASSIFICADA;
      porEquipe.set(equipe, (porEquipe.get(equipe) ?? 0) + 1);
    }
    return porEquipe;
  };
  // Conta o que limitarPorEquipeApoio de fato mostra (agenda rígida pode passar do teto).
  const mostradosPorEquipe = contar(limitarPorEquipeApoio(planosOrdenados, limitePorEquipe));
  return [...contar(planosOrdenados).entries()]
    .map(([equipe, total]) => ({ equipe, total, mostrados: mostradosPorEquipe.get(equipe) ?? 0 }))
    .sort((a, b) => b.total - a.total);
}

// Controle de preventivas NÃO programadas. A agenda é por calendário fixo e sempre
// olha da semana aberta pra frente (ver proximaDataFixa) — então uma ocorrência que
// passou sem virar OS sumia sem rastro, e a antiga lista de "atrasadas" (próxima data +
// tolerância < hoje) nunca acendia, porque a próxima data nunca fica no passado.
// Agora: ocorrência de semana já passada (antes da primeira semana aberta) sem ciclo
// nem OS que a cubra (ver datasProgramadasPorPlano) = não programada. Olha só as últimas
// JANELA_NAO_PROGRAMADAS_SEMANAS semanas e nada antes de INICIO_CONTROLE_NAO_PROGRAMADAS
// (agenda rebalanceada pela migration 058 vale a partir de 05/10/2026 — antes disso o
// histórico não tem ciclo confiável e tudo apareceria como perdido).
export const INICIO_CONTROLE_NAO_PROGRAMADAS = '2026-10-05';
export const JANELA_NAO_PROGRAMADAS_SEMANAS = 8;

// Datas que contam como "programado" no controle de não programadas: ciclos com OS mais
// OS lançada à parte, sem ciclo — vinculada pelo planoPreventivoId ou com a descrição
// igual ao nome do plano na mesma área (mesmo critério do Mapa de 52 semanas), pela 1ª
// data prevista da OS. Sem isso, preventiva lançada "na mão" aparecia como perdida.
export function datasProgramadasPorPlano(
  planos: PlanoManutencao[], ciclosPorPlano: ReadonlyMap<string, readonly string[]>, ordens: ManutencaoOrdem[],
): Map<string, string[]> {
  const normalizar = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const porPlanoId = new Map<string, string[]>();
  const porNome = new Map<string, string[]>();
  const anexar = (mapa: Map<string, string[]>, chave: string, data: string) => {
    const lista = mapa.get(chave);
    if (lista) lista.push(data); else mapa.set(chave, [data]);
  };
  for (const o of ordens) {
    if (o.tipo !== 'ordem') continue;
    const data = o.diasPrevistos.length ? [...o.diasPrevistos].sort()[0] : o.semanaInicio;
    if (o.planoPreventivoId) anexar(porPlanoId, o.planoPreventivoId, data);
    anexar(porNome, `${o.area}|${normalizar(o.descricao)}`, data);
  }
  return new Map(planos.map(p => [p.id, [
    ...(ciclosPorPlano.get(p.id) ?? []),
    ...(porPlanoId.get(p.id) ?? []),
    ...(porNome.get(`${p.area}|${normalizar(p.nome)}`) ?? []),
  ]]));
}

export interface PlanoAtrasado extends PlanoAlinhadoPorEquipamento {
  prazoLimite: string; // ocorrência + tolerância de 1/3 do período (só informativo)
  ocorrenciasPerdidas: number; // quantas ocorrências da janela ficaram sem OS
}

// Um item por plano, com a ocorrência perdida MAIS ANTIGA em proximaData — "Programar"
// grava o ciclo nessa data (dataCicloAoProgramar), o que tira essa ocorrência da lista.
// Ocorrência coberta = existe ciclo entre (ocorrência - folga de cobertura) e a
// ocorrência seguinte: mesma folga do alinhamento por equipamento (ciclo gravado antes
// da data, quando o plano saiu junto com o vizinho) e qualquer data até a próxima
// (OS programada com atraso, ciclo ajustado pela data da OS — migration 063).
export function planosAtrasados(
  agenda: PlanoComProximaData[], datasProgramadas: ReadonlyMap<string, readonly string[]>,
  semanaAberta: string, plantaParada: boolean,
): PlanoAtrasado[] {
  const janela = somarDias(semanaAberta, -7 * JANELA_NAO_PROGRAMADAS_SEMANAS);
  const inicio = janela > INICIO_CONTROLE_NAO_PROGRAMADAS ? janela : INICIO_CONTROLE_NAO_PROGRAMADAS;
  const fim = somarDias(semanaAberta, -1);
  if (inicio > fim) return [];
  return agenda
    .flatMap(p => {
      const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada, p.area);
      if (efetiva.valor <= 0) return [];
      const folga = p.agendaRigida ? 0 : folgaCoberturaCiclo(efetiva.valor, efetiva.unidade);
      const ciclos = datasProgramadas.get(p.id) ?? [];
      const perdidas: string[] = [];
      let k = primeiroIndiceAPartirDe(p.dataInicial, efetiva.valor, efetiva.unidade, inicio);
      for (let data = somarPeriodos(p.dataInicial, k, efetiva.valor, efetiva.unidade); data <= fim;) {
        const seguinte = somarPeriodos(p.dataInicial, ++k, efetiva.valor, efetiva.unidade);
        const desde = somarDias(data, -folga);
        if (!ciclos.some(c => c >= desde && c < seguinte)) perdidas.push(data);
        data = seguinte;
      }
      if (perdidas.length === 0) return [];
      return [{
        ...p,
        proximaData: perdidas[0],
        // Data perdida é a ocorrência REAL — não herda a antecipação do alinhamento.
        proximaDataOriginal: null,
        prazoLimite: dataLimiteComTolerancia(perdidas[0], efetiva.valor, efetiva.unidade)!,
        ocorrenciasPerdidas: perdidas.length,
      }];
    })
    .sort((a, b) => a.proximaData.localeCompare(b.proximaData));
}

// Nome do plano sem a identificação do equipamento — pra achar planos "gêmeos" na hora
// de replicar checklist ("I-E-2S MOTORES/PAINEIS ECA45" e "... ECA46" viram o mesmo
// "I-E-2S MOTORES/PAINEIS"). Mantém o 1º termo (código da tarefa, ex. "I-E-2S", que tem
// dígito mas não é equipamento) e tira todo termo seguinte que tenha número (TAG/KKS,
// "TC05", "STR01", "01"...).
export function nomeBaseDoPlano(nome: string): string {
  const [primeiro, ...resto] = nome.trim().toUpperCase().split(/\s+/);
  return [primeiro, ...resto.filter(t => !/\d/.test(t))].filter(Boolean).join(' ');
}

// ── Mapa de intervenções (52 semanas) ─────────────────────────────────────────

export interface SemanaIso {
  numero: number; // 1..52 (ou 53)
  inicio: string; // segunda-feira 'YYYY-MM-DD'
  fim: string; // domingo
}

// Semanas ISO do ano (semana 1 = a que contém 4 de janeiro; SEG-DOM) — mesma numeração
// usada no resto do portal (numeroSemanaISO). 53 semanas quando 28/12 cai na semana 53.
export function semanasIsoDoAno(ano: number): SemanaIso[] {
  const quatroJan = new Date(ano, 0, 4);
  const segunda = new Date(ano, 0, 4 - ((quatroJan.getDay() + 6) % 7));
  const semanas: SemanaIso[] = [];
  for (let numero = 1; ; numero++) {
    const inicio = new Date(segunda);
    inicio.setDate(segunda.getDate() + (numero - 1) * 7);
    const quinta = new Date(inicio);
    quinta.setDate(inicio.getDate() + 3);
    if (quinta.getFullYear() !== ano) break; // semana pertence ao ano da sua quinta-feira
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    semanas.push({ numero, inicio: paraIsoLocal(inicio), fim: paraIsoLocal(fim) });
  }
  return semanas;
}

// Todas as datas da sequência fixa do plano (âncora, âncora+ciclo, ...) dentro de
// [inicio, fim] — mesma agenda time-based de proximaDataFixa, só que listando o ano
// inteiro em vez de só a próxima.
export function ocorrenciasNoIntervalo(
  dataAncora: string, valor: number, unidade: PeriodicidadeUnidade, inicio: string, fim: string,
): string[] {
  if (valor <= 0) return [];
  const datas: string[] = [];
  for (let k = primeiroIndiceAPartirDe(dataAncora, valor, unidade, inicio); ; k++) {
    const data = somarPeriodos(dataAncora, k, valor, unidade);
    if (data > fim) break;
    datas.push(data);
  }
  return datas;
}

// Sigla curta da periodicidade pra célula do mapa (cabe num quadradinho). Pela duração
// em dias, não pelo texto do cadastro — "30 Dia(s)" e "1 Mes(es)" são os dois "M".
export function siglaPeriodicidade(valor: number, unidade: PeriodicidadeUnidade): string {
  const dias = periodicidadeEmDias(valor, unidade);
  if (dias <= 10) return 'S';
  if (dias <= 17) return 'Q';
  if (dias <= 24) return '3S';
  if (dias <= 45) return 'M';
  if (dias <= 75) return 'B';
  if (dias <= 105) return 'T';
  if (dias <= 135) return '4M';
  if (dias <= 200) return '6M';
  if (dias <= 400) return 'A';
  return '2A';
}

export interface DiaGradeMensal {
  data: string; // 'YYYY-MM-DD'
  noMes: boolean; // false = dia de preenchimento do mês anterior/seguinte, pra fechar a semana
}

function paraIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Grade de calendário mensal (semanas × 7 dias, Seg-Dom) pro Calendário de Manutenção —
// inclui dias do mês anterior/seguinte pra fechar a primeira/última semana (noMes=false
// neles, pra ficarem esmaecidos na tela). `mes` é 1-12 (não 0-11 como o Date nativo).
export function gerarGradeMensal(ano: number, mes: number): DiaGradeMensal[][] {
  const primeiroDia = new Date(ano, mes - 1, 1);
  const dowPrimeiro = (primeiroDia.getDay() + 6) % 7; // 0 = segunda
  const ultimoDia = new Date(ano, mes, 0); // dia 0 do mês seguinte = último dia deste mês
  const cursor = new Date(ano, mes - 1, 1 - dowPrimeiro);

  const semanas: DiaGradeMensal[][] = [];
  // A cada volta, `cursor` é a segunda-feira da próxima semana ainda não processada —
  // continua enquanto essa segunda cair dentro (ou antes) do último dia do mês, pra
  // garantir cobrir a semana que contém o último dia, sem sobrar uma semana em branco.
  while (cursor.getTime() <= ultimoDia.getTime()) {
    const semana: DiaGradeMensal[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push({ data: paraIsoLocal(cursor), noMes: cursor.getMonth() === mes - 1 });
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

// ── OS do SIGMA reaproveitada pelo plano ─────────────────────────────────────

export interface OsSigmaDoPlano {
  numeroOs: string;
  outras: number; // quantas OUTRAS pendentes do mesmo plano ainda sobram
}

/**
 * Pra cada plano, a OS preventiva PEND mais antiga do SIGMA com a MESMA descrição (nome
 * do plano, sem acento/maiúscula/espaço duplo) que ainda não está na programação do
 * portal — o que hoje o planejador procura à mão antes de abrir OS nova. Desempate pelo
 * equipamento: se alguma candidata tem o "Bem" igual ao tag_kks do plano, só elas
 * contam (planos de mesmo nome em equipamentos diferentes, ex. splits do Prédio 25);
 * senão só se todas forem do mesmo equipamento.
 * Uma OS vai pra um plano só. Mais antiga = data de abertura, depois número.
 */
export function osSigmaDosPlanos(
  planos: Pick<PlanoManutencao, 'id' | 'codigo' | 'nome' | 'tagKks'>[],
  pendentes: SigmaPreventivaPendente[],
  numerosJaUsados: ReadonlySet<string>,
  normalizarNumeroOs: (v: string) => string,
): Map<string, OsSigmaDoPlano> {
  const normalizar = (v: string) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const porDescricao = new Map<string, SigmaPreventivaPendente[]>();
  for (const os of pendentes) {
    if (numerosJaUsados.has(normalizarNumeroOs(os.numeroOs))) continue;
    const k = normalizar(os.descricao);
    porDescricao.set(k, [...(porDescricao.get(k) ?? []), os]);
  }
  porDescricao.forEach(lista => lista.sort((a, b) => a.data.localeCompare(b.data) || a.numeroOs.localeCompare(b.numeroOs)));
  const usadas = new Set<string>();
  const resultado = new Map<string, OsSigmaDoPlano>();
  for (const p of [...planos].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    const livres = (porDescricao.get(normalizar(p.nome)) ?? []).filter(os => !usadas.has(os.numeroOs));
    const kks = (p.tagKks ?? '').trim().toUpperCase();
    const doBem = kks ? livres.filter(os => os.bem.trim().toUpperCase() === kks) : [];
    // Nenhuma do mesmo Bem: só usa se todas são de UM equipamento só (cadastro com KKS
    // escrito diferente); de equipamentos diferentes é ambíguo e o plano fica sem sugestão.
    const umEquipamento = new Set(livres.map(os => os.bem.trim().toUpperCase())).size === 1;
    const pool = doBem.length ? doBem : umEquipamento ? livres : [];
    if (!pool.length) continue;
    usadas.add(pool[0].numeroOs);
    resultado.set(p.id, { numeroOs: pool[0].numeroOs, outras: pool.length - 1 });
  }
  return resultado;
}
