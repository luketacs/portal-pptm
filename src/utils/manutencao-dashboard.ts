// Agregações puras do Dashboard da Programação — cada uma isolada e testável, sem
// depender de Angular/Supabase (mesmo padrão de manutencao-regras.ts). Também usadas
// pelo Acompanhamento de Indicadores Semanais (mesma fonte de "executada").
import { calcularCapacidadeSemana, DiaSemana } from './manutencao-regras';
import { ConsultaSigmaResultado, ManutencaoOrdem } from '../models/manutencao-programacao.model';

function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

// A mesma OS pode aparecer em mais de uma linha (apoio dividido entre técnicos/áreas,
// ver "+ Apoio" na Programação) — sem agrupar por número antes de contar, cada apoio
// contava a OS de novo, inflando "Y programadas" e podendo contar 1 OS como executada
// mais de uma vez. Agrupa por número de OS e só considera executada quando TODOS os
// técnicos do grupo têm apontamento DELES batendo com o dia previsto — não "qualquer
// apontamento" na OS (um apoio de 2 pessoas onde só 1 aponta não está concluído,
// mesmo critério de statusExecucao()/atendimentoProgramacao() na Programação).
// `matchColaborador` é injetado (em vez de ApontamentosService direto) pra manter esta
// função pura/testável sem Angular.
export function ordemExecutadaAgrupada(
  ordens: ManutencaoOrdem[],
  sigmaPorOs: Record<string, ConsultaSigmaResultado>,
  diasSemanaFallback: string[],
  matchColaborador: (matricula: string | null, nome: string) => { matricula: string } | null,
): boolean[] {
  const porOs = new Map<string, ManutencaoOrdem[]>();
  let semOsIdx = 0;
  for (const o of ordens) {
    const chave = o.numeroOs?.trim() ? normalizarNumeroOs(o.numeroOs) : `__sem-os-${semOsIdx++}`;
    const lista = porOs.get(chave);
    if (lista) lista.push(o);
    else porOs.set(chave, [o]);
  }
  return [...porOs.values()].map(linhas => {
    if (!linhas[0].numeroOs?.trim()) return false;
    const resultado = sigmaPorOs[normalizarNumeroOs(linhas[0].numeroOs!)];
    if (!resultado) return false;
    return linhas.every(o => {
      const dias = o.diasPrevistos.length > 0 ? o.diasPrevistos : diasSemanaFallback;
      const colaborador = matchColaborador(o.tecnicoMatricula, o.tecnicoNome ?? '');
      return !!colaborador && resultado.apontamentos.some(a => a.executante === colaborador.matricula && dias.includes(a.data));
    });
  });
}

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
