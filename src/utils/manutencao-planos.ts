import {
  calcularProximaData, dataLimiteComTolerancia, periodicidadeEfetiva, periodicidadeEmDias,
  preventivaVencendo, PeriodicidadeUnidade,
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
