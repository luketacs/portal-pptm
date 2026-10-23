import type { ManutencaoArea } from '../models/manutencao-programacao.model';

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
  return somarPeriodos(ultimaExecucao, 1, valor, unidade);
}

// k-ésima ocorrência da sequência (k=0 é a própria âncora). Mês sempre contado a partir
// da ÂNCORA, com o dia limitado ao último dia do mês: o setMonth do JS transbordava
// (31/01 + 1 mês = 03/03) e, encadeando ocorrência a ocorrência, o plano ficava preso no
// dia 3 pra sempre. Agora 31/01 mensal = 28/02, 31/03, 30/04, 31/05...
export function somarPeriodos(ancora: string, k: number, valor: number, unidade: PeriodicidadeUnidade): string {
  if (unidade !== 'Mes(es)') return somarDias(ancora, k * (unidade === 'Semana(s)' ? valor * 7 : valor));
  const [ano, mes, dia] = ancora.split('-').map(Number);
  const totalMeses = (mes - 1) + k * valor;
  const anoAlvo = ano + Math.floor(totalMeses / 12);
  const mesAlvo = ((totalMeses % 12) + 12) % 12; // 0-11
  const ultimoDia = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  return `${anoAlvo}-${String(mesAlvo + 1).padStart(2, '0')}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}

function diasEntre(deIso: string, ateIso: string): number {
  const [a1, m1, d1] = deIso.split('-').map(Number);
  const [a2, m2, d2] = ateIso.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

// Índice k da primeira ocorrência >= referenciaIso. Pula direto pra perto da referência
// (estimativa por baixo: mês conta como 31 dias) em vez de andar ciclo a ciclo desde a
// âncora — antes um laço com teto de 2000 voltas devolvia data no passado pra plano
// diário com âncora de mais de ~5 anos.
export function primeiroIndiceAPartirDe(ancora: string, valor: number, unidade: PeriodicidadeUnidade, referenciaIso: string): number {
  if (referenciaIso <= ancora) return 0;
  const diasPorPeriodo = unidade === 'Mes(es)' ? valor * 31 : periodicidadeEmDias(valor, unidade);
  let k = Math.max(0, Math.floor(diasEntre(ancora, referenciaIso) / diasPorPeriodo) - 1);
  while (somarPeriodos(ancora, k, valor, unidade) < referenciaIso) k++;
  return k;
}

// Agenda TIME-BASED (âncora fixa) — usada só pro Apoio (SERVPLEX/OPERAÇÃO/BMS, ver
// planosComProximaExecucaoFixa): a próxima data NUNCA "anda" por causa de quando o
// plano foi executado de verdade — é sempre o próximo ponto da sequência
// dataAncora, dataAncora+ciclo, dataAncora+2*ciclo, ... que seja >= referenciaIso.
// Diferente de calcularProximaData (completion-based, ainda usado por
// Elétrica/Mecânica), que reparte a partir da ÚLTIMA EXECUÇÃO real registrada em
// manutencao_ciclos. Pedido explícito do usuário: "não existe backlog, estamos
// começando do zero" — igual o modelo padrão de plano cíclico do SAP PM (agenda por
// calendário fixo, independente de quando cada execução foi confirmada). Como
// consequência intencional: um plano do Apoio nunca aparece "atrasado" além da
// tolerância normal, porque a data sempre pula pro próximo compromisso futuro, nunca
// fica presa no passado.
//
// `ultimoCicloIso` (opcional): data prevista do último ciclo já REGISTRADO pro plano
// (ver ManutencaoPlanosService.registrarCiclo, chamado toda vez que uma OS é
// vinculada/criada a partir dele — igual pra área time-based e completion-based).
// Reportado: programar o plano dentro da semana não tirava ele da lista de
// "Preventivas vencendo" — a sequência de âncora não sabia que aquela ocorrência já
// tinha sido atendida, então continuava devolvendo a mesma proximaData a semana
// inteira. Trata "já tem ciclo registrado pra essa ocorrência (ou depois dela)" do
// mesmo jeito que "data no passado": avança pra próxima ocorrência da sequência. Não
// muda o comportamento "sem backlog" (a sequência de âncora continua a mesma,
// independente de quando cada execução real aconteceu) — só evita repetir uma
// ocorrência que já foi programada.
//
// Folga de cobertura (ver folgaCoberturaCiclo): o alinhamento por equipamento
// (alinharDatasPorEquipamento) ANTECIPA a data de alguns planos, e o ciclo é gravado com
// essa data antecipada. Reportado: sem folga, um plano programado junto com o grupo na
// semana X (ciclo = X) voltava a aparecer sozinho na semana da sua data original (X+1,
// X+2...) — ex. P-R-6M do Prédio 25 saindo 3 semanas seguidas. Um ciclo registrado até
// `folga` dias ANTES da ocorrência também conta como cobrindo ela.
//
// Intervalo mínimo desde a última execução (regra do usuário: "6M só a cada 6M"): a
// próxima ocorrência nunca fica a menos de 2/3 do período do último ciclo — só dá pra
// antecipar até 1/3. Antes só a folga (≤ 21 dias) protegia: plano com data inicial fora
// do dia em que foi feito (feito fora da data, data inicial mudada depois por migration
// ou na tela, OS remarcada) voltava 22 dias depois, mesmo sendo 6M.
//
// `agendaRigida`: plano que nunca é antecipado (ver PlanoManutencao.agendaRigida) não
// precisa de folga — sem ela, o ciclo de uma ocorrência não engole a seguinte quando as
// duas estão perto (ex. teste RETOMA dia 21/09 e o próximo dia 06/10).
//
// Recebe TODOS os ciclos do plano, não só o último. Reportado na S44/2026: preventiva
// programada e depois excluída ("não precisa mais") não voltava pra lista da semana —
// com só o último ciclo, uma OS do mesmo plano numa semana à frente (S45) escondia a
// ocorrência da S44, que tinha ficado sem ciclo. Agora cada ocorrência é checada contra
// os ciclos dela (mesma cobertura de planosAtrasados): coberta = algum ciclo entre
// (ocorrência - folga) e a ocorrência seguinte; cedo demais = menos do intervalo mínimo
// depois de um ciclo anterior.
export function proximaDataFixa(
  dataAncora: string, valor: number, unidade: PeriodicidadeUnidade, referenciaIso: string,
  ciclosIso: string | readonly string[] | null = null, agendaRigida = false,
): string {
  if (valor <= 0) return dataAncora;
  const ciclos = ciclosIso === null ? [] : typeof ciclosIso === 'string' ? [ciclosIso] : ciclosIso;
  const folga = agendaRigida ? 0 : folgaCoberturaCiclo(valor, unidade);
  const dias = periodicidadeEmDias(valor, unidade);
  const intervaloMinimo = agendaRigida ? 0 : dias - Math.round(dias / 3);
  const distanciaMinima = Math.max(folga + 1, intervaloMinimo);
  // Termina: depois do último ciclo + distanciaMinima nenhuma ocorrência é bloqueada.
  for (let k = primeiroIndiceAPartirDe(dataAncora, valor, unidade, referenciaIso); ; k++) {
    const data = somarPeriodos(dataAncora, k, valor, unidade);
    const seguinte = somarPeriodos(dataAncora, k + 1, valor, unidade);
    const desde = somarDias(data, -folga);
    const bloqueada = ciclos.some(c =>
      c < desde ? data < somarDias(c, distanciaMinima) : c < seguinte);
    if (!bloqueada) return data;
  }
}

// Máximo de dias que alinharDatasPorEquipamento pode antecipar um plano — planos do
// mesmo equipamento/grupo com datas dentro dessa janela saem juntos na data mais cedo.
export const JANELA_ALINHAMENTO_DIAS = 21;

// Quantos dias antes da ocorrência um ciclo registrado ainda cobre ela: a janela de
// alinhamento, limitada a 3/4 do período — nunca chega na ocorrência SEGUINTE da
// sequência (ex.: semanal = 5 dias, mensal/6M = 21 dias).
export function folgaCoberturaCiclo(valor: number, unidade: PeriodicidadeUnidade): number {
  return Math.min(JANELA_ALINHAMENTO_DIAS, Math.floor(periodicidadeEmDias(valor, unidade) * 3 / 4));
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// Converte a periodicidade pra dias, pra dar pra comparar/ordenar planos de unidades
// diferentes (ex.: priorizar quem é de 6 meses/1 ano na fila de sugestão — ver
// preventivasVencendoTodas). Também usada pela tolerância de atraso, abaixo.
export function periodicidadeEmDias(valor: number, unidade: PeriodicidadeUnidade): number {
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
  return somarDias(proximaData, Math.round(periodicidadeEmDias(valor, unidade) / 3));
}

// A empresa não opera 24h/dia — às vezes a planta fica meses parada, e nesses períodos
// não faz sentido manter o ritmo semanal/quinzenal de inspeção de equipamento parado.
// Enquanto a planta estiver marcada como parada (ver ParadaPlanta), todo plano de ciclo
// curto (Dia(s)/Semana(s)) é tratado como se fosse mensal só pra esse cálculo — o
// cadastro do plano em si não muda, volta ao normal assim que a parada é encerrada.
//
// Só vale pra Elétrica/Mecânica (pedido do usuário): equipamento de processo parado não
// precisa de inspeção semanal. Apoio (refrigeração, limpeza, SPCI) atende prédio/sala,
// que continua funcionando com a planta parada — semanal do Apoio segue semanal.
export function periodicidadeEfetiva(
  valor: number, unidade: PeriodicidadeUnidade, plantaParada: boolean, area: ManutencaoArea,
): { valor: number; unidade: PeriodicidadeUnidade } {
  const afetaArea = area === 'ELETRICA' || area === 'MECANICA';
  // Só ciclo CURTO (< 1 mês): plano cadastrado em dias mas longo (90/180/365 Dia(s),
  // comum no import do SIGMA) virava mensal na parada — 6x mais trabalho, não menos.
  const cicloCurto = periodicidadeEmDias(valor, unidade) < 30;
  if (plantaParada && afetaArea && cicloCurto) return { valor: 1, unidade: 'Mes(es)' };
  return { valor, unidade };
}
