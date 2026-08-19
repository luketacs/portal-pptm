// Reconcilia horas apontadas por OS (planilha "Fechamento Semanal", aba
// "Apontamentos") com horas programadas (Programação) e horas disponíveis (Ponto) —
// fecha a Fase 3 do Relatório Mensal PCM. Port fiel de calcular_horas_e_ordens_apontadas
// (mensal.py), incluindo a auditoria de qualidade dos apontamentos: remove duplicatas
// exatas, descarta valores impossíveis (>24h num único apontamento) e, quando o total
// do dia de um colaborador excede 24h, escala todos os apontamentos daquele dia
// proporcionalmente — cada ajuste vira uma "ocorrência não contabilizada" exibida no
// relatório, em vez de ser silenciosamente descartado.

import { OrigemPrograma, RegistroMatricula, mapearNomeProgramacaoParaMatricula, matriculaSuffix6, normalizarNomeColaborador } from './relatorio-colaboradores';
import { HorasPontoPagina } from './relatorio-ponto';
import { HorasProgramadasPorColaborador } from './relatorio-programacao-semanal';

export interface NomeNaoMapeado {
  origem: OrigemPrograma;
  nomePrograma: string;
  horas: number;
}

export type TipoOcorrenciaNaoContabilizada = 'Duplicado' | 'Valor impossível' | 'Excesso diário';

export interface OcorrenciaNaoContabilizada {
  tipo: TipoOcorrenciaNaoContabilizada;
  nome: string;
  matricula: string;
  ordem: string;
  data: string; // dd/mm/aaaa
  horas: number;
  motivo: string;
}

export interface ColaboradorHoras {
  matricula: string;
  funcionario: string;
  area: string;
  horasApontadas: number;
  horasProgramadas: number | null;
  horasDisponiveis: number | null;
  qtdOrdens: number;
  ordensLista: string[];
  areasAtuacao: string[]; // áreas de manutenção (coluna "Área Manutenção" do Fechamento) em que apontou horas no período
}

export interface DadosHoras {
  horasGeral: number;
  horasPorArea: Record<string, number>;
  horasPorColaborador: ColaboradorHoras[];
  ordensUnicasPeriodo: number;
  totalApontamentos: number;
  diasPeriodo: number;
  totalColaboradores: number;
  colaboradoresComOrdens: number;
  ocorrenciasNaoContabilizadas: OcorrenciaNaoContabilizada[];
  descricoesOrdens: Record<string, string>; // nº da OS -> descrição (coluna "Feedback" do Apontamentos)
}

