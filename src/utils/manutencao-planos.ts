import {
  calcularProximaData, dataLimiteComTolerancia, periodicidadeEfetiva, periodicidadeEmDias,
  preventivaVencendo, proximaDataFixa, PeriodicidadeUnidade,
} from './manutencao-preventivas';
import { CategoriaIndicador, ManutencaoArea, PlanoManutencao } from '../models/manutencao-programacao.model';

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

// Anexa a próxima execução calculada a cada plano ativo — insumo de sugestoesDaSemana e
// atrasadas, abaixo. `ultimoCicloPorPlano` vem de ManutencaoPlanosService.ultimoCicloDoPlano
// (um lookup por plano, calculado uma vez fora daqui pra não repetir o scan do ledger de
// ciclos por plano).
export function planosComProximaExecucao(
  planos: PlanoManutencao[], ultimoCicloPorPlano: Map<string, string | null>, plantaParada: boolean,
): PlanoComProximaData[] {
  return planos.filter(p => p.ativo).map(p => {
    const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada);
    const ultimoCiclo = ultimoCicloPorPlano.get(p.id) ?? null;
    const proximaData = proximaExecucaoPlano(p.dataInicial, efetiva.valor, efetiva.unidade, ultimoCiclo);
    return { ...p, proximaData };
  });
}

// Variante TIME-BASED de planosComProximaExecucao — usada só pro Apoio (ver
// proximaDataFixa): a próxima execução vem da própria data_inicial do plano
// (âncora), avançando por ciclos fixos até a próxima ocorrência >= referenciaIso,
// SEM olhar manutencao_ciclos/última execução real. Pedido do usuário: "não existe
// backlog, começando do zero" — Elétrica/Mecânica continuam em
// planosComProximaExecucao (completion-based), sem mudança.
export function planosComProximaExecucaoFixa(
  planos: PlanoManutencao[], plantaParada: boolean, referenciaIso: string,
): PlanoComProximaData[] {
  return planos.filter(p => p.ativo).map(p => {
    const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada);
    const proximaData = proximaDataFixa(p.dataInicial, efetiva.valor, efetiva.unidade, referenciaIso);
    return { ...p, proximaData };
  });
}

// Identificador de equipamento pra agrupamento (Regra A/B abaixo) — usa o TAG KKS
// (`tagKks`), não o nome livre (`equipamento`): pedido explícito do usuário ("a questão
// do mesmo equipamento é o mesmo KKS que quero dizer") — o mesmo equipamento físico
// pode estar escrito de formas diferentes entre planos distintos (abreviação, typo),
// enquanto o KKS é o identificador técnico estável. Sem KKS cadastrado, o plano nunca
// agrupa com nenhum outro — usa o próprio id (sempre único) como chave, em vez de
// arriscar juntar equipamentos diferentes por engano quando não dá pra confirmar que
// são o mesmo.
function chaveEquipamento(p: PlanoManutencao): string {
  const kks = p.tagKks?.trim();
  return kks ? `${p.area}||KKS:${kks}` : `${p.area}||SEM_KKS:${p.id}`;
}

export interface PlanoAlinhadoPorEquipamento extends PlanoComProximaData {
  // Data original ANTES do alinhamento — null quando o plano não foi alinhado (é o
  // único do seu equipamento no mês, ou já era o mais cedo do grupo).
  proximaDataOriginal: string | null;
}

// Pedido do usuário: 2+ planos do MESMO equipamento (mesmo KKS, ver chaveEquipamento,
// dentro da mesma área) cuja próxima execução caia no MESMO MÊS DE CALENDÁRIO não devem
// gerar duas visitas separadas (ex.: um plano mensal e um trimestral do mesmo
// equipamento, ambos vencendo em setembro, saem juntos). Todo o grupo passa a usar a
// data MAIS CEDO entre eles — nunca a mais tarde, pra nenhum plano ficar mais atrasado
// do que já estava sozinho; o de ciclo mais longo só é atendido um pouco antes do que
// seu próprio cálculo pediria. Sem limite de distância dentro do mês (confirmado com o
// usuário): mesmo que as datas originais estejam em pontas opostas do mês, alinha do
// mesmo jeito — pior caso é "um pouco cedo demais", nunca atrasa. "Mesmo mês" comparado
// como string 'YYYY-MM' — separa corretamente dezembro de um ano de janeiro do ano
// seguinte, sem caso especial.
export function alinharDatasPorEquipamento(planos: PlanoComProximaData[]): PlanoAlinhadoPorEquipamento[] {
  const porEquipamento = new Map<string, number[]>();
  planos.forEach((p, i) => {
    const chave = chaveEquipamento(p);
    const lista = porEquipamento.get(chave);
    if (lista) lista.push(i);
    else porEquipamento.set(chave, [i]);
  });

  const resultado: PlanoAlinhadoPorEquipamento[] = planos.map(p => ({ ...p, proximaDataOriginal: null }));

  for (const indices of porEquipamento.values()) {
    if (indices.length < 2) continue;
    const porMes = new Map<string, number[]>();
    for (const i of indices) {
      const mes = planos[i].proximaData.slice(0, 7); // 'YYYY-MM'
      const lista = porMes.get(mes);
      if (lista) lista.push(i);
      else porMes.set(mes, [i]);
    }
    for (const idxDoMes of porMes.values()) {
      if (idxDoMes.length < 2) continue;
      const dataAlvo = idxDoMes.reduce(
        (min, i) => (planos[i].proximaData < min ? planos[i].proximaData : min),
        planos[idxDoMes[0]].proximaData,
      );
      for (const i of idxDoMes) {
        if (planos[i].proximaData !== dataAlvo) {
          resultado[i] = { ...resultado[i], proximaData: dataAlvo, proximaDataOriginal: planos[i].proximaData };
        }
      }
    }
  }
  return resultado;
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
    if (usados >= limite) continue;
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
  const totalPorEquipe = new Map<ChaveEquipeApoio, number>();
  for (const p of planosOrdenados) {
    const equipe = inferirCategoriaIndicadorPorTecnico(p.responsavel ?? '') ?? EQUIPE_APOIO_NAO_CLASSIFICADA;
    totalPorEquipe.set(equipe, (totalPorEquipe.get(equipe) ?? 0) + 1);
  }
  return [...totalPorEquipe.entries()]
    .map(([equipe, total]) => ({
      equipe, total, mostrados: Math.min(total, limitePorEquipe[equipe] ?? LIMITE_PADRAO_EQUIPE_NAO_CONFIGURADA),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface PlanoAtrasado extends PlanoComProximaData {
  prazoLimite: string;
}

// Planos cuja próxima execução já passou da tolerância (1/3 do período, ver
// dataLimiteComTolerancia) além da semana atual de verdade — independente da semana
// selecionada no filtro (ver preventivasAtrasadas no componente).
export function planosAtrasados(
  planos: PlanoComProximaData[], hojeInicioSemanaIso: string, plantaParada: boolean,
): PlanoAtrasado[] {
  return planos
    .map(p => {
      const efetiva = periodicidadeEfetiva(p.periodicidadeValor, p.periodicidadeUnidade, plantaParada);
      return { ...p, prazoLimite: dataLimiteComTolerancia(p.proximaData, efetiva.valor, efetiva.unidade) };
    })
    .filter((p): p is PlanoAtrasado => p.prazoLimite !== null && p.prazoLimite < hojeInicioSemanaIso)
    .sort((a, b) => a.proximaData.localeCompare(b.proximaData));
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
