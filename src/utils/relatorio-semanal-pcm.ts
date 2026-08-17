// Port do gerador de Relatório Semanal PCM (antes um app desktop em Python —
// Indicadores2k26/semanal.py). Lê a mesma planilha "Painel de Indicadores de PCM"
// (aba "Indicadores Semanais", sem cabeçalho — leitura por posição fixa de linha/coluna,
// igual ao original) e reproduz fielmente as mesmas fórmulas de indicador e as mesmas
// regras de destaques/pontos de atenção/ações prioritárias.

export type StatusGeralSemana = 'EM DIA' | 'ATENÇÃO' | 'CRÍTICO';
export type ModoCalendarioSemana = 'ISO' | 'SIMPLES';

export const META_ATENDIMENTO = 91.0;
export const META_CUMPRIMENTO = 93.0;

// Linha (0-indexada, igual pandas) onde começa cada bloco de área na planilha.
// Offsets dentro do bloco: +0 Programadas, +1 Executadas, +2 Não Executadas,
// +3 Planejadas Plano, +4 Executadas Plano, +5 Não Exec. Plano, +6 Fora Programação.
export const AREAS_PCM: { nome: string; linhaBase: number }[] = [
  { nome: 'MECÂNICA', linhaBase: 7 },
  { nome: 'ELÉTRICA', linhaBase: 17 },
  { nome: 'LUBRIFICAÇÃO', linhaBase: 27 },
  { nome: 'LIMP OPERACIONAL', linhaBase: 37 },
  { nome: 'OPERAÇÃO', linhaBase: 47 },
  { nome: 'REFRIGERAÇÃO', linhaBase: 57 },
  { nome: 'SPCI', linhaBase: 67 },
];

// Linha onde ficam os números das semanas (cabeçalho das colunas).
const LINHA_SEMANAS = 5;