// Marcio Gleyson (supervisor) — nunca aparece no relatório de horas, mesmo que tenha
// apontamentos (mesma exclusão do original).
const MATRICULAS_EXCLUIDAS_RELATORIO = new Set(['20006139']);
const MAX_H_LINHA = 24; // máximo físico por apontamento
const MAX_H_DIA = 24;   // máximo físico por colaborador por dia

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function normalizarAscii(texto: string): string {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Colaboradores da Operação atualmente emprestados pra manutenção — lista mantida
// manualmente (igual MATRICULAS_EXCLUIDAS_RELATORIO), porque não dá pra inferir
// isso só pelos dados: um colaborador de Operação pode aparecer no Fechamento
// Semanal por outros motivos, e um que está emprestado pode não ter apontado nada
// numa semana específica (e mesmo assim precisa aparecer, com 0h).
export const MATRICULAS_OPERACAO_EM_MANUTENCAO = new Set([
  '20005480', // Alexandre Gomes
  '20006309', // Mauro Teixeira
  '20005985', // Joaquim Neto
  '710624',   // William
]);

// Monta a linha de cada colaborador da lista acima — usa os dados de horas/ordens
// se ele apontou algo no período, ou zera se não apontou nada (ainda assim aparece,
// pro gestor da Operação ver que não trabalhou em manutenção naquele período).
export function colaboradoresOperacaoEmManutencao(
  colaboradores: ColaboradorHoras[], matriculas: RegistroMatricula[],
): ColaboradorHoras[] {
  return matriculas
    .filter(m => MATRICULAS_OPERACAO_EM_MANUTENCAO.has(m.matricula))
    .map(m => colaboradores.find(c => c.matricula === m.matricula) ?? {
      matricula: m.matricula, funcionario: m.funcionario, area: m.area,
      horasApontadas: 0, horasProgramadas: null, horasDisponiveis: null,
      qtdOrdens: 0, ordensLista: [], areasAtuacao: [],
    });
}

// Descrição resumida de uma OS pra caber numa linha da coluna "Ordens (OS)" sem
// poluir a tabela — o texto completo não é descartado (fica em descricoesOrdens),
// só a exibição é encurtada.
export function descricaoCurtaOrdem(
  descricoesOrdens: Record<string, string>, numero: string, tamanhoMaximo = 60,
): string {
  const descricao = descricoesOrdens[numero];
  if (!descricao) return '';
  return descricao.length > tamanhoMaximo ? `${descricao.slice(0, tamanhoMaximo).trim()}…` : descricao;
}

function areaEOperacao(area: string): boolean {
  return normalizarAscii(area).includes('OPERACAO');
}

function areaOcultaRelatorio(area: string): boolean {
  return normalizarAscii(area).trim() === 'OUTROS';
}

// Combina os totais "nome curto -> horas" de cada aba de Programação (já extraídos
// por extrairHorasProgramadasSemana) com a matrícula real de cada colaborador.
export function mapearHorasProgramadasParaMatricula(
  origens: { origem: OrigemPrograma; totais: HorasProgramadasPorColaborador }[],
  matriculas: RegistroMatricula[],
): { horasPorMatricula: Record<string, number>; naoMapeados: NomeNaoMapeado[] } {
  const horasPorMatricula: Record<string, number> = {};
  const naoMapeados: NomeNaoMapeado[] = [];

  for (const { origem, totais } of origens) {
    for (const [nomePrograma, horas] of Object.entries(totais)) {
      const nomeNorm = normalizarNomeColaborador(nomePrograma);
      const matricula = mapearNomeProgramacaoParaMatricula(nomeNorm, origem, matriculas);
      if (!matricula) {
        naoMapeados.push({ origem, nomePrograma, horas });
        continue;
      }
      horasPorMatricula[matricula] = round2((horasPorMatricula[matricula] ?? 0) + horas);
    }
  }

  return { horasPorMatricula, naoMapeados };
}

// Combina os totais "matrícula-sufixo(6) -> horas" extraídos do PDF de Ponto (já
// agregados por agregarHorasPonto) com a matrícula completa de cada colaborador.
export function mapearHorasDisponiveisPonto(
  totaisPonto: Map<string, HorasPontoPagina>,
  matriculas: RegistroMatricula[],
): Record<string, number> {
  const idxM6ParaFull = new Map<string, string>();
  for (const registro of matriculas) {
    const m6 = matriculaSuffix6(registro.matricula);
    if (m6 && !idxM6ParaFull.has(m6)) idxM6ParaFull.set(m6, registro.matricula);
  }

  const horasPorMatricula: Record<string, number> = {};
  for (const [m6, pagina] of totaisPonto) {
    const matFull = idxM6ParaFull.get(m6);
    if (matFull) horasPorMatricula[matFull] = pagina.horas;
  }
  return horasPorMatricula;
}

interface ColunasApontamentos {
  colExecutante: number;
  colData: number;
  colHoraInicio: number;
  colHoraFim: number;
  colAlmoco: number;    // -1 = coluna não existe, assume sem almoço
  colOrdem: number;     // -1 = coluna não existe, assume sem ordem
  colArea: number;      // -1 = coluna não existe, assume sem área de atuação
  colDescricao: number; // -1 = coluna não existe, assume sem descrição
}

const ALIASES: Record<keyof Omit<ColunasApontamentos, 'colAlmoco' | 'colOrdem' | 'colArea' | 'colDescricao'>, string[]> = {
  colExecutante: ['EXECUTANTE', 'FUNCIONARIO', 'FUNCIONARIO(A)'],
  colData: ['DATA'],
  colHoraInicio: ['HORA INICIAL', 'HORARIO INICIAL', 'HORA INICIO', 'INICIO'],
  colHoraFim: ['HORA FINAL', 'HORARIO FINAL', 'HORA FIM', 'HORA TERMINO', 'FIM'],
};
const ALIASES_ALMOCO = ['INTERVALO ALMOCO', 'INTERCALO ALMOCO', 'ALMOCO'];
const ALIASES_ORDEM = ['OS PROTHEUS', 'ORDEM PROTHEUS', 'OS', 'ORDEM', 'ORDEM DE SERVICO'];
const ALIASES_AREA = ['AREA MANUTENCAO', 'AREA DE MANUTENCAO', 'AREA'];
// A descrição do que foi feito na OS fica na coluna "Feedback" na planilha real.
const ALIASES_DESCRICAO = ['FEEDBACK', 'DESCRICAO', 'DESCRICAO DA ORDEM', 'DESCRICAO DA OS'];

function acharColuna(header: unknown[], aliases: string[]): number {
  for (let c = 0; c < header.length; c++) {
    const rotulo = normalizarAscii(String(header[c] ?? '')).trim();
    if (aliases.includes(rotulo)) return c;
  }
  return -1;
}

function localizarColunasApontamentos(header: unknown[]): ColunasApontamentos {
  const colExecutante = acharColuna(header, ALIASES.colExecutante);
  const colData = acharColuna(header, ALIASES.colData);
  const colHoraInicio = acharColuna(header, ALIASES.colHoraInicio);
  const colHoraFim = acharColuna(header, ALIASES.colHoraFim);
  const colAlmoco = acharColuna(header, ALIASES_ALMOCO);
  const colOrdem = acharColuna(header, ALIASES_ORDEM);
  const colArea = acharColuna(header, ALIASES_AREA);
  const colDescricao = acharColuna(header, ALIASES_DESCRICAO);

  const faltando: string[] = [];
  if (colExecutante === -1) faltando.push('Executante');
  if (colData === -1) faltando.push('Data');
  if (colHoraInicio === -1) faltando.push('Hora Inicial');
  if (colHoraFim === -1) faltando.push('Hora Final');
  if (faltando.length > 0) {
    throw new Error(`Não foi possível localizar as colunas ${faltando.join(', ')} na planilha de Apontamentos.`);
  }

  return { colExecutante, colData, colHoraInicio, colHoraFim, colAlmoco, colOrdem, colArea, colDescricao };
}

// A coluna "Área Manutenção" vem com abreviações bem inconsistentes na planilha
// real (MEC/MECA, ELE/ELET, além de várias outras menos comuns). Só traduz as
// duas que interessam pro relatório de Operadores na Manutenção (de onde vieram
// -- Mecânica ou Elétrica); qualquer outra abreviação aparece como veio, sem
// arriscar uma tradução errada.
function normalizarAreaManutencao(valor: string): string {
  const v = normalizarAscii(valor).trim();
  if (v.startsWith('MEC')) return 'Mecânica';
  if (v.startsWith('ELE')) return 'Elétrica';
  return valor.trim();
}

function normalizarMatricula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor).trim();
  if (['nan', 'none', ''].includes(texto.toLowerCase())) return '';
  if (texto.endsWith('.0')) texto = texto.slice(0, -2);
  return texto;
}

