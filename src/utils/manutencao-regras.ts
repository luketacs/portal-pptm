// Regras de negócio da Programação de Manutenção extraídas do componente pra funções
// puras testáveis — capacidade semanal, bloqueio de duplicata/folga/férias e o
// espelhamento de "Recursos" (quem entra na cópia da OS pro apoio) são as áreas que
// mais geraram bug nesta funcionalidade (dado sutil errado, direção de checagem
// faltando, recurso incluindo a si mesmo), por isso ganham teste dedicado.
import { AtestadoTecnico, EquipeApoioItem, FeriasTecnico, ManutencaoArea, ManutencaoOrdem } from '../models/manutencao-programacao.model';
import { Colaborador } from '../services/apontamentos.service';

export const HORAS_EXAME_MEDICO = 3.5;
// Treinamento desconta por dia (customizável por lançamento, ver duracaoHoras) — sem
// valor informado (lançamentos antigos, de antes desse campo existir pro tipo
// treinamento, ou quem não preencheu), assume "dia todo".
export const HORAS_TREINAMENTO_DIA_TODO = 6.5;
export const HORAS_TREINAMENTO_MEIO_PERIODO = 3.5;

export interface DiaSemana {
  data: string;
  label: string;
}

export interface CalcularCapacidadeSemanaParams {
  dias: DiaSemana[];
  disponibilidadePorDia: Map<string, number>;
  diasFolga: Set<string>;
  diasExameMedico: Set<string>;
  // Dia -> horas de treinamento a descontar naquele dia (soma se houver mais de um
  // lançamento no mesmo dia). Opcional pra não quebrar quem já chama essa função sem
  // treinamento pra considerar.
  horasTreinamentoPorDia?: Map<string, number>;
  feriasIntervalo: { dataInicio: string; dataFim: string } | null;
  // Período de atestado médico do técnico que toca a semana — mesmo efeito de
  // feriasIntervalo (tira o dia inteiro da conta), motivo diferente. Opcional pra não
  // quebrar quem já chama essa função sem considerar atestado.
  atestadoIntervalo?: { dataInicio: string; dataFim: string } | null;
}

// Soma a disponibilidade base nos dias úteis (SEG-SEX — fim de semana é DSR, ninguém
// trabalha por padrão). Folga e dias dentro do período de férias OU atestado médico
// tiram o dia inteiro da conta; exame médico (ASO) só desconta HORAS_EXAME_MEDICO
// daquele dia (o exame não toma o dia todo); treinamento desconta o valor de
// horasTreinamentoPorDia daquele dia (6,5 = dia todo, 3,5 = meio período, ou outro
// valor customizado no lançamento); reunião não desconta nada (não bloqueia o resto da
// agenda do dia).
export function calcularCapacidadeSemana(params: CalcularCapacidadeSemanaParams): number {
  const { dias, disponibilidadePorDia, diasFolga, diasExameMedico, horasTreinamentoPorDia, feriasIntervalo, atestadoIntervalo } = params;
  let total = 0;
  for (const dia of dias) {
    if (dia.label === 'SAB' || dia.label === 'DOM') continue;
    if (diasFolga.has(dia.data)) continue;
    if (feriasIntervalo && dia.data >= feriasIntervalo.dataInicio && dia.data <= feriasIntervalo.dataFim) continue;
    if (atestadoIntervalo && dia.data >= atestadoIntervalo.dataInicio && dia.data <= atestadoIntervalo.dataFim) continue;
    let disponivel = disponibilidadePorDia.get(dia.data) ?? 0;
    if (diasExameMedico.has(dia.data)) disponivel = Math.max(0, disponivel - HORAS_EXAME_MEDICO);
    const horasTreinamento = horasTreinamentoPorDia?.get(dia.data);
    if (horasTreinamento) disponivel = Math.max(0, disponivel - horasTreinamento);
    total += disponivel;
  }
  return parseFloat(total.toFixed(2));
}

// Período de férias do técnico que toca algum dos dias informados.
export function encontrarFeriasNoIntervalo(ferias: FeriasTecnico[], tecnicoNome: string, diasIso: string[]): FeriasTecnico | null {
  if (diasIso.length === 0) return null;
  return ferias.find(f => f.tecnicoNome === tecnicoNome && diasIso.some(d => d >= f.dataInicio && d <= f.dataFim)) ?? null;
}

