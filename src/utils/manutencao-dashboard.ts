// Agregações puras do Dashboard da Programação — cada uma isolada e testável, sem
// depender de Angular/Supabase (mesmo padrão de manutencao-regras.ts).
import { calcularCapacidadeSemana, DiaSemana } from './manutencao-regras';

export interface KpiExecucao {
  programadas: number;
  executadas: number;
  percentual: number;
}

export function calcularKpiExecucao(ordens: { executada: boolean }[]): KpiExecucao {
  const programadas = ordens.length;
  const executadas = ordens.filter(o => o.executada).length;
  const percentual = programadas > 0 ? Math.round((executadas / programadas) * 100) : 0;
  return { programadas, executadas, percentual };
}

export interface HhEquipamento {
  equipamento: string;
  horas: number;
}

// Soma duracaoHoras por equipamento, ordenado do maior consumo pro menor — ordens sem
// equipamento preenchido ficam de fora (não tem o que agrupar).
export function hhPorEquipamento(ordens: { equipamento: string | null; duracaoHoras: number | null }[]): HhEquipamento[] {
  const mapa = new Map<string, number>();
  for (const o of ordens) {
    const eq = o.equipamento?.trim();
    if (!eq) continue;
    mapa.set(eq, (mapa.get(eq) ?? 0) + (o.duracaoHoras ?? 0));
  }
  return [...mapa.entries()]
    .map(([equipamento, horas]) => ({ equipamento, horas: Math.round(horas * 100) / 100 }))
    .sort((a, b) => b.horas - a.horas);
}

export interface HhTecnico {
  bruto: number;
  liquido: number;
  indisponivel: number;
}

// "Bruto" = disponibilidade nos dias úteis sem descontar nada (folga/férias/exame);
// "líquido" = calcularCapacidadeSemana (com os descontos, ver manutencao-regras.ts);
// "indisponível" = a diferença — HH perdido pra folga, férias ou exame médico.
export function calcularHhTecnico(params: {
  dias: DiaSemana[];
  disponibilidadePorDia: Map<string, number>;
  diasFolga: Set<string>;
  diasExameMedico: Set<string>;
  feriasIntervalo: { dataInicio: string; dataFim: string } | null;
}): HhTecnico {
  const bruto = params.dias
    .filter(d => d.label !== 'SAB' && d.label !== 'DOM')
    .reduce((soma, d) => soma + (params.disponibilidadePorDia.get(d.data) ?? 0), 0);
  const liquido = calcularCapacidadeSemana(params);
  return {
    bruto: Math.round(bruto * 100) / 100,
    liquido,
    indisponivel: Math.round((bruto - liquido) * 100) / 100,
  };
}