// Excel guarda datas como nº de dias desde 1899-12-30 (epoch do Excel).
function parseDataApontamento(valor: unknown): Date | null {
  if (valor instanceof Date) return new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()));
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
  }
  if (typeof valor === 'string') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(valor.trim());
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  return null;
}

// Excel guarda horários como fração do dia (0.5 = 12:00). Aceita também "HH:MM".
function parseHoraDecimal(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor * 24;
  if (typeof valor === 'string') {
    const v = valor.trim();
    const m = /^(\d{1,2}):(\d{2})/.exec(v);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    const f = parseFloat(v.replace(',', '.'));
    return Number.isFinite(f) ? f : null;
  }
  return null;
}

function calcularHorasEntre(horaInicioDecimal: number, horaFimDecimal: number): number {
  let fim = horaFimDecimal;
  if (fim < horaInicioDecimal) fim += 24; // apontamento cruzou a meia-noite
  return Math.max(fim - horaInicioDecimal, 0);
}

// Mesma checagem "solta" do original: qualquer string contendo a letra "s" também
// conta como almoço marcado. Inofensivo na prática porque a coluna real só usa 0/1.
function temAlmoco(valor: unknown): boolean {
  if (valor === 1 || valor === '1' || valor === true) return true;
  const s = String(valor ?? '').toLowerCase().trim();
  return s.includes('sim') || s.includes('s');
}

