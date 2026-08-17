// Port do gerador de Relatório Mensal PCM (antes um app desktop em Python —
// Indicadores2k26/mensal.py). Fase 1: KPIs do mês + acumulado do ano (atendimento à
// programação, cumprimento do plano), por área e geral, com as mesmas regras de
// destaques/pontos de atenção. A reconciliação de horas por colaborador (PDF de
// ponto, backlog etc.) fica para uma fase seguinte.
//
// IMPORTANTE: ao contrário do original, a localização de colunas/linhas na planilha
// é feita por busca (procurando os rótulos "JAN"/"MECÂNICA"/"Geral" etc.), não por
// índice fixo. O código Python tinha JAN hardcoded na coluna 7 e a coluna acumulada
// na 19 — validei contra a planilha real e hoje JAN está na coluna 6 e a coluna
// acumulada na 18 (um a menos em cada). Buscar pelo rótulo evita repetir esse tipo
// de descompasso se a planilha for reorganizada de novo no futuro.

import { AcaoPrioritaria, Destaque, PontoAtencao } from './relatorio-semanal-pcm';
import { PontoLinhaTempo } from './relatorio-linha-tempo';

export const META_ATENDIMENTO_MENSAL = 91.0;
export const META_CUMPRIMENTO_MENSAL = 93.0;

export const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;
export type MesAbrev = typeof MESES_ABREV[number];

export const MESES_COMPLETO: Record<MesAbrev, string> = {
  JAN: 'Janeiro', FEV: 'Fevereiro', MAR: 'Março', ABR: 'Abril', MAI: 'Maio', JUN: 'Junho',
  JUL: 'Julho', AGO: 'Agosto', SET: 'Setembro', OUT: 'Outubro', NOV: 'Novembro', DEZ: 'Dezembro',
};

export const AREAS_PCM_MENSAL = [
  'MECÂNICA', 'ELÉTRICA', 'LUBRIFICAÇÃO', 'OPERAÇÃO', 'LIMPEZA OPERACIONAL', 'REFRIGERAÇÃO', 'SPCI',
];

export type StatusGeralMensal = 'Dentro da Meta' | 'Próximo da Meta' | 'Abaixo da Meta';

export interface AreaMensal {
  area: string;
  programadas: number;
  executadas: number;
  naoExecutadas: number;
  foraProgramacao: number;
  planejadasPlano: number;
  executadasPlano: number;
  naoExecutadasPlano: number;
  atendimento: number;
  cumprimento: number;
}

export interface DadosMensal {
  mes: MesAbrev;
  mesCompleto: string;
  ano: number;
  periodoMes: string;
  dataInicio: string;
  dataFim: string;
  diasPeriodo: number;
  atendimentoGeral: number;
  cumprimentoGeral: number;
  totalProgramadas: number;
  totalExecutadas: number;
  totalNaoExecutadas: number;
  totalForaProgramacao: number;
  totalPlanejadasPlano: number;
  totalExecutadasPlano: number;
  totalNaoExecutadasPlano: number;
  detalhesAreas: AreaMensal[];
  statusGeral: StatusGeralMensal;
  metaAtendimento: number;
  metaCumprimento: number;
}

