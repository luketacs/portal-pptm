// Cálculo de "próxima data" dos planos de manutenção preventiva. Não existe uma coluna
// pra isso no banco — é sempre calculada em runtime a partir de `ultima_execucao +
// periodicidade` (mesmo espírito de manter matemática de datas fora do SQL, ver
// src/utils/manutencao-regras.ts).
export type PeriodicidadeUnidade = 'Dia(s)' | 'Semana(s)' | 'Mes(es)';

// `ultimaExecucao=null` (plano nunca executado) sempre retorna null — quem consome
// trata null como "vencido desde sempre" (ver preventivaVencendo).
export function calcularProximaData(
  ultimaExecucao: string | null, valor: number, unidade: PeriodicidadeUnidade,
): string | null {
  if (!ultimaExecucao) return null;
  const d = new Date(ultimaExecucao + 'T00:00:00');
  if (unidade === 'Dia(s)') d.setDate(d.getDate() + valor);
  else if (unidade === 'Semana(s)') d.setDate(d.getDate() + valor * 7);
  else d.setMonth(d.getMonth() + valor); // Mes(es)
  return d.toISOString().slice(0, 10);
}

// Vence especificamente DENTRO da semana em exibição (inicioSemanaIso a fimSemanaIso) —
// não é cumulativo: um plano com próxima data antes do início da semana selecionada
// pertence à semana em que ele foi programado pra aparecer (ver a redistribuição
// semanal feita nesta conversa), não a todas as semanas seguintes também. Sem isso, a
// mesma leva de planos reaparecia idêntica em toda semana futura, já que "vencido"
// nunca deixava de ser verdade. `proximaData=null` (nunca executada) sempre conta como
// vencendo, em qualquer semana, até ser programada.
export function preventivaVencendo(proximaData: string | null, inicioSemanaIso: string, fimSemanaIso: string): boolean {
  return proximaData === null || (proximaData >= inicioSemanaIso && proximaData <= fimSemanaIso);
}

function periodicidadeEmDias(valor: number, unidade: PeriodicidadeUnidade): number {
  if (unidade === 'Dia(s)') return valor;
  if (unidade === 'Semana(s)') return valor * 7;
  return valor * 30; // Mes(es) — mesma aproximação usada no resto do app pra 1 mês.
}

// Regra combinada com o usuário: uma preventiva não é considerada "atrasada de
// verdade" assim que passa da próxima data — tem tolerância de até 1/3 do período pra
// ser executada antes disso virar atraso real. Ex.: plano mensal (30 dias) vence no
// dia X, só conta como atrasado a partir de X + 10 dias (30/3). `proximaData=null`
// (nunca executada) não tem uma data-base pra somar tolerância, então não se aplica.
export function dataLimiteComTolerancia(
  proximaData: string | null, valor: number, unidade: PeriodicidadeUnidade,
): string | null {
  if (!proximaData) return null;
  const dias = Math.round(periodicidadeEmDias(valor, unidade) / 3);
  const d = new Date(proximaData + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// A empresa não opera 24h/dia — às vezes a planta fica meses parada, e nesses períodos
// não faz sentido manter o ritmo semanal/quinzenal de inspeção de equipamento parado.
// Enquanto a planta estiver marcada como parada (ver ParadaPlanta), todo plano de ciclo
// curto (Dia(s)/Semana(s)) é tratado como se fosse mensal só pra esse cálculo — o
// cadastro do plano em si não muda, volta ao normal assim que a parada é encerrada.
export function periodicidadeEfetiva(
  valor: number, unidade: PeriodicidadeUnidade, plantaParada: boolean,
): { valor: number; unidade: PeriodicidadeUnidade } {
  if (plantaParada && unidade !== 'Mes(es)') return { valor: 1, unidade: 'Mes(es)' };
  return { valor, unidade };
}
