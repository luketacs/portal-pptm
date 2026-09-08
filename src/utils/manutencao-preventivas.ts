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