// Mesma ideia de encontrarFeriasNoIntervalo, pra atestado médico.
export function encontrarAtestadoNoIntervalo(atestados: AtestadoTecnico[], tecnicoNome: string, diasIso: string[]): AtestadoTecnico | null {
  if (diasIso.length === 0) return null;
  return atestados.find(a => a.tecnicoNome === tecnicoNome && diasIso.some(d => d >= a.dataInicio && d <= a.dataFim)) ?? null;
}

// Folga já lançada pro técnico que toca algum dos dias informados — usada nos três
// pontos de criação (form individual, lote de Reunião, lote de Feriado) pra nunca
// lançar nada em cima de um dia de folga já existente, nas duas direções.
export function encontrarFolgaNoIntervalo(
  ordens: ManutencaoOrdem[], tecnicoNome: string, diasIso: string[], idExcluir?: string | null,
): ManutencaoOrdem | null {
  if (diasIso.length === 0) return null;
  return ordens.find(o =>
    o.tipo === 'folga' && o.tecnicoNome === tecnicoNome && o.id !== idExcluir && o.diasPrevistos.some(d => diasIso.includes(d)),
  ) ?? null;
}

// Mesma OS já lançada pro mesmo técnico em algum dos dias informados — `numeroOsNormalizado`
// já deve vir normalizado (ver normalizarNumeroOs no componente) pra "45203" e "045203"
// baterem como a mesma OS.
export function encontrarOrdemDuplicada(
  ordens: ManutencaoOrdem[], numeroOsNormalizado: string, tecnicoNome: string, diasIso: string[],
  normalizar: (v: string) => string, idExcluir?: string | null,
): ManutencaoOrdem | null {
  if (!numeroOsNormalizado.trim() || diasIso.length === 0) return null;
  return ordens.find(o =>
    o.id !== idExcluir && o.tipo === 'ordem' && o.tecnicoNome === tecnicoNome
      && !!o.numeroOs && normalizar(o.numeroOs) === numeroOsNormalizado
      && o.diasPrevistos.some(d => diasIso.includes(d)),
  ) ?? null;
}

// Monta o texto do campo "Recursos" pra cópia espelhada de uma OS: da perspectiva de
// quem recebe a cópia, "Recursos" é quem MAIS está no serviço — o mandante (quem
// lançou a OS original) e os outros ajudantes, nunca a própria pessoa/empresa que está
// recebendo a cópia (senão ela aparece listada como recurso de si mesma). `ehODestinatario`
// deixa o chamador decidir o critério de exclusão: nome exato (espelho pra técnico) ou
// mapeamento pra empresa (espelho pra empresa/equipamento, onde duas opções diferentes
// podem apontar pra mesma empresa).
export function recursosParaEspelho(recursosOriginais: string[], ehODestinatario: (recurso: string) => boolean, mandante: string): string {
  return [...recursosOriginais.filter(r => !ehODestinatario(r)), mandante].join(', ');
}

// Semana fechada (ver "Fechar programação da semana", migration 031) — só Admin
// consegue criar/editar/excluir lançamento numa semana fechada; pra todo mundo mais
// vira somente leitura. Mesma regra usada tanto pro guard que bloqueia a mutação no
// serviço (garantirSemanaAberta) quanto pra decidir se mostra os botões habilitados na
// tela (podeEditarSemana no componente) — uma função só, pra nunca divergir entre os
// dois lugares.
export function podeEditarSemanaFechada(semanaFechada: boolean, ehAdmin: boolean): boolean {
  return !semanaFechada || ehAdmin;
}

// ── Helpers de data/texto da Programação — movidos do componente pra dar pra usar nos
// subcomponentes extraídos (modais) sem depender de método privado do host. ──────────

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

export function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Datas reais (não rótulos) da semana SEG–SEX a partir da segunda-feira ('YYYY-MM-DD').
export function diasDaSemana(segundaIso: string): { data: string; label: string }[] {
  const [ano, mes, dia] = segundaIso.split('-').map(Number);
  return DIAS_SEMANA_LABEL.map((label, i) => {
    const d = new Date(ano, mes - 1, dia + i);
    return { data: paraIso(d), label };
  });
}

