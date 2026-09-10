// Endpoint público (sem login) pro Kanban da Oficina — pensado pra ficar aberto numa TV
// da Elétrica/Mecânica. Só leitura: atividades (tipo='ordem') acumuladas de segunda até
// hoje (não só hoje — uma ordem de terça sem executar continua aparecendo na quinta),
// Elétrica e Mecânica, agrupadas por status, mais os indicadores da semana (faixa no
// topo). O RLS de manutencao_programacao continua exigindo sessão (auth.uid() IS NOT
// NULL), então quem decide o que sai daqui é esta function, com a service_role key (só
// no servidor, nunca chega no cliente) — mesmo padrão de api/fundo-fixo-public-request.js.
//
// A coluna `status` da tabela é sempre 'PEND' pra qualquer OS criada pelo Portal — quem
// sabe o andamento de verdade é o SIGMA (ver _sigma-shared.js), por isso a consulta ao
// cache de OS/apontamentos do SIGMA pra decidir a coluna do Kanban e o % de cumprimento.
import { createClient } from '@supabase/supabase-js';
import { ALLOWED_ORIGINS, normalizarNumeroOs, obterCache } from './_sigma-shared.js';

// Mapeamento do Status Código do SIGMA pra coluna do Kanban — melhor entendimento dos
// códigos observados (PEND, CANC, EXEC, ETEX, EXPA, NEXE, ETNE, CONC, AREC); sem OS ou
// sem status ainda cai em "pendente". CANC (cancelada) não entra no quadro.
// Regra combinada com o usuário: como o SIGMA raramente marca EXEC/ETEX de verdade (na
// prática quase tudo fica em PEND mesmo já em andamento), o padrão pra qualquer OS que o
// SIGMA já conhece (tem status código, seja qual for) é "Em execução" — só cai em
// "Pendente" quem o SIGMA nem tem registro ainda (numero_os sem match nenhum, ou "sem
// OS"), que é o único caso em que realmente não dá pra dizer que algo começou.
const STATUS_PARA_COLUNA = {
  PEND: 'emExecucao', EXPA: 'emExecucao', NEXE: 'emExecucao', ETNE: 'emExecucao',
  EXEC: 'emExecucao', ETEX: 'emExecucao',
  CONC: 'concluida', AREC: 'concluida',
};

// Data de "hoje" no fuso de Pecém/CE (America/Fortaleza, sem horário de verão) — a
// Vercel roda em UTC, então "new Date()" sozinho vira o dia errado à noite.
function hojeBrasilIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
}

// Matemática de data em UTC sobre os componentes Y-M-D (não em cima de "new Date()" do
// fuso do servidor) — evita virar um dia pra trás/frente perto da meia-noite.
function segundaFeiraIso(hojeIso) {
  const [ano, mes, dia] = hojeIso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const diaSemana = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - diaSemana);
  return d.toISOString().slice(0, 10);
}
function somarDias(dataIso, n) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Dias de segunda até hoje (inclusive) — não a semana toda: uma ordem de sexta-feira
// ainda não "atrasou", só as de dias que já passaram (ou hoje) contam pro quadro.
function diasDeSegundaAteHoje(segundaIso, hojeIso) {
  const dias = [];
  for (let n = 0; n < 8; n++) {
    const dia = somarDias(segundaIso, n);
    if (dia > hojeIso) break;
    dias.push(dia);
  }
  return dias;
}