export interface DadosAcumulado {
  mes: MesAbrev;
  ano: number;
  periodoAcumulado: string;
  atendimentoGeral: number;
  cumprimentoGeral: number;
  percentualForaProgramacao: number;
  totalProgramadas: number;
  totalExecutadas: number;
  totalNaoExecutadas: number;
  totalForaProgramacao: number;
  totalPlanejadasPlano: number;
  totalExecutadasPlano: number;
  totalNaoExecutadasPlano: number;
  detalhesAreas: AreaMensal[];
  statusGeral: StatusGeralMensal;
  metaAtendimento: number;
  metaCumprimento: number;
  qtdMeses: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatarDataBr(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function parseDataBr(str: string | undefined | null): Date | null {
  if (!str) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function limitesDoMes(mes: MesAbrev, ano: number): { inicio: Date; fim: Date } {
  const idx = MESES_ABREV.indexOf(mes);
  const inicio = new Date(Date.UTC(ano, idx, 1));
  const fim = idx === 11 ? new Date(Date.UTC(ano, 11, 31)) : new Date(Date.UTC(ano, idx + 1, 1) - 86400000);
  return { inicio, fim };
}

function normalizarRotulo(valor: unknown): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function safeConvert(valor: unknown): number {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'string' && valor.includes('%')) {
    const n = parseFloat(valor.replace('%', '').replace(',', '.').trim());
    return Number.isFinite(n) ? n / 100 : 0;
  }
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Índice de cumprimento pode vir como fração (0.95) ou como número inteiro (95) —
// mesma checagem defensiva do original.
function normalizarIndice(v: number): number {
  return v > 1 ? v / 100 : v;
}

function classificarStatus(atendimento: number, cumprimento: number): StatusGeralMensal {
  if (atendimento >= META_ATENDIMENTO_MENSAL && cumprimento >= META_CUMPRIMENTO_MENSAL) return 'Dentro da Meta';
  if (atendimento >= META_ATENDIMENTO_MENSAL * 0.9 || cumprimento >= META_CUMPRIMENTO_MENSAL * 0.9) return 'Próximo da Meta';
  return 'Abaixo da Meta';
}

// Acha a linha de cabeçalho dos meses procurando "JAN" — ele aparece duas vezes
// nessa linha (bloco de atendimento à programação, depois bloco de cumprimento do
// plano), sempre nessa ordem da esquerda pra direita.
export function localizarCabecalhoMeses(rows: unknown[][]): { colAtendimentoJan: number; colPlanoJan: number } {
  for (const row of rows) {
    if (!row) continue;
    const jans: number[] = [];
    for (let c = 0; c < row.length; c++) {
      if (normalizarRotulo(row[c]) === 'JAN') jans.push(c);
    }
    if (jans.length >= 2) return { colAtendimentoJan: jans[0], colPlanoJan: jans[1] };
  }
  throw new Error('Não foi possível localizar o cabeçalho dos meses (JAN...DEZ) na aba "Indicadores Mensais".');
}

// Acha a linha de um rótulo (nome de área, ou "Geral") na primeira coluna.
export function localizarLinhaRotulo(rows: unknown[][], rotulo: string): number {
  const alvo = normalizarRotulo(rotulo);
  for (let r = 0; r < rows.length; r++) {
    if (normalizarRotulo(rows[r]?.[0]) === alvo) return r;
  }
  throw new Error(`"${rotulo}" não encontrado na aba "Indicadores Mensais".`);
}

export function parseIndicadoresMensais(
  rows: unknown[][], mes: MesAbrev, ano: number, dataInicioStr?: string, dataFimStr?: string,
): { dadosMensal: DadosMensal; dadosAcumulado: DadosAcumulado } {
  const mesIdx = MESES_ABREV.indexOf(mes);
  if (mesIdx === -1) throw new Error(`Mês inválido: ${mes}`);

  const cab = localizarCabecalhoMeses(rows);
  const colMes = cab.colAtendimentoJan + mesIdx;
  const colMesPlano = cab.colPlanoJan + mesIdx;
  const colAcumulado = cab.colAtendimentoJan + 12;
  const colAcumuladoPlano = cab.colPlanoJan + 12;

  const linhaGeral = localizarLinhaRotulo(rows, 'Geral');
  const cell = (r: number, c: number) => safeConvert(rows[r]?.[c]);

  const programadas = cell(linhaGeral, colMes);
  const executadas = cell(linhaGeral + 1, colMes);
  const naoExecutadas = cell(linhaGeral + 2, colMes);
  const indice = normalizarIndice(cell(linhaGeral + 3, colMes));
  const foraProgramacao = cell(linhaGeral + 4, colMes);

  const programadasPlano = cell(linhaGeral, colMesPlano);
  const executadasPlano = cell(linhaGeral + 1, colMesPlano);
  const naoExecutadasPlano = cell(linhaGeral + 2, colMesPlano);
  const indicePlano = normalizarIndice(cell(linhaGeral + 3, colMesPlano));

  const programadasAcum = cell(linhaGeral, colAcumulado);
  const executadasAcum = cell(linhaGeral + 1, colAcumulado);
  const naoExecutadasAcum = cell(linhaGeral + 2, colAcumulado);
  const indiceAcum = normalizarIndice(cell(linhaGeral + 3, colAcumulado));
  const foraProgramacaoAcum = cell(linhaGeral + 4, colAcumulado);

  const programadasPlanoAcum = cell(linhaGeral, colAcumuladoPlano);
  const executadasPlanoAcum = cell(linhaGeral + 1, colAcumuladoPlano);
  const naoExecutadasPlanoAcum = cell(linhaGeral + 2, colAcumuladoPlano);
  const indicePlanoAcum = normalizarIndice(cell(linhaGeral + 3, colAcumuladoPlano));

  const atendimentoGeral = round2(programadas > 0 ? (executadas / programadas) * 100 : (indice > 0 ? indice * 100 : 0));
  const cumprimentoGeral = round2(programadasPlano > 0 ? (executadasPlano / programadasPlano) * 100 : (indicePlano > 0 ? indicePlano * 100 : 0));
  const atendimentoAcum = round2(programadasAcum > 0 ? (executadasAcum / programadasAcum) * 100 : (indiceAcum > 0 ? indiceAcum * 100 : 0));
  const cumprimentoAcum = round2(programadasPlanoAcum > 0 ? (executadasPlanoAcum / programadasPlanoAcum) * 100 : (indicePlanoAcum > 0 ? indicePlanoAcum * 100 : 0));
  const percentualForaProgramacaoAcum = round2(programadasAcum > 0 ? (foraProgramacaoAcum / programadasAcum) * 100 : 0);

  // O status geral do acumulado reaproveita o do mês — assim o original também fazia
  // (não é recalculado separadamente a partir dos números acumulados).
  const statusGeral = classificarStatus(atendimentoGeral, cumprimentoGeral);

  const limites = limitesDoMes(mes, ano);
  const dataInicio = parseDataBr(dataInicioStr) ?? limites.inicio;
  const dataFim = parseDataBr(dataFimStr) ?? limites.fim;
  const periodoMes = `${formatarDataBr(dataInicio)} a ${formatarDataBr(dataFim)}`;
  const diasPeriodo = Math.round((dataFim.getTime() - dataInicio.getTime()) / 86400000) + 1;
  const periodoAcumulado = `${formatarDataBr(new Date(Date.UTC(ano, 0, 1)))} a ${formatarDataBr(dataFim)}`;

  const detalhesAreas: AreaMensal[] = AREAS_PCM_MENSAL.map(nome => {
    const linhaBase = localizarLinhaRotulo(rows, nome);
    const p = cell(linhaBase, colMes);
    const e = cell(linhaBase + 1, colMes);
    const ne = cell(linhaBase + 2, colMes);
    const idx = normalizarIndice(cell(linhaBase + 3, colMes));
    const pp = cell(linhaBase, colMesPlano);
    const ep = cell(linhaBase + 1, colMesPlano);
    const nep = cell(linhaBase + 2, colMesPlano);
    const idxp = normalizarIndice(cell(linhaBase + 3, colMesPlano));

    return {
      area: nome,
      programadas: Math.trunc(p),
      executadas: Math.trunc(e),
      naoExecutadas: Math.trunc(ne),
      foraProgramacao: 0, // não existe por área nessa aba, só no total geral
      planejadasPlano: Math.trunc(pp),
      executadasPlano: Math.trunc(ep),
      naoExecutadasPlano: Math.trunc(nep),
      atendimento: round2(p > 0 ? (e / p) * 100 : (idx > 0 ? idx * 100 : 0)),
      cumprimento: round2(pp > 0 ? (ep / pp) * 100 : (idxp > 0 ? idxp * 100 : 0)),
    };
  });

  const dadosMensal: DadosMensal = {
    mes, mesCompleto: MESES_COMPLETO[mes], ano, periodoMes,
    dataInicio: formatarDataBr(dataInicio), dataFim: formatarDataBr(dataFim), diasPeriodo,
    atendimentoGeral, cumprimentoGeral,
    totalProgramadas: Math.trunc(programadas),
    totalExecutadas: Math.trunc(executadas),
    totalNaoExecutadas: Math.trunc(naoExecutadas),
    totalForaProgramacao: Math.trunc(foraProgramacao),
    totalPlanejadasPlano: Math.trunc(programadasPlano),
    totalExecutadasPlano: Math.trunc(executadasPlano),
    totalNaoExecutadasPlano: Math.trunc(naoExecutadasPlano),
    detalhesAreas, statusGeral,
    metaAtendimento: META_ATENDIMENTO_MENSAL, metaCumprimento: META_CUMPRIMENTO_MENSAL,
  };

  const dadosAcumulado: DadosAcumulado = {
    mes, ano, periodoAcumulado,
    atendimentoGeral: atendimentoAcum, cumprimentoGeral: cumprimentoAcum,
    percentualForaProgramacao: percentualForaProgramacaoAcum,
    totalProgramadas: Math.trunc(programadasAcum),
    totalExecutadas: Math.trunc(executadasAcum),
    totalNaoExecutadas: Math.trunc(naoExecutadasAcum),
    totalForaProgramacao: Math.trunc(foraProgramacaoAcum),
    totalPlanejadasPlano: Math.trunc(programadasPlanoAcum),
    totalExecutadasPlano: Math.trunc(executadasPlanoAcum),
    totalNaoExecutadasPlano: Math.trunc(naoExecutadasPlanoAcum),
    detalhesAreas, // mesma estrutura do mês — o original também reaproveita, não recalcula por área no acumulado
    statusGeral, metaAtendimento: META_ATENDIMENTO_MENSAL, metaCumprimento: META_CUMPRIMENTO_MENSAL,
    qtdMeses: mesIdx + 1,
  };

  return { dadosMensal, dadosAcumulado };
}

// Histórico mês a mês (JAN..mesAte) pra linha do tempo do acumulado — pula meses
// sem nenhuma ordem programada (ainda não chegaram / planilha não preenchida).
export function extrairHistoricoMeses(rows: unknown[][], mesAte: MesAbrev): PontoLinhaTempo[] {
  const cab = localizarCabecalhoMeses(rows);
  const linhaGeral = localizarLinhaRotulo(rows, 'Geral');
  const mesAteIdx = MESES_ABREV.indexOf(mesAte);
  const cell = (r: number, c: number) => safeConvert(rows[r]?.[c]);

  const pontos: PontoLinhaTempo[] = [];
  for (let i = 0; i <= mesAteIdx; i++) {
    const col = cab.colAtendimentoJan + i;
    const colPlano = cab.colPlanoJan + i;

    const programadas = cell(linhaGeral, col);
    if (programadas === 0) continue;

    const executadas = cell(linhaGeral + 1, col);
    const indice = normalizarIndice(cell(linhaGeral + 3, col));
    const programadasPlano = cell(linhaGeral, colPlano);
    const executadasPlano = cell(linhaGeral + 1, colPlano);
    const indicePlano = normalizarIndice(cell(linhaGeral + 3, colPlano));

    pontos.push({
      label: MESES_ABREV[i],
      atendimento: round2(programadas > 0 ? (executadas / programadas) * 100 : (indice > 0 ? indice * 100 : 0)),
      cumprimento: round2(programadasPlano > 0 ? (executadasPlano / programadasPlano) * 100 : (indicePlano > 0 ? indicePlano * 100 : 0)),
    });
  }
  return pontos;
}

export function analisarPontosAtencaoEAcoesMensal(
  dadosMensal: DadosMensal, dadosAcumulado: DadosAcumulado | null,
): { pontosAtencao: PontoAtencao[]; acoesPrioritarias: AcaoPrioritaria[] } {
  const pontosAtencao: PontoAtencao[] = [];
  let acoesPrioritarias: AcaoPrioritaria[] = [];

  if (dadosMensal.statusGeral === 'Abaixo da Meta') {
    pontosAtencao.push({
      tipo: 'critico', titulo: 'ABAIXO DA META - AÇÃO NECESSÁRIA',
      descricao: `O período ${dadosMensal.periodoMes} ficou abaixo da meta: ${dadosMensal.atendimentoGeral}% de atendimento e ${dadosMensal.cumprimentoGeral}% de cumprimento.`,
      severidade: 'alta',
    });
    acoesPrioritarias.push({ prioridade: 'urgente', acao: 'Agendar reunião de emergência para análise do período', prazo: 'Hoje mesmo', responsavel: 'Gestores' });
  } else if (dadosMensal.statusGeral === 'Próximo da Meta') {
    pontosAtencao.push({
      tipo: 'alerta', titulo: 'PRÓXIMO DA META - MONITORAMENTO REFORÇADO',
      descricao: `Os indicadores do período ${dadosMensal.periodoMes} estão próximos das metas. Vamos acompanhar de perto.`,
      severidade: 'media',
    });
    acoesPrioritarias.push({ prioridade: 'alta', acao: 'Revisar os planos de ação para o próximo período', prazo: 'Amanhã', responsavel: 'Coordenadores' });
  } else {
    pontosAtencao.push({
      tipo: 'positivo', titulo: 'BOM TRABALHO - META ATINGIDA',
      descricao: `Excelente! Conseguimos atingir as metas no período ${dadosMensal.periodoMes}. Vamos manter esse ritmo!`,
      severidade: 'baixa',
    });
    acoesPrioritarias.push({ prioridade: 'media', acao: 'Documentar as melhores práticas do período', prazo: 'Esta semana', responsavel: 'Lideranças' });
  }

  if (dadosAcumulado) {
    const difAtendimento = dadosMensal.atendimentoGeral - dadosAcumulado.atendimentoGeral;
    if (difAtendimento > 2) {
      pontosAtencao.push({
        tipo: 'melhoria', titulo: 'MELHORIA NO ATENDIMENTO',
        descricao: `Ótima evolução! O atendimento deste período está ${difAtendimento.toFixed(1)}% acima da média acumulada.`,
        severidade: 'baixa',
      });
    } else if (difAtendimento < -2) {
      pontosAtencao.push({
        tipo: 'queda', titulo: 'QUEDA NO ATENDIMENTO',
        descricao: `Atenção: O atendimento deste período está ${Math.abs(difAtendimento).toFixed(1)}% abaixo da média acumulada.`,
        severidade: 'media',
      });
    }
  }

  if (dadosMensal.totalNaoExecutadas > 0) {
    let mensagem: string;
    let severidade: PontoAtencao['severidade'];
    if (dadosMensal.totalNaoExecutadas < 10) {
      mensagem = `Identificamos ${dadosMensal.totalNaoExecutadas} OSs não executadas no período.`;
      severidade = 'media';
    } else {
      mensagem = `Precisamos dar atenção especial às ${dadosMensal.totalNaoExecutadas} OSs pendentes.`;
      severidade = 'alta';
    }
    pontosAtencao.push({ tipo: 'pendente', titulo: 'OSs PENDENTES DE EXECUÇÃO', descricao: mensagem, severidade });
    acoesPrioritarias.push({ prioridade: 'alta', acao: `Planejar execução das ${dadosMensal.totalNaoExecutadas} OSs pendentes`, prazo: 'Próximo período', responsavel: 'Planejamento' });
  }

  if (dadosMensal.totalForaProgramacao > 0) {
    pontosAtencao.push({
      tipo: 'desvio', titulo: 'ATIVIDADES FORA DO PLANEJADO',
      descricao: `Realizamos ${dadosMensal.totalForaProgramacao} atividades fora da programação original.`,
      severidade: 'media',
    });
  }

  if (dadosAcumulado && dadosAcumulado.percentualForaProgramacao > 20) {
    pontosAtencao.push({
      tipo: 'alta_fora_programacao', titulo: 'ALTA TAXA DE ATIVIDADES NÃO PLANEJADAS',
      descricao: `Acumulado: ${dadosAcumulado.percentualForaProgramacao}% das atividades foram fora da programação. Necessário revisar planejamento.`,
      severidade: 'alta',
    });
    acoesPrioritarias.push({ prioridade: 'alta', acao: 'Revisar processo de planejamento para reduzir atividades não programadas', prazo: '2 semanas', responsavel: 'Planejamento e Supervisão' });
  }

  const mesIdx = MESES_ABREV.indexOf(dadosMensal.mes);
  if (mesIdx + 1 < MESES_ABREV.length) {
    const proximoMes = MESES_ABREV[mesIdx + 1];
    acoesPrioritarias.push({
      prioridade: 'media', acao: `Preparar planejamento para ${MESES_COMPLETO[proximoMes]}`,
      prazo: 'Última semana do período', responsavel: 'Equipe de Planejamento',
    });
  }

  const prioridadeOrdem: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };
  acoesPrioritarias = [...acoesPrioritarias].sort((a, b) => (prioridadeOrdem[a.prioridade] ?? 4) - (prioridadeOrdem[b.prioridade] ?? 4));

  return { pontosAtencao: pontosAtencao.slice(0, 5), acoesPrioritarias: acoesPrioritarias.slice(0, 5) };
}

export function gerarDestaquesMensal(dadosMensal: DadosMensal, dadosAcumulado: DadosAcumulado | null): Destaque[] {
  const destaques: Destaque[] = [];

  if (dadosMensal.atendimentoGeral >= dadosMensal.metaAtendimento && dadosMensal.cumprimentoGeral >= dadosMensal.metaCumprimento) {
    destaques.push({ icon: 'fa-flag-checkered', tipo: 'meta_atingida', texto: 'METAS CONQUISTADAS!', detalhe: `${dadosMensal.periodoMes}: Atendimento ${dadosMensal.atendimentoGeral}% | Cumprimento ${dadosMensal.cumprimentoGeral}%` });
  }
  if (dadosMensal.atendimentoGeral >= 95) {
    destaques.push({ icon: 'fa-chart-line', tipo: 'bom_atendimento', texto: 'EXCELENTE ATENDIMENTO', detalhe: `${dadosMensal.atendimentoGeral}% de atendimento à programação` });
  }
  if (dadosMensal.cumprimentoGeral >= 95) {
    destaques.push({ icon: 'fa-clipboard-check', tipo: 'bom_cumprimento', texto: 'ÓTIMO CUMPRIMENTO', detalhe: `${dadosMensal.cumprimentoGeral}% de cumprimento do plano` });
  }
  if (dadosMensal.totalNaoExecutadas === 0) {
    destaques.push({ icon: 'fa-check-double', tipo: 'sem_pendencias', texto: '100% DE EXECUÇÃO', detalhe: 'Todas as OSs programadas foram executadas!' });
  }
  if (dadosAcumulado) {
    const difAtendimento = dadosMensal.atendimentoGeral - dadosAcumulado.atendimentoGeral;
    if (difAtendimento > 1) {
      destaques.push({ icon: 'fa-chart-line-up', tipo: 'evolucao', texto: 'EVOLUÇÃO POSITIVA', detalhe: `Atendimento ${difAtendimento.toFixed(1)}% acima da média acumulada` });
    }
  }
  if (dadosMensal.diasPeriodo > 35) {
    destaques.push({ icon: 'fa-calendar-alt', tipo: 'periodo_longo', texto: 'PERÍODO LONGO', detalhe: `${dadosMensal.diasPeriodo} dias de acompanhamento` });
  } else if (dadosMensal.diasPeriodo < 25) {
    destaques.push({ icon: 'fa-calendar-alt', tipo: 'periodo_curto', texto: 'PERÍODO CURTO', detalhe: `${dadosMensal.diasPeriodo} dias de acompanhamento` });
  }

  return destaques.slice(0, 4);
}