export function normalizarTexto(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Mesma normalização usada em api/sigma-ordens-proxy.js — precisa bater pra achar a
// chave certa no resultado (o SIGMA usa número de OS com 6 dígitos e zero à esquerda).
export function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

export function formatarDataBr(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function diaMesPadded(dataIso: string): string {
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

// LOTO (bloqueio do equipamento) tem só essas 3 opções — é o que evita duas equipes
// baterem de frente (uma precisando do equipamento rodando, outra precisando parado).
const LOTO_BADGE: Record<string, string> = {
  LOTO: 'bg-red-100 text-red-700',
  'SEM LOTO': 'bg-slate-100 text-slate-600',
  FUNCIONANDO: 'bg-green-100 text-green-700',
};
const LOTO_BADGE_PADRAO = 'bg-slate-50 text-slate-400';

export function lotoBadgeClass(loto: string): string {
  return LOTO_BADGE[loto.toUpperCase()] ?? LOTO_BADGE_PADRAO;
}

// Dica curta do hover nativo (title) do quadro de LOTO — o detalhe completo fica no
// painel de clique, não faz sentido duplicar tudo aqui também.
export function conflitoLotoTitle(itens: { status: string; descricao: string; tecnicos: string[] }[]): string {
  return `Conflito: ${itens.map(i => `${i.status} (${i.tecnicos.join(', ')})`).join(' vs. ')} — clique pra ver detalhes`;
}

// ── Validação de bloqueio do técnico (férias/atestado/folga) e de OS duplicada —
// promovidas de métodos privados do componente pra função pura, pra dar pra chamar dos
// modais extraídos (Reunião em lote, +Apoio) sem depender do host. ──────────────────

// Sequência "está de férias? atestado? folga?" (nessa ordem de precedência) — ponto
// único de verdade pra ordem e pro texto de cada motivo.
export function bloqueioDoTecnico(
  ferias: FeriasTecnico[], atestados: AtestadoTecnico[], ordens: ManutencaoOrdem[],
  nome: string, dias: string[], idExcluir?: string | null,
): { tipo: 'ferias' | 'atestado' | 'folga'; motivo: string } | null {
  const feriasEncontrada = encontrarFeriasNoIntervalo(ferias, nome, dias);
  if (feriasEncontrada) {
    return { tipo: 'ferias', motivo: `${nome} está de férias de ${formatarDataBr(feriasEncontrada.dataInicio)} a ${formatarDataBr(feriasEncontrada.dataFim)}.` };
  }
  const atestado = encontrarAtestadoNoIntervalo(atestados, nome, dias);
  if (atestado) {
    return { tipo: 'atestado', motivo: `${nome} está de atestado médico de ${formatarDataBr(atestado.dataInicio)} a ${formatarDataBr(atestado.dataFim)}.` };
  }
  const folga = encontrarFolgaNoIntervalo(ordens, nome, dias, idExcluir);
  if (folga) return { tipo: 'folga', motivo: `${nome} já está de folga em algum desses dias.` };
  return null;
}

export type TipoBloqueio = 'ferias' | 'atestado' | 'folga';

// Ajudantes (técnicos em "Recursos") que estão de férias/atestado/folga em algum dos dias
// marcados PRA ELES no apoio — esses não recebem a cópia da OS. Chave = o recurso como foi
// digitado (é assim que o cartão "Dias de cada apoio" é indexado); `nome` = nome cadastrado.
// Fica de fora: o próprio mandante, recurso que não é técnico (MUNCK, ANDAIME...) e recurso
// ainda sem dia marcado (esse caso já barra o salvar por outra regra).
export function bloqueiosDoApoio(
  recursos: string[],
  diasPorRecurso: Record<string, string[]>,
  tecnicos: { nome: string }[],
  mandante: string,
  bloqueio: (nome: string, dias: string[]) => { tipo: TipoBloqueio; motivo: string } | null,
): Record<string, { nome: string; tipo: TipoBloqueio; motivo: string }> {
  const resultado: Record<string, { nome: string; tipo: TipoBloqueio; motivo: string }> = {};
  for (const recurso of recursos) {
    const tecnico = tecnicos.find(t => t.nome.toUpperCase() === recurso.toUpperCase());
    if (!tecnico || tecnico.nome.toUpperCase() === mandante.trim().toUpperCase()) continue;
    const dias = diasPorRecurso[recurso] ?? [];
    if (dias.length === 0) continue;
    const b = bloqueio(tecnico.nome, dias);
    if (b) resultado[recurso] = { nome: tecnico.nome, tipo: b.tipo, motivo: b.motivo };
  }
  return resultado;
}

const MOTIVO_CURTO: Record<TipoBloqueio, string> = { ferias: 'férias', atestado: 'atestado médico', folga: 'folga' };

// Mensagem ÚNICA do fim do salvar (OS principal + cópias de apoio). O toast só mostra uma
// mensagem por vez — antes cada aviso ("X está de férias — não foi programado") era
// disparado em sequência e logo sobrescrito por "Também programado pra Y", então quem
// lançava achava que todos os ajudantes tinham sido programados.
export function resumoGravacaoApoio(params: {
  principal: string;
  programados: string[];
  naoProgramados: { nome: string; tipo: TipoBloqueio }[];
  erroApoio?: { nomes: string[]; mensagem: string } | null;
}): { tipo: 'success' | 'warning' | 'error'; mensagem: string; duracaoMs: number } {
  const partes = [params.principal];
  if (params.programados.length > 0) partes.push(`Apoio programado pra ${params.programados.join(', ')}.`);
  if (params.erroApoio) {
    partes.push(`Mas o apoio pra ${params.erroApoio.nomes.join(', ')} NÃO foi programado: ${params.erroApoio.mensagem}`);
  }
  if (params.naoProgramados.length > 0) {
    partes.push(`NÃO programado (indisponível): ${params.naoProgramados.map(n => `${n.nome} (${MOTIVO_CURTO[n.tipo]})`).join(', ')}.`);
  }
  const mensagem = partes.join(' ');
  if (params.erroApoio) return { tipo: 'error', mensagem, duracaoMs: 12000 };
  if (params.naoProgramados.length > 0) return { tipo: 'warning', mensagem, duracaoMs: 12000 };
  return { tipo: 'success', mensagem, duracaoMs: params.programados.length > 0 ? 5000 : 4000 };
}

const DIAS_UTEIS = new Set(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);

// Férias/atestado do técnico que tocam a semana em exibição, com os dias úteis dela que
// caem dentro do período — vira uma linha "Férias"/"Atestado" no card do técnico, no
// mesmo formato de uma folga (BH), pra deixar claro em quais dias ele está indisponível.
export function indisponibilidadesNaSemana(
  ferias: FeriasTecnico[], atestados: AtestadoTecnico[], tecnicoNome: string, dias: { data: string; label: string }[],
): { tipo: 'ferias' | 'atestado'; dataInicio: string; dataFim: string; dias: string[] }[] {
  const periodos = [
    ...ferias.filter(f => f.tecnicoNome === tecnicoNome).map(f => ({ tipo: 'ferias' as const, dataInicio: f.dataInicio, dataFim: f.dataFim })),
    ...atestados.filter(a => a.tecnicoNome === tecnicoNome).map(a => ({ tipo: 'atestado' as const, dataInicio: a.dataInicio, dataFim: a.dataFim })),
  ];
  return periodos
    .map(p => ({ ...p, dias: dias.filter(d => DIAS_UTEIS.has(d.label) && d.data >= p.dataInicio && d.data <= p.dataFim).map(d => d.label) }))
    .filter(p => p.dias.length > 0);
}

// Quais OS consultar no SIGMA. Trocou de semana: todas as visíveis (status fresco da
// semana nova). Mesma semana: só as que ainda não têm resultado — antes, cada salvar
// refazia a consulta da semana inteira (~3,5 s com o spinner girando), porque a lista de
// números era recriada a cada mudança na programação, mesmo sem número novo.
export function numerosSigmaParaConsultar(numerosVisiveis: string[], jaConsultados: Set<string>, semanaMudou: boolean): string[] {
  if (semanaMudou) return numerosVisiveis;
  return numerosVisiveis.filter(n => !jaConsultados.has(normalizarNumeroOs(n)));
}

export const LIMITE_GRAVACAO_LENTA_MS = 5000;

// Telemetria do salvar da Programação: registra na auditoria só o que interessa pra achar
// o travamento intermitente relatado (gravação lenta ou com erro), com o contexto que
// separa as hipóteses — há quanto tempo a tela estava aberta (sessão/token velho), se a
// aba estava visível e se o navegador estava online.
export function avaliarGravacao(params: {
  operacao: 'criar' | 'editar' | 'apoio';
  ms: number;
  erro: { name?: string; message: string; code?: string } | null;
  msDesdeAbertura: number;
  visivel: boolean;
  online: boolean;
}): { event_type: string; description: string; metadata: Record<string, unknown> } | null {
  if (!params.erro && params.ms < LIMITE_GRAVACAO_LENTA_MS) return null;
  const metadata: Record<string, unknown> = {
    operacao: params.operacao,
    ms: Math.round(params.ms),
    minutos_tela_aberta: Math.round(params.msDesdeAbertura / 60000),
    aba_visivel: params.visivel,
    online: params.online,
  };
  if (params.erro) {
    metadata['erro_nome'] = params.erro.name ?? null;
    metadata['erro_codigo'] = params.erro.code ?? null;
    metadata['erro_mensagem'] = params.erro.message;
    return {
      event_type: 'manutencao_programacao_salvar_falha',
      description: `Falha ao salvar na Programação (${params.operacao}) após ${Math.round(params.ms)} ms: ${params.erro.message}`,
      metadata,
    };
  }
  return {
    event_type: 'manutencao_programacao_salvar_lento',
    description: `Salvar na Programação (${params.operacao}) levou ${Math.round(params.ms)} ms`,
    metadata,
  };
}

// Mesma OS já lançada pro mesmo técnico em algum dos dias informados — compara o número
// normalizado (mesma lógica da consulta ao SIGMA), não o texto digitado.
export function ordemDuplicada(
  ordens: ManutencaoOrdem[], numeroOs: string, tecnicoNome: string, diasIso: string[], idExcluir?: string | null,
): ManutencaoOrdem | null {
  if (!numeroOs.trim()) return null;
  return encontrarOrdemDuplicada(ordens, normalizarNumeroOs(numeroOs), tecnicoNome, diasIso, normalizarNumeroOs, idExcluir);
}

// ── Lista de técnicos por área — promovida de método privado do componente. ─────────

// Técnicos que saíram da área mas cuja matrícula continua na planilha de colaboradores —
// tirar do cadastro direto faz ordens antigas (que já executaram de verdade) aparecerem
// erradas como "Não Executadas" pra semanas anteriores ao corte (ver mesmo mapa/motivo em
// manutencao-indicadores-semanais.component.ts).
export const TECNICOS_INATIVOS_A_PARTIR_DE: Record<string, string> = {
  'ALEXANDRE GOMES': '2026-09-14',
  'JOAQUIM NETO': '2026-08-24',
};

export function tecnicosPorArea(
  area: ManutencaoArea, colaboradores: Colaborador[], equipesApoio: EquipeApoioItem[], semanaFiltro: string,
): { nome: string; matricula: string | null }[] {
  if (area === 'APOIO') {
    return equipesApoio.map(e => ({ nome: e.nome, matricula: null }));
  }
  const termo = area === 'ELETRICA' ? 'ELETR' : 'MECAN';
  return colaboradores
    .filter(c => normalizarTexto(c.area).includes(termo))
    .filter(c => {
      const corte = TECNICOS_INATIVOS_A_PARTIR_DE[normalizarTexto(c.nome)];
      return !corte || semanaFiltro < corte;
    })
    .map(c => ({ nome: c.nome, matricula: c.matricula }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// Todos os técnicos das duas áreas (Elétrica + Mecânica) — usado no lançamento de
// feriado/reunião, que valem pra equipe toda. Apoio fica de fora (folga/reunião são
// conceitos por pessoa, e lá quem aparece é empresa/equipe).
export function todosTecnicos(
  colaboradores: Colaborador[], equipesApoio: EquipeApoioItem[], semanaFiltro: string,
): { nome: string; matricula: string | null; area: ManutencaoArea }[] {
  return [
    ...tecnicosPorArea('ELETRICA', colaboradores, equipesApoio, semanaFiltro).map(c => ({ ...c, area: 'ELETRICA' as ManutencaoArea })),
    ...tecnicosPorArea('MECANICA', colaboradores, equipesApoio, semanaFiltro).map(c => ({ ...c, area: 'MECANICA' as ManutencaoArea })),
  ];
}