// Mesmas regras de src/utils/manutencao-preventivas.ts, portadas pra cá porque essa
// function roda isolada (não importa código Angular) — ver "próxima data" dos planos
// preventivos pro indicador de atendimento aos planos.
function calcularProximaData(ultimaExecucao, valor, unidade) {
  if (!ultimaExecucao) return null;
  const [ano, mes, dia] = ultimaExecucao.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (unidade === 'Dia(s)') d.setUTCDate(d.getUTCDate() + valor);
  else if (unidade === 'Semana(s)') d.setUTCDate(d.getUTCDate() + valor * 7);
  else d.setUTCMonth(d.getUTCMonth() + valor);
  return d.toISOString().slice(0, 10);
}
function periodicidadeEfetiva(valor, unidade, plantaParada) {
  if (plantaParada && unidade !== 'Mes(es)') return { valor: 1, unidade: 'Mes(es)' };
  return { valor, unidade };
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[kanban-atividades-publico] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const hoje = hojeBrasilIso();
    const segunda = segundaFeiraIso(hoje);
    const sexta = somarDias(segunda, 4);
    const diasUteisSemana = [0, 1, 2, 3, 4].map(n => somarDias(segunda, n));
    // O quadro mostra o acumulado da semana até hoje (não só hoje) — pedido do usuário:
    // se uma ordem de terça ainda não foi executada, ela continua aparecendo na
    // quinta, em vez de sumir do quadro assim que o dia dela passa.
    const diasAcumulados = diasDeSegundaAteHoje(segunda, hoje);

    const { data, error } = await supabase
      .from('manutencao_programacao')
      .select('numero_os, descricao, equipamento, tecnico_nome, area, duracao_horas, loto')
      .eq('tipo', 'ordem')
      .in('area', ['ELETRICA', 'MECANICA'])
      .overlaps('dias_previstos', diasAcumulados);
    if (error) return res.status(500).json({ success: false, error: error.message });

    let osPorNumero = new Map();
    let apontamentosPorOs = new Map();
    try {
      const cacheSigma = await obterCache();
      osPorNumero = cacheSigma.osPorNumero;
      apontamentosPorOs = cacheSigma.apontamentosPorOs;
    } catch (sigmaError) {
      // Best-effort — se o SIGMA estiver fora do ar, tudo cai em "pendente" (melhor
      // mostrar o quadro sem status do que quebrar tudo numa TV sem ninguém pra ver erro).
      console.error('[kanban-atividades-publico] SIGMA indisponível:', sigmaError.message);
    }

    // A mesma OS pode aparecer em várias linhas (apoio/vários técnicos na mesma
    // atividade, ver criarApoioTecnicosSeNecessario/criarApoioEquipamentosSeNecessario
    // na Programação) — o número da OS é o mesmo, então agrupa numa única linha do
    // quadro, com a lista de técnicos, em vez de repetir o card por pessoa. Sem número
    // de OS não dá pra saber com certeza que é "a mesma atividade", então cada linha
    // vira seu próprio card.
    const porColunaEChave = { pendente: new Map(), emExecucao: new Map(), concluida: new Map() };
    let semOsIdx = 0;
    for (const o of data) {
      const info = o.numero_os ? osPorNumero.get(normalizarNumeroOs(o.numero_os)) : null;
      const statusCodigo = (info?.statusCodigo || '').toUpperCase();
      if (statusCodigo === 'CANC') continue;
      const coluna = info ? (STATUS_PARA_COLUNA[statusCodigo] || 'emExecucao') : 'pendente';
      const chave = o.numero_os ? normalizarNumeroOs(o.numero_os) : `sem-os-${semOsIdx++}`;

      const mapa = porColunaEChave[coluna];
      const existente = mapa.get(chave);
      if (existente) {
        existente.tecnicos.push({ nome: o.tecnico_nome, duracaoHoras: o.duracao_horas });
      } else {
        mapa.set(chave, {
          numeroOs: o.numero_os,
          descricao: o.descricao,
          equipamento: o.equipamento,
          area: o.area,
          loto: o.loto,
          tecnicos: [{ nome: o.tecnico_nome, duracaoHoras: o.duracao_horas }],
        });
      }
    }

    const colunas = {
      pendente: [...porColunaEChave.pendente.values()],
      emExecucao: [...porColunaEChave.emExecucao.values()],
      concluida: [...porColunaEChave.concluida.values()],
    };

    // ── Indicadores da semana (painel lateral) — best-effort: se algo aqui falhar, o
    // quadro do dia (acima) continua funcionando normalmente, só os indicadores ficam
    // zerados/nulos.
    let indicadores = {
      cumprimentoProgramacao: null,
      atendimentoPlanos: null,
      hhPorArea: [],
      hhPorColaborador: [],
      equipamentosCorretivas: [],
    };
    try {
      const [
        { data: ordensDaSemana, error: erroOrdens },
        { data: planosPreventivos, error: erroPlanos },
        { data: programadosComPlano, error: erroProgramados },
        { data: paradaRows, error: erroParada },
      ] = await Promise.all([
        supabase.from('manutencao_programacao')
          .select('numero_os, area, tecnico_nome, duracao_horas, tipo_servico, equipamento, dias_previstos, plano_preventivo_id')
          .eq('tipo', 'ordem').in('area', ['ELETRICA', 'MECANICA']).eq('semana_inicio', segunda),
        supabase.from('manutencao_planos_preventivos')
          .select('id, periodicidade_valor, periodicidade_unidade, ultima_execucao')
          .in('area', ['ELETRICA', 'MECANICA']).eq('ativo', true),
        supabase.from('manutencao_programacao')
          .select('plano_preventivo_id')
          .in('area', ['ELETRICA', 'MECANICA']).not('plano_preventivo_id', 'is', null),
        supabase.from('manutencao_parada_planta').select('id').is('data_fim', null).limit(1),
      ]);
      if (erroOrdens) throw new Error(erroOrdens.message);
      if (erroPlanos) throw new Error(erroPlanos.message);
      if (erroProgramados) throw new Error(erroProgramados.message);
      if (erroParada) throw new Error(erroParada.message);

      // % Cumprimento da programação da semana — mesma lógica de atendimentoProgramacao
      // na Programação: agrupa por número de OS (apoio não conta a mesma OS 2x),
      // considera executada se algum apontamento do SIGMA caiu dentro dos dias
      // previstos (união entre as linhas do grupo, ou a semana toda se não tiver dia
      // marcado).
      const porOs = new Map();
      let semOsIdx2 = 0;
      for (const o of ordensDaSemana) {
        const chave = o.numero_os?.trim() ? normalizarNumeroOs(o.numero_os) : `__sem-os-${semOsIdx2++}`;
        const lista = porOs.get(chave);
        if (lista) lista.push(o); else porOs.set(chave, [o]);
      }
      let executadas = 0, rastreaveis = 0;
      for (const [chave, linhas] of porOs) {
        if (!linhas[0].numero_os?.trim()) continue;
        const apontamentosDaOs = apontamentosPorOs.get(chave);
        if (!apontamentosDaOs) continue;
        rastreaveis++;
        const diasUniao = new Set();
        for (const o of linhas) {
          const dias = (o.dias_previstos && o.dias_previstos.length > 0) ? o.dias_previstos : diasUteisSemana;
          for (const dd of dias) diasUniao.add(dd);
        }
        if (apontamentosDaOs.some(a => diasUniao.has(a.data))) executadas++;
      }
      indicadores.cumprimentoProgramacao = {
        executadas, rastreaveis,
        percentual: rastreaveis > 0 ? Math.round((executadas / rastreaveis) * 100) : 0,
      };

      // % Atendimento aos planos da semana — mesma lógica de preventivasGauge: planos
      // vencendo dentro da semana (segunda a sexta) que ainda não foram programados
      // (em NENHUMA semana, não só essa) vs. os que já viraram OS essa semana.
      const jaProgramadosSet = new Set((programadosComPlano ?? []).map(r => r.plano_preventivo_id));
      const plantaParadaAtiva = (paradaRows ?? []).length > 0;
      let pendentesPlanos = 0;
      for (const p of planosPreventivos) {
        if (jaProgramadosSet.has(p.id)) continue;
        const efetiva = periodicidadeEfetiva(p.periodicidade_valor, p.periodicidade_unidade, plantaParadaAtiva);
        const proximaData = calcularProximaData(p.ultima_execucao, efetiva.valor, efetiva.unidade);
        const vencendo = proximaData === null || (proximaData >= segunda && proximaData <= sexta);
        if (vencendo) pendentesPlanos++;
      }
      const programadasPlanosSet = new Set(ordensDaSemana.filter(o => o.plano_preventivo_id).map(o => o.plano_preventivo_id));
      const programadasPlanos = programadasPlanosSet.size;
      const totalPlanos = pendentesPlanos + programadasPlanos;
      indicadores.atendimentoPlanos = {
        programadas: programadasPlanos, pendentes: pendentesPlanos,
        percentual: totalPlanos > 0 ? Math.round((programadasPlanos / totalPlanos) * 100) : 0,
      };

      // HH por área e por colaborador — soma direto por linha (não agrupa por OS: cada
      // técnico lançou seu próprio esforço, 2 pessoas na mesma OS é HH real somado, não
      // duplicado).
      const hhAreaMap = new Map();
      const hhColabMap = new Map();
      for (const o of ordensDaSemana) {
        const horas = Number(o.duracao_horas) || 0;
        hhAreaMap.set(o.area, (hhAreaMap.get(o.area) ?? 0) + horas);
        if (o.tecnico_nome) hhColabMap.set(o.tecnico_nome, (hhColabMap.get(o.tecnico_nome) ?? 0) + horas);
      }
      indicadores.hhPorArea = [...hhAreaMap.entries()]
        .map(([area, horas]) => ({ area, horas: Math.round(horas * 10) / 10 }))
        .sort((a, b) => b.horas - a.horas);
      indicadores.hhPorColaborador = [...hhColabMap.entries()]
        .map(([nome, horas]) => ({ nome, horas: Math.round(horas * 10) / 10 }))
        .sort((a, b) => b.horas - a.horas)
        .slice(0, 8);

      // Principais equipamentos com corretiva na semana — conta OS distintas (não
      // linhas) por equipamento, só tipo_servico=CORRETIVA.
      const corretivasPorEquip = new Map();
      for (const o of ordensDaSemana) {
        if ((o.tipo_servico || '').toUpperCase() !== 'CORRETIVA') continue;
        const equipamento = (o.equipamento || '').trim();
        if (!equipamento) continue;
        const setOs = corretivasPorEquip.get(equipamento) ?? new Set();
        setOs.add(o.numero_os ? normalizarNumeroOs(o.numero_os) : `sem-os-${setOs.size}`);
        corretivasPorEquip.set(equipamento, setOs);
      }
      indicadores.equipamentosCorretivas = [...corretivasPorEquip.entries()]
        .map(([equipamento, setOs]) => ({ equipamento, quantidade: setOs.size }))
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 5);
    } catch (indicadoresError) {
      console.error('[kanban-atividades-publico] Falha ao calcular indicadores da semana:', indicadoresError.message);
    }

    return res.status(200).json({ success: true, atualizadoEm: Date.now(), colunas, indicadores });
  } catch (error) {
    console.error('[kanban-atividades-publico] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao carregar o quadro.' });
  }
}