function limparOrdemProtheus(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  const invalidos = ['', 'n/a', 'nan', 'none', '-', '--', '---'];
  if (invalidos.includes(texto.toLowerCase())) return null;
  const numeros = texto.match(/\d+/g);
  if (numeros && numeros.length > 0) return String(parseInt(numeros[0], 10));
  if (texto.length > 2 && /\d/.test(texto)) return texto;
  return null;
}

function formatarDataBr(data: Date): string {
  const dd = String(data.getUTCDate()).padStart(2, '0');
  const mm = String(data.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${data.getUTCFullYear()}`;
}

interface ApontamentoLinha {
  matricula: string;
  data: Date;
  horaInicioDecimal: number;
  horaFimDecimal: number;
  horasApontadas: number;
  ordemRaw: unknown;
  areaRaw: unknown;
  descricaoRaw: unknown;
}

export function calcularHorasEOrdensApontadas(
  rows: unknown[][],
  opts: {
    dataInicio: Date;
    dataFim: Date;
    matriculas: RegistroMatricula[];
    horasProgramadasPorMatricula: Record<string, number>;
    horasDisponiveisPorMatricula: Record<string, number>;
  },
): DadosHoras {
  const { dataInicio, dataFim, matriculas, horasProgramadasPorMatricula, horasDisponiveisPorMatricula } = opts;
  if (rows.length === 0) {
    throw new Error('Planilha de Apontamentos vazia.');
  }

  const colunas = localizarColunasApontamentos(rows[0] ?? []);
  const matriculaParaNome = new Map(matriculas.map(m => [m.matricula, m.funcionario]));
  const nomeColabo = (matricula: string) => matriculaParaNome.get(matricula) ?? matricula;

  // 1) Parseia e calcula horas de cada linha (independente do período).
  const todasLinhas: ApontamentoLinha[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const matricula = normalizarMatricula(row[colunas.colExecutante]);
    const data = parseDataApontamento(row[colunas.colData]);
    const hInicio = parseHoraDecimal(row[colunas.colHoraInicio]);
    const hFim = parseHoraDecimal(row[colunas.colHoraFim]);
    if (!matricula || !data || hInicio === null || hFim === null) continue;

    const horasBrutas = calcularHorasEntre(hInicio, hFim);
    const almoco = colunas.colAlmoco >= 0 ? temAlmoco(row[colunas.colAlmoco]) : false;
    const horasApontadas = Math.max(almoco ? horasBrutas - 1 : horasBrutas, 0);
    const ordemRaw = colunas.colOrdem >= 0 ? row[colunas.colOrdem] : 'N/A';
    const areaRaw = colunas.colArea >= 0 ? row[colunas.colArea] : undefined;
    const descricaoRaw = colunas.colDescricao >= 0 ? row[colunas.colDescricao] : undefined;

    todasLinhas.push({ matricula, data, horaInicioDecimal: hInicio, horaFimDecimal: hFim, horasApontadas, ordemRaw, areaRaw, descricaoRaw });
  }

  // 2) Filtra pelo período do fechamento.
  let linhasPeriodo = todasLinhas.filter(l => l.data >= dataInicio && l.data <= dataFim);

  // 3) Auditoria de qualidade -- cada ajuste vira uma ocorrência "não contabilizada".
  const ocorrencias: OcorrenciaNaoContabilizada[] = [];

  // 3a. Remove duplicatas exatas (mesma matrícula + data + horário).
  const vistos = new Set<string>();
  const semDuplicadas: ApontamentoLinha[] = [];
  for (const linha of linhasPeriodo) {
    const chave = `${linha.matricula}|${linha.data.getTime()}|${linha.horaInicioDecimal}|${linha.horaFimDecimal}`;
    if (vistos.has(chave)) {
      ocorrencias.push({
        tipo: 'Duplicado',
        nome: nomeColabo(linha.matricula),
        matricula: linha.matricula,
        ordem: linha.ordemRaw === null || linha.ordemRaw === undefined || linha.ordemRaw === '' ? '—' : String(linha.ordemRaw),
        data: formatarDataBr(linha.data),
        horas: round2(linha.horasApontadas),
        motivo: 'Apontamento duplicado (mesma matrícula, data e horário)',
      });
      continue;
    }
    vistos.add(chave);
    semDuplicadas.push(linha);
  }
  linhasPeriodo = semDuplicadas;

  // 3b. Descarta apontamentos individuais fisicamente impossíveis (>24h).
  linhasPeriodo = linhasPeriodo.filter(linha => {
    if (linha.horasApontadas > MAX_H_LINHA) {
      ocorrencias.push({
        tipo: 'Valor impossível',
        nome: nomeColabo(linha.matricula),
        matricula: linha.matricula,
        ordem: linha.ordemRaw === null || linha.ordemRaw === undefined || linha.ordemRaw === '' ? '—' : String(linha.ordemRaw),
        data: formatarDataBr(linha.data),
        horas: round2(linha.horasApontadas),
        motivo: `Horas por apontamento (${linha.horasApontadas.toFixed(1)}h) excedem o limite de ${MAX_H_LINHA}h`,
      });
      return false;
    }
    return true;
  });

  // 3c. Cap diário: se o total do dia de um colaborador exceder 24h, escala
  //     proporcionalmente todos os apontamentos daquele dia.
  const totalDiarioPorGrupo = new Map<string, number>();
  for (const linha of linhasPeriodo) {
    const chave = `${linha.matricula}|${linha.data.getTime()}`;
    totalDiarioPorGrupo.set(chave, (totalDiarioPorGrupo.get(chave) ?? 0) + linha.horasApontadas);
  }
  for (const linha of linhasPeriodo) {
    const chave = `${linha.matricula}|${linha.data.getTime()}`;
    const totalDia = totalDiarioPorGrupo.get(chave)!;
    if (totalDia > MAX_H_DIA) {
      ocorrencias.push({
        tipo: 'Excesso diário',
        nome: nomeColabo(linha.matricula),
        matricula: linha.matricula,
        ordem: linha.ordemRaw === null || linha.ordemRaw === undefined || linha.ordemRaw === '' ? '—' : String(linha.ordemRaw),
        data: formatarDataBr(linha.data),
        horas: round2(linha.horasApontadas),
        motivo: `Total do dia (${totalDia.toFixed(1)}h) excede ${MAX_H_DIA}h — apontamento ajustado proporcionalmente`,
      });
    }
  }
  for (const linha of linhasPeriodo) {
    const chave = `${linha.matricula}|${linha.data.getTime()}`;
    const totalDia = totalDiarioPorGrupo.get(chave)!;
    if (totalDia > MAX_H_DIA) {
      const fator = Math.min(MAX_H_DIA / totalDia, 1);
      linha.horasApontadas = round2(linha.horasApontadas * fator);
    }
  }

  const totalApontamentos = linhasPeriodo.length;

  // 4) Ordens únicas por colaborador (sobre todo o período, antes da exclusão de
  //    matrículas/áreas -- mesma ordem de cálculo do original). Guarda também a
  //    descrição de cada OS (primeira encontrada — a descrição é da ordem em si,
  //    não muda entre apontamentos diferentes da mesma OS).
  const ordensPorColaborador = new Map<string, Set<string>>();
  const descricoesPorOrdem = new Map<string, string>();
  for (const linha of linhasPeriodo) {
    const ordemLimpa = limparOrdemProtheus(linha.ordemRaw);
    if (!ordemLimpa) continue;
    if (!ordensPorColaborador.has(linha.matricula)) ordensPorColaborador.set(linha.matricula, new Set());
    ordensPorColaborador.get(linha.matricula)!.add(ordemLimpa);

    if (!descricoesPorOrdem.has(ordemLimpa)) {
      const descricao = String(linha.descricaoRaw ?? '').trim();
      if (descricao) descricoesPorOrdem.set(ordemLimpa, descricao);
    }
  }
  const todasOrdensUnicas = new Set<string>();
  for (const ordens of ordensPorColaborador.values()) {
    for (const o of ordens) todasOrdensUnicas.add(o);
  }

  // Áreas de manutenção em que cada colaborador atuou no período (ex.: alguém da
  // Operação emprestado pode aparecer tanto em Mecânica quanto em Elétrica).
  const areasPorColaborador = new Map<string, Set<string>>();
  for (const linha of linhasPeriodo) {
    const areaTexto = String(linha.areaRaw ?? '').trim();
    if (!areaTexto) continue;
    const area = normalizarAreaManutencao(areaTexto);
    if (!areasPorColaborador.has(linha.matricula)) areasPorColaborador.set(linha.matricula, new Set());
    areasPorColaborador.get(linha.matricula)!.add(area);
  }

  // 5) Agrega horas por colaborador e junta com Matrículas (nome/área).
  const horasPorMatricula = new Map<string, number>();
  for (const linha of linhasPeriodo) {
    horasPorMatricula.set(linha.matricula, round2((horasPorMatricula.get(linha.matricula) ?? 0) + linha.horasApontadas));
  }
  const areaPorMatricula = new Map(matriculas.map(m => [m.matricula, m.area]));

  const horasPorArea: Record<string, number> = {};
  const horasPorColaborador: ColaboradorHoras[] = [];
  let horasGeral = 0;
  let colaboradoresComOrdens = 0;

  for (const [matricula, horasApontadas] of horasPorMatricula) {
    if (MATRICULAS_EXCLUIDAS_RELATORIO.has(matricula)) continue;
    const area = areaPorMatricula.get(matricula) ?? 'OUTROS';
    if (areaOcultaRelatorio(area)) continue;

    const funcionario = matriculaParaNome.get(matricula) ?? matricula;
    const ordensSet = ordensPorColaborador.get(matricula) ?? new Set<string>();
    const ordensLista = [...ordensSet].sort();
    if (ordensLista.length > 0) colaboradoresComOrdens++;

    let horasProgramadas = horasProgramadasPorMatricula[matricula] ?? null;
    let horasDisponiveis = horasDisponiveisPorMatricula[matricula] ?? null;
    if (areaEOperacao(area) && horasProgramadas !== null) {
      horasDisponiveis = horasProgramadas;
    }
    if (horasProgramadas !== null) horasProgramadas = round2(horasProgramadas);
    if (horasDisponiveis !== null) horasDisponiveis = round2(horasDisponiveis);

    horasPorArea[area] = round2((horasPorArea[area] ?? 0) + horasApontadas);
    horasGeral = round2(horasGeral + horasApontadas);

    const areasAtuacao = [...(areasPorColaborador.get(matricula) ?? new Set<string>())].sort();

    horasPorColaborador.push({
      matricula, funcionario, area, horasApontadas,
      horasProgramadas, horasDisponiveis,
      qtdOrdens: ordensLista.length, ordensLista, areasAtuacao,
    });
  }

  const diasPeriodo = Math.round((dataFim.getTime() - dataInicio.getTime()) / 86400000) + 1;

  return {
    horasGeral,
    horasPorArea,
    horasPorColaborador,
    ordensUnicasPeriodo: todasOrdensUnicas.size,
    totalApontamentos,
    diasPeriodo,
    totalColaboradores: horasPorColaborador.length,
    colaboradoresComOrdens,
    ocorrenciasNaoContabilizadas: ocorrencias,
    descricoesOrdens: Object.fromEntries(descricoesPorOrdem),
  };
}