export interface AreaSemana {
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

export interface DadosSemana {
  semana: number;
  ano: number;
  periodoSemana: string;
  dataInicio: string;
  dataFim: string;
  atendimentoGeral: number;
  cumprimentoGeral: number;
  totalProgramadas: number;
  totalExecutadas: number;
  totalNaoExecutadas: number;
  totalForaProgramacao: number;
  totalPlanejadasPlano: number;
  totalExecutadasPlano: number;
  totalNaoExecutadasPlano: number;
  detalhesAreas: AreaSemana[];
  statusGeral: StatusGeralSemana;
  metaAtendimento: number;
  metaCumprimento: number;
}

export interface PontoAtencao {
  tipo: string;
  titulo: string;
  descricao: string;
  severidade: 'alta' | 'media' | 'baixa';
}

export interface AcaoPrioritaria {
  prioridade: 'urgente' | 'alta' | 'media' | 'baixa';
  acao: string;
  prazo: string;
  responsavel: string;
}

export interface Destaque {
  icon: string;
  tipo: string;
  texto: string;
  detalhe: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatarData(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Data do dia N (1=segunda..7=domingo) da semana ISO — equivalente a
// date.fromisocalendar(ano, semana, dia) do Python.
function dataIsoSemana(ano: number, semana: number, dia: number): Date {
  const jan4 = new Date(Date.UTC(ano, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // segunda=1..domingo=7
  const segundaSemana1 = new Date(jan4);
  segundaSemana1.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  const resultado = new Date(segundaSemana1);
  resultado.setUTCDate(segundaSemana1.getUTCDate() + (semana - 1) * 7 + (dia - 1));
  return resultado;
}

export function calcularPeriodoSemana(
  semana: number, ano: number, modo: ModoCalendarioSemana = 'ISO',
): { inicio: string; fim: string } {
  if (!(semana >= 1 && semana <= 53)) {
    throw new Error(`Semana invalida: ${semana}. Use valores entre 1 e 53.`);
  }

  if (modo === 'ISO') {
    return { inicio: formatarData(dataIsoSemana(ano, semana, 1)), fim: formatarData(dataIsoSemana(ano, semana, 7)) };
  }

  // Modo SIMPLES: semana 1 começa na primeira segunda-feira do ano.
  const dataRef = new Date(Date.UTC(ano, 0, 1));
  const pyWeekday = (dataRef.getUTCDay() + 6) % 7; // segunda=0..domingo=6
  const diasParaPrimeiraSegunda = ((0 - pyWeekday) % 7 + 7) % 7;
  const primeiraSegunda = new Date(dataRef);
  primeiraSegunda.setUTCDate(dataRef.getUTCDate() + diasParaPrimeiraSegunda);
  const dataInicial = new Date(primeiraSegunda);
  dataInicial.setUTCDate(primeiraSegunda.getUTCDate() + (semana - 1) * 7);
  const dataFinal = new Date(dataInicial);
  dataFinal.setUTCDate(dataInicial.getUTCDate() + 6);
  return { inicio: formatarData(dataInicial), fim: formatarData(dataFinal) };
}

// Acha em que coluna da linha de cabeçalho está a semana pedida — por número
// exato primeiro, depois por substring (igual ao fallback do original).
export function encontrarColunaSemana(linhaSemanas: unknown[], semana: number): number | null {
  for (let idx = 0; idx < linhaSemanas.length; idx++) {
    const valor = linhaSemanas[idx];
    if (valor === undefined || valor === null || valor === '') continue;
    const num = parseFloat(String(valor).trim().replace(',', '.'));
    if (Number.isFinite(num) && num === semana) return idx;
  }
  for (let idx = 0; idx < linhaSemanas.length; idx++) {
    const valor = linhaSemanas[idx];
    if (valor === undefined || valor === null || valor === '') continue;
    if (String(valor).includes(String(semana))) return idx;
  }
  return null;
}

function safeNumericCell(rows: unknown[][], r: number, c: number): number {
  const value = rows[r]?.[c];
  if (value === undefined || value === null || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value).trim().replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

// `rows` = planilha lida sem cabeçalho, como matriz (linha 0 = primeira linha da
// aba "Indicadores Semanais"), igual a pd.read_excel(..., header=None).
export function parseIndicadoresSemanais(
  rows: unknown[][], semana: number, ano: number, modo: ModoCalendarioSemana = 'ISO',
): DadosSemana {
  if (!(semana >= 1 && semana <= 53)) {
    throw new Error(`Semana invalida: ${semana}. Use valores entre 1 e 53.`);
  }

  const { inicio, fim } = calcularPeriodoSemana(semana, ano, modo);

  const linhaSemanas = rows[LINHA_SEMANAS] ?? [];
  const colunaSemana = encontrarColunaSemana(linhaSemanas, semana);
  if (colunaSemana === null) {
    throw new Error(`Semana ${semana} não encontrada na planilha.`);
  }

  const detalhesAreas: AreaSemana[] = [];
  let totalProgramadas = 0, totalExecutadas = 0, totalNaoExecutadas = 0, totalForaProgramacao = 0;
  let totalPlanejadasPlano = 0, totalExecutadasPlano = 0, totalNaoExecutadasPlano = 0;

  for (const { nome, linhaBase } of AREAS_PCM) {
    const programadas = safeNumericCell(rows, linhaBase, colunaSemana);
    const executadas = safeNumericCell(rows, linhaBase + 1, colunaSemana);
    const naoExecutadas = safeNumericCell(rows, linhaBase + 2, colunaSemana);
    const planejadasPlano = safeNumericCell(rows, linhaBase + 3, colunaSemana);
    const executadasPlano = safeNumericCell(rows, linhaBase + 4, colunaSemana);
    const naoExecutadasPlano = safeNumericCell(rows, linhaBase + 5, colunaSemana);
    const foraProgramacao = safeNumericCell(rows, linhaBase + 6, colunaSemana);

    // Não exibe áreas sem ordens programadas no relatório (igual ao original).
    if (programadas === 0) continue;

    const atendimento = round2((executadas / programadas) * 100);
    const cumprimento = planejadasPlano === 0 ? 0 : round2((executadasPlano / planejadasPlano) * 100);

    detalhesAreas.push({
      area: nome,
      programadas: Math.trunc(programadas),
      executadas: Math.trunc(executadas),
      naoExecutadas: Math.trunc(naoExecutadas),
      foraProgramacao: Math.trunc(foraProgramacao),
      planejadasPlano: Math.trunc(planejadasPlano),
      executadasPlano: Math.trunc(executadasPlano),
      naoExecutadasPlano: Math.trunc(naoExecutadasPlano),
      atendimento,
      cumprimento,
    });

    totalProgramadas += programadas;
    totalExecutadas += executadas;
    totalNaoExecutadas += naoExecutadas;
    totalForaProgramacao += foraProgramacao;
    totalPlanejadasPlano += planejadasPlano;
    totalExecutadasPlano += executadasPlano;
    totalNaoExecutadasPlano += naoExecutadasPlano;
  }

  const atendimentoGeral = totalProgramadas > 0 ? round2((totalExecutadas / totalProgramadas) * 100) : 0;
  const cumprimentoGeral = totalPlanejadasPlano > 0 ? round2((totalExecutadasPlano / totalPlanejadasPlano) * 100) : 0;

  let statusGeral: StatusGeralSemana;
  if (atendimentoGeral >= META_ATENDIMENTO && cumprimentoGeral >= META_CUMPRIMENTO) {
    statusGeral = 'EM DIA';
  } else if (atendimentoGeral >= META_ATENDIMENTO * 0.9 || cumprimentoGeral >= META_CUMPRIMENTO * 0.9) {
    statusGeral = 'ATENÇÃO';
  } else {
    statusGeral = 'CRÍTICO';
  }

  return {
    semana, ano,
    periodoSemana: `${inicio} a ${fim}`,
    dataInicio: inicio,
    dataFim: fim,
    atendimentoGeral, cumprimentoGeral,
    totalProgramadas: Math.trunc(totalProgramadas),
    totalExecutadas: Math.trunc(totalExecutadas),
    totalNaoExecutadas: Math.trunc(totalNaoExecutadas),
    totalForaProgramacao: Math.trunc(totalForaProgramacao),
    totalPlanejadasPlano: Math.trunc(totalPlanejadasPlano),
    totalExecutadasPlano: Math.trunc(totalExecutadasPlano),
    totalNaoExecutadasPlano: Math.trunc(totalNaoExecutadasPlano),
    detalhesAreas,
    statusGeral,
    metaAtendimento: META_ATENDIMENTO,
    metaCumprimento: META_CUMPRIMENTO,
  };
}

export function analisarPontosAtencaoEAcoes(
  dados: DadosSemana,
): { pontosAtencao: PontoAtencao[]; acoesPrioritarias: AcaoPrioritaria[] } {
  const pontosAtencao: PontoAtencao[] = [];
  let acoesPrioritarias: AcaoPrioritaria[] = [];

  const { atendimentoGeral, cumprimentoGeral, totalNaoExecutadas, totalForaProgramacao, detalhesAreas } = dados;

  // 1. Status geral
  if (dados.statusGeral === 'CRÍTICO') {
    pontosAtencao.push({
      tipo: 'critico',
      titulo: 'ATENÇÃO CRÍTICA - AÇÃO IMEDIATA REQUERIDA',
      descricao: `Esta semana apresentou resultados críticos: ${atendimentoGeral}% de atendimento e ${cumprimentoGeral}% de cumprimento. Precisamos agir rapidamente para reverter esta situação.`,
      severidade: 'alta',
    });
    acoesPrioritarias.push({ prioridade: 'urgente', acao: 'Agendar reunião de emergência com todas as áreas para análise conjunta', prazo: 'Hoje mesmo', responsavel: 'Gestores das áreas' });
  } else if (dados.statusGeral === 'ATENÇÃO') {
    pontosAtencao.push({
      tipo: 'alerta',
      titulo: 'SINAL DE ALERTA - MONITORAMENTO REFORÇADO',
      descricao: `Os indicadores estão próximos das metas (${atendimentoGeral}% atendimento, ${cumprimentoGeral}% cumprimento). Vamos acompanhar de perto para garantir que não regridam.`,
      severidade: 'media',
    });
    acoesPrioritarias.push({ prioridade: 'alta', acao: 'Revisar individualmente os planos de ação das áreas com menor desempenho', prazo: 'Amanhã', responsavel: 'Coordenadores' });
  } else {
    pontosAtencao.push({
      tipo: 'positivo',
      titulo: 'BOM TRABALHO - META ATINGIDA',
      descricao: `Excelente! Conseguimos atingir as metas com ${atendimentoGeral}% de atendimento e ${cumprimentoGeral}% de cumprimento. Vamos manter esse ritmo!`,
      severidade: 'baixa',
    });
    acoesPrioritarias.push({ prioridade: 'media', acao: 'Documentar as melhores práticas que levaram ao bom desempenho', prazo: 'Esta semana', responsavel: 'Lideranças' });
  }

  // 2. OSs não executadas
  if (totalNaoExecutadas > 0) {
    const areasComPendencias = detalhesAreas.filter(a => a.naoExecutadas > 0).sort((a, b) => b.naoExecutadas - a.naoExecutadas);
    const topPendencias = areasComPendencias.slice(0, 3);

    let mensagem: string;
    if (totalNaoExecutadas === 1) mensagem = 'Identificamos 1 OS não executada.';
    else if (totalNaoExecutadas < 5) mensagem = `Encontramos ${totalNaoExecutadas} OSs não executadas que precisam de atenção.`;
    else mensagem = `Precisamos dar atenção especial às ${totalNaoExecutadas} OSs que ficaram pendentes.`;

    const areasStr = topPendencias.map(a => `${a.area} (${a.naoExecutadas} OSs)`).join(', ');

    if (areasComPendencias.length === 1) {
      pontosAtencao.push({
        tipo: 'pendente', titulo: 'OSs PENDENTES DE EXECUÇÃO',
        descricao: `${mensagem} A área ${areasStr} precisa revisar sua programação.`,
        severidade: totalNaoExecutadas <= 3 ? 'media' : 'alta',
      });
    } else {
      pontosAtencao.push({
        tipo: 'pendente', titulo: 'MULTIPLAS OSs PENDENTES',
        descricao: `${mensagem} Principais áreas: ${areasStr}. Vamos planejar a execução para a próxima semana.`,
        severidade: totalNaoExecutadas <= 10 ? 'media' : 'alta',
      });
    }

    acoesPrioritarias.push({
      prioridade: 'alta', acao: `Definir plano para executar as ${totalNaoExecutadas} OSs pendentes`,
      prazo: 'Próxima semana', responsavel: `${areasComPendencias.length} áreas envolvidas`,
    });
  }

  // 3. Fora da programação
  if (totalForaProgramacao > 0) {
    const areasForaProgramacao = detalhesAreas.filter(a => a.programadas > 0 && a.foraProgramacao > a.programadas * 0.3);

    let mensagem: string;
    if (totalForaProgramacao === 1) mensagem = 'Executamos 1 atividade fora do planejado original.';
    else if (totalForaProgramacao < 5) mensagem = `Realizamos ${totalForaProgramacao} atividades que não estavam na programação inicial.`;
    else mensagem = `Um volume considerável de ${totalForaProgramacao} atividades foi executado fora do planejado.`;

    if (areasForaProgramacao.length > 0) {
      const areasList = areasForaProgramacao.map(a => a.area).join(', ');
      pontosAtencao.push({
        tipo: 'desvio', titulo: 'ATIVIDADES FORA DO PLANEJADO',
        descricao: `${mensagem} As áreas ${areasList} tiveram adaptações significativas no plano.`,
        severidade: 'alta',
      });
    } else {
      pontosAtencao.push({
        tipo: 'desvio', titulo: 'AJUSTES NA PROGRAMAÇÃO',
        descricao: `${mensagem} Isso indica que tivemos que adaptar nosso plano durante a semana.`,
        severidade: 'media',
      });
    }

    acoesPrioritarias.push({
      prioridade: 'media', acao: 'Analisar os motivos das atividades realizadas fora da programação original',
      prazo: '3 dias', responsavel: 'Planejamento',
    });
  }

  // 4. Áreas abaixo das metas (áreas com 0% de propósito ficam fora — sem ordens
  // programadas, não é uma área "abaixo da meta", é uma área sem atividade).
  const areasAbaixoAtendimento = detalhesAreas.filter(a => a.atendimento < dados.metaAtendimento && a.atendimento > 0);
  const areasAbaixoCumprimento = detalhesAreas.filter(a => a.cumprimento < dados.metaCumprimento && a.cumprimento > 0);

  if (areasAbaixoAtendimento.length > 0) {
    const areasCriticasAtendimento = [...areasAbaixoAtendimento].sort((a, b) => a.atendimento - b.atendimento);
    const topCriticas = areasCriticasAtendimento.slice(0, 2);

    if (areasAbaixoAtendimento.length === 1) {
      const area = areasAbaixoAtendimento[0];
      pontosAtencao.push({
        tipo: 'meta', titulo: 'UMA ÁREA PRECISA DE APOIO',
        descricao: `A área ${area.area} atingiu ${area.atendimento}% de atendimento. Vamos ajudá-la a melhorar.`,
        severidade: 'media',
      });
    } else if (areasAbaixoAtendimento.length <= 3) {
      const areasStr = areasAbaixoAtendimento.map(a => `${a.area} (${a.atendimento}%)`).join(', ');
      pontosAtencao.push({
        tipo: 'meta', titulo: 'ALGUMAS ÁREAS PRECISAM DE ATENÇÃO',
        descricao: `${areasAbaixoAtendimento.length} áreas não atingiram a meta de atendimento: ${areasStr}.`,
        severidade: 'media',
      });
    } else {
      const areasStr = topCriticas.map(a => `${a.area} (${a.atendimento}%)`).join(', ');
      pontosAtencao.push({
        tipo: 'meta', titulo: 'DESAFIO NO ATENDIMENTO',
        descricao: `${areasAbaixoAtendimento.length} áreas estão abaixo da meta. Vamos focar primeiro em ${areasStr}.`,
        severidade: 'alta',
      });
    }

    acoesPrioritarias.push({
      prioridade: 'alta', acao: `Apoiar as ${areasAbaixoAtendimento.length} áreas no alcance da meta de atendimento`,
      prazo: 'Contínuo', responsavel: 'Liderança e Planejamento',
    });
  }

  if (areasAbaixoCumprimento.length > 0) {
    const areasCriticasCumprimento = [...areasAbaixoCumprimento].sort((a, b) => a.cumprimento - b.cumprimento);
    const topCriticas = areasCriticasCumprimento.slice(0, 2);

    if (areasAbaixoCumprimento.length === 1) {
      const area = areasAbaixoCumprimento[0];
      pontosAtencao.push({
        tipo: 'meta', titulo: 'OPORTUNIDADE DE MELHORIA',
        descricao: `A área ${area.area} teve ${area.cumprimento}% de cumprimento. Vamos identificar oportunidades.`,
        severidade: 'media',
      });
    } else {
      const areasStr = topCriticas.map(a => `${a.area} (${a.cumprimento}%)`).join(', ');
      pontosAtencao.push({
        tipo: 'meta', titulo: 'CUIDADO COM O CUMPRIMENTO',
        descricao: `${areasAbaixoCumprimento.length} áreas estão abaixo da meta de cumprimento. Foco em ${areasStr}.`,
        severidade: areasAbaixoCumprimento.length > 2 ? 'alta' : 'media',
      });
    }

    acoesPrioritarias.push({
      prioridade: 'alta', acao: 'Trabalhar no plano de recuperação das áreas com baixo cumprimento',
      prazo: '1 semana', responsavel: 'Gestores das áreas',
    });
  }

  // 5. Dispersão de performance
  const areasComDesempenho = detalhesAreas.filter(a => a.programadas > 0);
  if (areasComDesempenho.length > 0) {
    const melhorAtendimento = areasComDesempenho.reduce((m, a) => (a.atendimento > m.atendimento ? a : m));
    const piorAtendimento = areasComDesempenho.reduce((m, a) => (a.atendimento < m.atendimento ? a : m));
    const diferenca = melhorAtendimento.atendimento - piorAtendimento.atendimento;

    if (diferenca > 30) {
      pontosAtencao.push({
        tipo: 'performance', titulo: 'GRANDE DIFERENÇA ENTRE ÁREAS',
        descricao: `Há uma variação significativa: ${melhorAtendimento.area} (${melhorAtendimento.atendimento}%) vs ${piorAtendimento.area} (${piorAtendimento.atendimento}%). Podemos compartilhar boas práticas.`,
        severidade: 'media',
      });
      acoesPrioritarias.push({
        prioridade: 'media', acao: 'Organizar troca de experiências entre as áreas com melhor e pior desempenho',
        prazo: '2 semanas', responsavel: 'Coordenadores',
      });
    } else if (diferenca > 20) {
      pontosAtencao.push({
        tipo: 'performance', titulo: 'DESEMPENHO VARIADO',
        descricao: `Observamos diferença de performance entre as áreas. ${melhorAtendimento.area} se destacou.`,
        severidade: 'baixa',
      });
    }
  }

  // 6. Volume
  const volumeAlta = detalhesAreas.filter(a => a.programadas > 20).length;
  if (volumeAlta >= 3) {
    pontosAtencao.push({
      tipo: 'volume', titulo: 'ALTO VOLUME DE ATIVIDADES',
      descricao: `${volumeAlta} áreas tiveram mais de 20 atividades programadas. Vamos monitorar a carga de trabalho.`,
      severidade: 'media',
    });
    acoesPrioritarias.push({
      prioridade: 'media', acao: 'Avaliar a distribuição de carga entre as áreas com maior volume',
      prazo: 'Próximo planejamento', responsavel: 'Planejamento',
    });
  }

  // 7. Aprendizado contínuo
  if (totalNaoExecutadas > 0 || totalForaProgramacao > 0) {
    acoesPrioritarias.push({
      prioridade: 'media', acao: 'Documentar lições aprendidas com os desvios desta semana',
      prazo: '5 dias', responsavel: 'Todos os envolvidos',
    });
  }

  acoesPrioritarias.push({
    prioridade: 'media', acao: 'Preparar o planejamento da próxima semana considerando as aprendizagens desta',
    prazo: 'Segunda-feira', responsavel: 'Equipe de Planejamento',
  });

  // 8. Reconhecimento de desempenho excelente
  if (dados.statusGeral === 'EM DIA' && totalNaoExecutadas === 0) {
    acoesPrioritarias.push({
      prioridade: 'baixa', acao: 'Reconhecer o bom trabalho da equipe esta semana',
      prazo: 'Esta semana', responsavel: 'Liderança',
    });
  }

  // 9. Ordenação por prioridade e remoção de duplicatas
  const prioridadeOrdem: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };
  acoesPrioritarias = [...acoesPrioritarias].sort((a, b) => (prioridadeOrdem[a.prioridade] ?? 4) - (prioridadeOrdem[b.prioridade] ?? 4));

  const vistas = new Set<string>();
  const acoesUnicas: AcaoPrioritaria[] = [];
  for (const acao of acoesPrioritarias) {
    const chave = `${acao.acao}|${acao.prioridade}`;
    if (!vistas.has(chave)) {
      vistas.add(chave);
      acoesUnicas.push(acao);
    }
  }

  return { pontosAtencao: pontosAtencao.slice(0, 6), acoesPrioritarias: acoesUnicas.slice(0, 5) };
}

export function gerarDestaques(dados: DadosSemana): Destaque[] {
  let destaques: Destaque[] = [];
  const { detalhesAreas } = dados;

  // 1. Áreas com desempenho perfeito
  const areasPerfeitas = detalhesAreas.filter(a => a.atendimento === 100 && a.cumprimento === 100 && a.programadas > 0);
  if (areasPerfeitas.length === 1) {
    destaques.push({ icon: 'fa-trophy', tipo: 'perfeito', texto: 'DESTAQUE MÁXIMO!', detalhe: `${areasPerfeitas[0].area} teve desempenho PERFEITO esta semana!` });
  } else if (areasPerfeitas.length > 1 && areasPerfeitas.length <= 3) {
    const nomes = areasPerfeitas.map(a => a.area).join(', ');
    destaques.push({ icon: 'fa-medal', tipo: 'perfeito', texto: 'EXCELÊNCIA OPERACIONAL', detalhe: `${areasPerfeitas.length} áreas brilharam: ${nomes}` });
  } else if (areasPerfeitas.length > 3) {
    destaques.push({ icon: 'fa-award', tipo: 'perfeito', texto: 'SEMANA EXCEPCIONAL', detalhe: `Incríveis ${areasPerfeitas.length} áreas tiveram desempenho 100%!` });
  }

  // 2. Melhor atendimento
  const areasComAtividade = detalhesAreas.filter(a => a.programadas > 0);
  if (areasComAtividade.length > 0) {
    const melhorAtendimento = areasComAtividade.reduce((m, a) => (a.atendimento > m.atendimento ? a : m));
    if (melhorAtendimento.atendimento >= 95) {
      destaques.push({ icon: 'fa-chart-line', tipo: 'melhor_atendimento', texto: 'TOP EM ATENDIMENTO', detalhe: `${melhorAtendimento.area} lidera com ${melhorAtendimento.atendimento}%` });
    }
  }

  // 3. Melhor cumprimento
  const areasComPlano = detalhesAreas.filter(a => a.planejadasPlano > 0);
  if (areasComPlano.length > 0) {
    const melhorCumprimento = areasComPlano.reduce((m, a) => (a.cumprimento > m.cumprimento ? a : m));
    if (melhorCumprimento.cumprimento >= 95) {
      destaques.push({ icon: 'fa-clipboard-check', tipo: 'melhor_cumprimento', texto: 'REFERÊNCIA EM CUMPRIMENTO', detalhe: `${melhorCumprimento.area}: ${melhorCumprimento.cumprimento}% do plano executado` });
    }
  }

  // 4. Maior produtividade
  const areasComExecucao = detalhesAreas.filter(a => a.executadas > 0);
  if (areasComExecucao.length > 0) {
    const maiorProdutividade = areasComExecucao.reduce((m, a) => (a.executadas > m.executadas ? a : m));
    if (maiorProdutividade.executadas >= 15) {
      destaques.push({ icon: 'fa-hammer', tipo: 'produtividade', texto: 'ALTA PRODUTIVIDADE', detalhe: `${maiorProdutividade.area} executou ${maiorProdutividade.executadas} OSs` });
    }
  }

  // 5. Áreas sem pendências
  const areasSemPendencias = detalhesAreas.filter(a => a.naoExecutadas === 0 && a.executadas > 0);
  if (areasSemPendencias.length > 0) {
    if (areasSemPendencias.length === detalhesAreas.length) {
      destaques.push({ icon: 'fa-check-double', tipo: 'sem_pendencias', texto: 'TODAS ÁREAS CONCLUÍRAM', detalhe: 'Excelente! Nenhuma OS ficou pendente esta semana' });
    } else if (areasSemPendencias.length >= Math.floor(detalhesAreas.length / 2)) {
      destaques.push({ icon: 'fa-check-circle', tipo: 'sem_pendencias', texto: 'MAIORIA SEM PENDÊNCIAS', detalhe: `${areasSemPendencias.length} áreas executaram 100% do programado` });
    }
  }

  // 6. Meta geral atingida
  if (dados.atendimentoGeral >= dados.metaAtendimento && dados.cumprimentoGeral >= dados.metaCumprimento) {
    destaques.push({ icon: 'fa-flag-checkered', tipo: 'meta_atingida', texto: 'METAS CONQUISTADAS!', detalhe: `Atendimento: ${dados.atendimentoGeral}% | Cumprimento: ${dados.cumprimentoGeral}%` });
  }

  // 7. Baixo volume fora da programação
  if (dados.totalForaProgramacao === 0) {
    destaques.push({ icon: 'fa-calendar-alt', tipo: 'planejamento', texto: 'PLANEJAMENTO PRECISO', detalhe: 'Todas as atividades foram executadas conforme programado' });
  } else if (dados.totalForaProgramacao <= 2) {
    destaques.push({ icon: 'fa-thumbs-up', tipo: 'planejamento', texto: 'PLANEJAMENTO CONSISTENTE', detalhe: `Apenas ${dados.totalForaProgramacao} ajustes fora do planejado` });
  }

  // 8. Semana exemplar
  if (dados.statusGeral === 'EM DIA' && dados.totalNaoExecutadas === 0 && dados.totalForaProgramacao <= 2) {
    destaques.push({ icon: 'fa-star', tipo: 'excelente', texto: 'SEMANA EXEMPLAR!', detalhe: 'Desempenho excepcional em todos os aspectos' });
  }

  const ordemTipo: Record<string, number> = {
    excelente: 0, perfeito: 1, meta_atingida: 2, sem_pendencias: 3,
    melhor_atendimento: 4, melhor_cumprimento: 5, produtividade: 6, planejamento: 7,
  };
  destaques = [...destaques].sort((a, b) => (ordemTipo[a.tipo] ?? 8) - (ordemTipo[b.tipo] ?? 8));

  return destaques.slice(0, 4);
}
