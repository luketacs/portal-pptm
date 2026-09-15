// Agregações puras do Dashboard da Programação — cada uma isolada e testável, sem
// depender de Angular/Supabase (mesmo padrão de manutencao-regras.ts). Também usadas
// pelo Acompanhamento de Indicadores Semanais (mesma fonte de "executada").
import { calcularCapacidadeSemana, DiaSemana } from './manutencao-regras';
import { ConsultaSigmaResultado, ManutencaoOrdem } from '../models/manutencao-programacao.model';

function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

// Domingo da semana que começa em `segundaIso` ('YYYY-MM-DD' + 6 dias) — usado pra
// checar se um apontamento caiu dentro da semana da ordem, sem precisar de diasPrevistos.
function domingoDaSemana(segundaIso: string): string {
  const d = new Date(segundaIso + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

// A mesma OS pode aparecer em mais de uma linha (apoio dividido entre técnicos/áreas,
// ver "+ Apoio" na Programação) — sem agrupar por número antes de contar, cada apoio
// contava a OS de novo, inflando "Y programadas" e podendo contar 1 OS como executada
// mais de uma vez. Agrupa por número de OS e só considera executada quando TODOS os
// técnicos do grupo têm apontamento DELES dentro da SEMANA da ordem (semanaInicio até
// domingo) — não "qualquer apontamento" na OS (um apoio de 2 pessoas onde só 1 aponta
// não está concluído), mesmo critério de statusExecucao()/atendimentoProgramacao() na
// Programação. Antes exigia que a data do apontamento batesse com um dos dias
// PREVISTOS especificamente (diasPrevistos) — na prática, quando o técnico trocava de
// dia dentro da mesma semana (execução real em dia diferente do planejado), o
// apontamento existia mas nunca contava como "executada". `matchColaborador` é
// injetado (em vez de ApontamentosService direto) pra manter esta função pura/testável
// sem Angular.
//
// Apoio programa por EMPRESA/EQUIPE (tecnicoNome = "SERVPLEX"/"OPERAÇÃO"/"TOP
// ANDAIMES"...), não por pessoa cadastrada em matriculas.json (ver comentário em
// manutencao-programacao.component.ts) — matchColaborador nunca resolve um indivíduo
// pra esse texto, então `colaborador` vem null. Antes disso zerava a linha inteira
// (`!!colaborador &&` já falhava ali), fazendo TODA ordem de Apoio contar como "nunca
// executada" mesmo com apontamento real batendo no SIGMA (reportado: ordens de Apoio
// executadas na semana, aparecendo zeradas no Desempenho por Área). Sem uma pessoa
// específica pra cobrar, cai pra "qualquer apontamento bateu dentro da semana dessa
// OS" — mesmo princípio de sempre (semana inteira, não o dia previsto exato), só que
// sem exigir que o apontamento seja de uma matrícula em particular.
//
// Restrito a area==='APOIO': pra Elétrica/Mecânica um `colaborador` não resolvido quase
// sempre é indício de problema de dado (nome com typo não reconhecido nem como
// pessoa nem como equipe de Apoio) — mais seguro continuar marcando como "não
// executada" nesse caso do que aceitar qualquer apontamento da OS como se fosse
// daquele técnico específico. Só Apoio tem esse "sem pessoa específica pra cobrar" por
// design (programado por empresa/equipe, não por indivíduo).
export function ordemExecutadaAgrupada(
  ordens: ManutencaoOrdem[],
  sigmaPorOs: Record<string, ConsultaSigmaResultado>,
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
      const domingo = domingoDaSemana(o.semanaInicio);
      const dentroDaSemana = (a: { data: string }) => a.data >= o.semanaInicio && a.data <= domingo;
      const colaborador = matchColaborador(o.tecnicoMatricula, o.tecnicoNome ?? '');
      if (!colaborador) return o.area === 'APOIO' && resultado.apontamentos.some(dentroDaSemana);
      return resultado.apontamentos.some(a => a.executante === colaborador.matricula && dentroDaSemana(a));
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

export interface HhAtividade {
  atividade: string;
  horas: number;
}

// Mesma ideia de hhPorEquipamento, só que agrupando por descrição da ordem (a
// "atividade" em si) em vez de equipamento — mostra quais tipos de atividade
// consumiram mais HH no período, não em qual equipamento. Ordens sem descrição
// preenchida ficam de fora (não tem o que agrupar).
export function hhPorAtividade(ordens: { descricao: string | null; duracaoHoras: number | null }[]): HhAtividade[] {
  const mapa = new Map<string, number>();
  for (const o of ordens) {
    const desc = o.descricao?.trim();
    if (!desc) continue;
    mapa.set(desc, (mapa.get(desc) ?? 0) + (o.duracaoHoras ?? 0));
  }
  return [...mapa.entries()]
    .map(([atividade, horas]) => ({ atividade, horas: Math.round(horas * 100) / 100 }))
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
