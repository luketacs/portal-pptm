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
//
// 'parcial': quando a OS é dividida entre 2+ técnicos e SÓ ALGUNS apontaram dentro da
// semana (não todos, mas também não nenhum) — reportado: um técnico aponta, a linha
// DELE já vira "Executada" na Programação (statusExecucao(), que é por linha), mas o
// indicador (aqui, agrupado por OS) continha só true/false e ficava preso em "não
// executada" até o(s) colega(s) da mesma OS também apontarem, sem nenhuma sinalização
// intermediária. Pedido do usuário: distinguir esse caso ("falta só uma parte") de uma
// OS onde ninguém apontou nada ainda.
export type StatusExecucaoGrupo = 'executada' | 'parcial' | 'nao-executada';

export function ordemExecutadaAgrupada(
  ordens: ManutencaoOrdem[],
  sigmaPorOs: Record<string, ConsultaSigmaResultado>,
  matchColaborador: (matricula: string | null, nome: string) => { matricula: string } | null,
): StatusExecucaoGrupo[] {
  const porOs = new Map<string, ManutencaoOrdem[]>();
  let semOsIdx = 0;
  for (const o of ordens) {
    const chave = o.numeroOs?.trim() ? `${o.semanaInicio}:${normalizarNumeroOs(o.numeroOs)}` : `__sem-os-${semOsIdx++}`;
    const lista = porOs.get(chave);
    if (lista) lista.push(o);
    else porOs.set(chave, [o]);
  }
  return [...porOs.values()].map(linhas => {
    if (!linhas[0].numeroOs?.trim()) return 'nao-executada';
    const resultado = sigmaPorOs[normalizarNumeroOs(linhas[0].numeroOs!)];
    if (!resultado) return 'nao-executada';
    const apontou = linhas.map(o => {
      const domingo = domingoDaSemana(o.semanaInicio);
      const dentroDaSemana = (a: { data: string }) => a.data >= o.semanaInicio && a.data <= domingo;
      const colaborador = matchColaborador(o.tecnicoMatricula, o.tecnicoNome ?? '');
      if (!colaborador) return o.area === 'APOIO' && resultado.apontamentos.some(dentroDaSemana);
      return resultado.apontamentos.some(a => a.executante === colaborador.matricula && dentroDaSemana(a));
    });
    if (apontou.every(Boolean)) return 'executada';
    if (apontou.some(Boolean)) return 'parcial';
    return 'nao-executada';
  });
}

// Soma as horas REAIS apontadas por UM colaborador específico (matrícula), dentro da
// semana de cada ordem — reportado: "horas apontadas" estava contando a duração
// PROGRAMADA da ordem inteira assim que ela virava "executada" (ver
// ordemExecutadaAgrupada acima), não o que a pessoa de fato apontou no SIGMA. Um
// colaborador com uma ordem de 8h programada que apontou só 2h (ou nem apontou, e
// outro colega da mesma OS que apontou fez a ordem contar como "executada") aparecia
// com 8h "apontadas" — número que não existe em lugar nenhum do apontamento real dele.
// Agrupa por número de OS (mesmo motivo de ordemExecutadaAgrupada: apoio dividido
// entre 2+ linhas da mesma OS não pode somar o apontamento da mesma pessoa 2x) e soma
// só os apontamentos cujo executante bate com a matrícula recebida, dentro da semana
// da ordem (segunda até domingo, mesmo critério de "dentro da semana" de sempre — não
// só os dias PREVISTOS, pra cobrir troca de dia dentro da mesma semana).
export function horasApontadasDoColaborador(
  ordens: ManutencaoOrdem[],
  sigmaPorOs: Record<string, ConsultaSigmaResultado>,
  matricula: string,
): number {
  const porOs = new Map<string, ManutencaoOrdem[]>();
  let semOsIdx = 0;
  for (const o of ordens) {
    const chave = o.numeroOs?.trim() ? `${o.semanaInicio}:${normalizarNumeroOs(o.numeroOs)}` : `__sem-os-${semOsIdx++}`;
    const lista = porOs.get(chave);
    if (lista) lista.push(o);
    else porOs.set(chave, [o]);
  }

  let total = 0;
  for (const linhas of porOs.values()) {
    if (!linhas[0].numeroOs?.trim()) continue;
    const resultado = sigmaPorOs[normalizarNumeroOs(linhas[0].numeroOs!)];
    if (!resultado) continue;
    const domingo = domingoDaSemana(linhas[0].semanaInicio);
    for (const a of resultado.apontamentos) {
      if (a.executante !== matricula) continue;
      if (a.data < linhas[0].semanaInicio || a.data > domingo) continue;
      total += a.horas ?? 0;
    }
  }
  return total;
}

export interface KpiExecucao {
  programadas: number;
  executadas: number;
  percentual: number;
}

// Pedido do usuário: pro indicador (Acompanhamento de Indicadores), uma OS 'parcial'
// (2+ técnicos, só alguns apontaram) conta como executada — se pelo menos um já fez a
// parte dele, o serviço em si está considerado feito pro indicador, mesmo faltando
// algum apontamento individual (caso real: OS 047664, Xavier Bruno apontou EXEC,
// Mauro Teixeira ainda não apontou a dele). Diferente da aba de Programação
// (statusExecucao()/atendimentoProgramacao() em manutencao-programacao.component.ts),
// que continua tratando 'parcial' à parte — lá interessa saber exatamente quem ainda
// não apontou, aqui não.
export function calcularKpiExecucao(ordens: { status: StatusExecucaoGrupo }[]): KpiExecucao {
  const programadas = ordens.length;
  const executadas = ordens.filter(o => o.status !== 'nao-executada').length;
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

// "Bruto" = disponibilidade nos dias úteis sem descontar nada; "líquido" =
// calcularCapacidadeSemana (com os descontos, ver manutencao-regras.ts), mas só de
// folga e férias — pedido do usuário: exame médico e treinamento contam como HH
// disponível normalmente (a pessoa está "no expediente", só não em campo numa OS),
// diferente de folga/férias, que tiram a pessoa do dia por completo. Por isso passa
// diasExameMedico vazio pra calcularCapacidadeSemana (não recebe horasTreinamentoPorDia
// nenhum, então treinamento já nunca descontava aqui) — calcularCapacidadeSemana em si
// continua descontando exame/treinamento normalmente pra quem a usa direto (capacidade/
// saldo da Programação, onde esse desconto é intencional, ver "Quanto desconta da
// capacidade" no formulário de Treinamento). "Indisponível" = a diferença — HH perdido
// só pra folga, férias ou atestado médico agora.
export function calcularHhTecnico(params: {
  dias: DiaSemana[];
  disponibilidadePorDia: Map<string, number>;
  diasFolga: Set<string>;
  feriasIntervalo: { dataInicio: string; dataFim: string } | null;
  atestadoIntervalo?: { dataInicio: string; dataFim: string } | null;
}): HhTecnico {
  const bruto = params.dias
    .filter(d => d.label !== 'SAB' && d.label !== 'DOM')
    .reduce((soma, d) => soma + (params.disponibilidadePorDia.get(d.data) ?? 0), 0);
  const liquido = calcularCapacidadeSemana({ ...params, diasExameMedico: new Set() });
  return {
    bruto: Math.round(bruto * 100) / 100,
    liquido,
    indisponivel: Math.round((bruto - liquido) * 100) / 100,
  };
}
