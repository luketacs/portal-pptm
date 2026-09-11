import {
  calcularProximaData, dataLimiteComTolerancia, periodicidadeEfetiva, periodicidadeEmDias,
  preventivaVencendo, PeriodicidadeUnidade,
} from './manutencao-preventivas';
import { PlanoManutencao } from '../models/manutencao-programacao.model';

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
