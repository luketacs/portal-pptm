// Geometria (em %) pra desenhar horas apontadas/programadas/disponíveis como um
// gráfico de barra tipo "meter": track = horas disponíveis (capacidade), preenchimento
// = horas apontadas (realizado), risco vertical = horas programadas (meta). Todos os
// colaboradores usam a MESMA escala (maior valor entre todos), pra comparar magnitude
// entre pessoas, não só a proporção dentro de cada uma.

import { ColaboradorHoras } from './relatorio-apontamentos';

export interface BarraHoras {
  matricula: string;
  funcionario: string;
  area: string;
  percApontada: number;          // 0-100, largura do preenchimento
  percDisponivel: number | null; // 0-100, largura do track (null = sem dado de Ponto)
  percProgramada: number | null; // 0-100, posição do risco de meta
  horasApontadas: number;
  horasProgramadas: number | null;
  horasDisponiveis: number | null;
  estourou: boolean; // apontada > disponível (sinal de algo fora do esperado)
}

export interface GraficoHorasDados {
  barras: BarraHoras[];
  escalaMaxima: number; // valor, em horas, que corresponde a 100% de largura
}

function round1(valor: number): number {
  return Math.round(valor * 10) / 10;
}

export function calcularGraficoHoras(colaboradores: ColaboradorHoras[]): GraficoHorasDados {
  const valores = colaboradores.flatMap(c => [c.horasApontadas, c.horasProgramadas ?? 0, c.horasDisponiveis ?? 0]);
  const maiorValor = Math.max(0, ...valores);
  const escalaMaxima = maiorValor > 0 ? maiorValor * 1.05 : 1; // folga de 5% pra barra não colar no limite

  const perc = (valor: number) => round1(Math.min((valor / escalaMaxima) * 100, 100));

  const barras: BarraHoras[] = colaboradores
    .map(c => ({
      matricula: c.matricula,
      funcionario: c.funcionario,
      area: c.area,
      percApontada: perc(c.horasApontadas),
      percDisponivel: c.horasDisponiveis !== null ? perc(c.horasDisponiveis) : null,
      percProgramada: c.horasProgramadas !== null ? perc(c.horasProgramadas) : null,
      horasApontadas: c.horasApontadas,
      horasProgramadas: c.horasProgramadas,
      horasDisponiveis: c.horasDisponiveis,
      estourou: c.horasDisponiveis !== null && c.horasApontadas > c.horasDisponiveis,
    }))
    .sort((a, b) => b.horasApontadas - a.horasApontadas);

  return { barras, escalaMaxima: round1(escalaMaxima) };
}
