// Regras de consistência do cadastro de planos — usadas em dois lugares durante a
// revisão geral de planos (período longo, muitas alterações):
//   1. validarPlanoParaSalvar: travas/avisos no formulário, na hora de salvar.
//   2. diagnosticarPlanos: painel "Saúde dos planos", varre o cadastro inteiro.
// Cada regra aqui corresponde a um problema real que já quebrou a agenda antes (ver
// migrations 058-061): âncora no futuro deixava plano semanal sumido por meses,
// periodicidade diferente do nome gerava carga errada, ciclo gravado à frente da OS
// escondia o plano, Apoio sem equipe reconhecida escapava do limite por equipe.

import { CicloManutencao, EditarPlanoManutencaoRequest, ManutencaoArea, ManutencaoOrdem, PlanoManutencao } from '../models/manutencao-programacao.model';
import { periodicidadeEmDias, PeriodicidadeUnidade } from './manutencao-preventivas';
import { inferirCategoriaIndicadorPorTecnico } from './manutencao-planos';

export type SeveridadeSaude = 'erro' | 'aviso' | 'info';

export type TipoProblemaSaude =
  | 'ancora_futura'
  | 'nome_periodicidade'
  | 'duplicado'
  | 'apoio_sem_equipe'
  | 'sem_kks'
  | 'inativo_com_os_futura'
  | 'ciclo_desalinhado';

export interface ProblemaSaude {
  tipo: TipoProblemaSaude;
  severidade: SeveridadeSaude;
  plano: PlanoManutencao;
  mensagem: string;
}

export const TITULO_PROBLEMA: Record<TipoProblemaSaude, string> = {
  ancora_futura: 'Data inicial muito no futuro',
  nome_periodicidade: 'Periodicidade diferente do nome',
  duplicado: 'Plano duplicado',
  apoio_sem_equipe: 'Apoio sem equipe reconhecida',
  sem_kks: 'Sem TAG/KKS',
  inativo_com_os_futura: 'Inativo com OS programada',
  ciclo_desalinhado: 'Ciclo gravado à frente da OS',
};

const SEVERIDADE: Record<TipoProblemaSaude, SeveridadeSaude> = {
  ancora_futura: 'erro',
  inativo_com_os_futura: 'erro',
  ciclo_desalinhado: 'erro',
  nome_periodicidade: 'aviso',
  duplicado: 'aviso',
  apoio_sem_equipe: 'aviso',
  sem_kks: 'info',
};

function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const data = new Date(a, m - 1, d + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function dataBr(iso: string): string {
  return iso.split('-').reverse().join('/');
}

function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// Dados mínimos do plano pra validar — serve tanto pro plano salvo quanto pro que está
// sendo digitado no formulário (ainda sem id/código).
export interface PlanoParaValidar {
  id: string | null;
  nome: string;
  tagKks: string | null;
  area: ManutencaoArea;
  periodicidadeValor: number;
  periodicidadeUnidade: PeriodicidadeUnidade;
  dataInicial: string;
  responsavel: string | null;
  ativo: boolean;
}

// ── Regras individuais ─────────────────────────────────────────────────────

/** Âncora > hoje + 1 período: a agenda só começa na âncora, o plano "some" até lá. */
export function ancoraFutura(p: PlanoParaValidar, hojeIso: string): string | null {
  const dias = periodicidadeEmDias(p.periodicidadeValor, p.periodicidadeUnidade);
  const limite = somarDias(hojeIso, Math.max(dias, 7));
  if (p.dataInicial <= limite) return null;
  return `Data inicial ${dataBr(p.dataInicial)} está mais de um período à frente de hoje — o plano não aparece `
    + `em nenhuma semana até lá. Para ${p.periodicidadeValor} ${p.periodicidadeUnidade}, use uma data até ${dataBr(limite)}.`;
}

/** Sigla no nome ("I-E-6M", "P-L-2S", "…-1A") diferente da periodicidade cadastrada (>20%). */
export function nomeDivergeDaPeriodicidade(p: Pick<PlanoParaValidar, 'nome' | 'periodicidadeValor' | 'periodicidadeUnidade'>): string | null {
  const m = p.nome.toUpperCase().match(/-(\d+)([SMA])\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const esperado = m[2] === 'S' ? n * 7 : m[2] === 'M' ? n * 30 : n * 365;
  const real = periodicidadeEmDias(p.periodicidadeValor, p.periodicidadeUnidade);
  if (Math.abs(esperado - real) / esperado <= 0.2) return null;
  return `O nome indica "${m[1]}${m[2]}", mas o plano está cadastrado com ${p.periodicidadeValor} ${p.periodicidadeUnidade}.`;
}

/** Outro plano ATIVO com o mesmo nome e o mesmo KKS, na mesma área. */
export function planosDuplicados(p: PlanoParaValidar, todos: PlanoManutencao[]): PlanoManutencao[] {
  if (!p.ativo) return [];
  const nome = normalizar(p.nome);
  const kks = normalizar(p.tagKks ?? '');
  return todos.filter(o => o.ativo && o.id !== p.id && o.area === p.area
    && normalizar(o.nome) === nome && normalizar(o.tagKks ?? '') === kks);
}

/** Apoio com responsável que não é SERVPLEX / OPERAÇÃO / BMS — fica fora do limite por equipe. */
export function apoioSemEquipe(p: Pick<PlanoParaValidar, 'area' | 'responsavel'>): string | null {
  if (p.area !== 'APOIO') return null;
  if (inferirCategoriaIndicadorPorTecnico(p.responsavel ?? '')) return null;
  return `Responsável "${p.responsavel?.trim() || '(vazio)'}" não é SERVPLEX, OPERAÇÃO nem BMS — o plano fica fora `
    + `do limite semanal por equipe e cai em "Não classificado".`;
}

// ── 1. Validação no formulário ─────────────────────────────────────────────

export interface ResultadoValidacao {
  bloqueios: string[]; // impedem salvar
  avisos: string[];    // pedem confirmação
}

export function validarPlanoParaSalvar(
  p: PlanoParaValidar, todos: PlanoManutencao[], hojeIso: string,
): ResultadoValidacao {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  if (p.ativo) {
    const ancora = ancoraFutura(p, hojeIso);
    if (ancora) bloqueios.push(ancora);
  }
  const nome = nomeDivergeDaPeriodicidade(p);
  if (nome) avisos.push(nome);
  const dup = planosDuplicados(p, todos);
  if (dup.length) avisos.push(`Já existe plano ativo com o mesmo nome e KKS: ${dup.map(d => d.codigo).join(', ')}.`);
  const apoio = apoioSemEquipe(p);
  if (apoio) avisos.push(apoio);
  return { bloqueios, avisos };
}

// ── 2. Diagnóstico do cadastro inteiro ─────────────────────────────────────

export function diagnosticarPlanos(
  planos: PlanoManutencao[], ciclos: CicloManutencao[], ordens: ManutencaoOrdem[], hojeInicioSemanaIso: string,
): ProblemaSaude[] {
  const problemas: ProblemaSaude[] = [];
  const add = (tipo: TipoProblemaSaude, plano: PlanoManutencao, mensagem: string) =>
    problemas.push({ tipo, severidade: SEVERIDADE[tipo], plano, mensagem });

  const ordensPorId = new Map(ordens.map(o => [o.id, o]));
  const osFuturaPorPlano = new Set(ordens
    .filter(o => o.planoPreventivoId && o.semanaInicio >= hojeInicioSemanaIso)
    .map(o => o.planoPreventivoId!));
  const jaMarcadoDuplicado = new Set<string>();

  for (const p of planos) {
    if (p.ativo) {
      const ancora = ancoraFutura(p, hojeInicioSemanaIso);
      if (ancora) add('ancora_futura', p, ancora);
      const nome = nomeDivergeDaPeriodicidade(p);
      if (nome) add('nome_periodicidade', p, nome);
      if (!jaMarcadoDuplicado.has(p.id)) {
        const dup = planosDuplicados(p, planos);
        if (dup.length) {
          add('duplicado', p, `Mesmo nome e KKS de: ${dup.map(d => d.codigo).join(', ')}.`);
          dup.forEach(d => jaMarcadoDuplicado.add(d.id));
        }
      }
      const apoio = apoioSemEquipe(p);
      if (apoio) add('apoio_sem_equipe', p, apoio);
      if (!p.tagKks?.trim()) add('sem_kks', p, 'Sem TAG/KKS: não agrupa com outros planos do mesmo equipamento na programação.');
    } else if (osFuturaPorPlano.has(p.id)) {
      add('inativo_com_os_futura', p, 'Plano inativo, mas ainda tem OS programada desta semana em diante.');
    }
  }

  // Ciclo gravado > 3 semanas depois da semana da própria OS: esconde o plano até essa
  // data (proximaDataFixa pula tudo até o último ciclo) — ver migration 058.
  const planoPorId = new Map(planos.map(p => [p.id, p]));
  const cicloJaReportado = new Set<string>();
  for (const c of ciclos) {
    const ordem = c.ordemId ? ordensPorId.get(c.ordemId) : undefined;
    const plano = planoPorId.get(c.planoId);
    if (!ordem || !plano || cicloJaReportado.has(plano.id)) continue;
    if (c.dataPrevista > somarDias(ordem.semanaInicio, 21)) {
      add('ciclo_desalinhado', plano,
        `Ciclo gravado em ${dataBr(c.dataPrevista)} para uma OS da semana de ${dataBr(ordem.semanaInicio)} — `
        + 'o plano fica escondido da programação até essa data.');
      cicloJaReportado.add(plano.id);
    }
  }

  const ordem: Record<SeveridadeSaude, number> = { erro: 0, aviso: 1, info: 2 };
  return problemas.sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || a.plano.codigo.localeCompare(b.plano.codigo));
}

// ── 3. Diferença entre versões do plano (histórico de alterações) ─────────

export interface AlteracaoCampo {
  campo: string;
  antes: string;
  depois: string;
}

const CAMPOS_RASTREADOS: { chave: keyof EditarPlanoManutencaoRequest; rotulo: string }[] = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'equipamento', rotulo: 'Equipamento' },
  { chave: 'tagKks', rotulo: 'TAG/KKS' },
  { chave: 'area', rotulo: 'Área' },
  { chave: 'especialidade', rotulo: 'Especialidade' },
  { chave: 'descricao', rotulo: 'Descrição' },
  { chave: 'dataInicial', rotulo: 'Data inicial' },
  { chave: 'responsavel', rotulo: 'Responsável' },
  { chave: 'tempoEstimadoHoras', rotulo: 'Tempo estimado (h)' },
  { chave: 'hhEstimado', rotulo: 'HH estimado' },
  { chave: 'observacoes', rotulo: 'Observações' },
  { chave: 'ativo', rotulo: 'Ativo' },
  { chave: 'lotoPadrao', rotulo: 'LOTO padrão' },
  { chave: 'equipamentosRelacionados', rotulo: 'Equipamentos relacionados' },
];

function texto(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
}

function resumoChecklist(atividades: PlanoManutencao['atividades']): string {
  if (!atividades.length) return 'sem checklist';
  const sub = atividades.reduce((s, a) => s + a.subPassos.length, 0);
  return `${atividades.length} passo(s)${sub ? ` + ${sub} sub-passo(s)` : ''}`;
}

/** Campos que mudaram entre a versão salva e a nova (antes/depois em texto legível). */
export function diferencasPlano(antes: EditarPlanoManutencaoRequest, depois: EditarPlanoManutencaoRequest): AlteracaoCampo[] {
  const alteracoes: AlteracaoCampo[] = [];
  for (const { chave, rotulo } of CAMPOS_RASTREADOS) {
    const a = texto(antes[chave]);
    const d = texto(depois[chave]);
    if (a.trim() !== d.trim()) alteracoes.push({ campo: rotulo, antes: a, depois: d });
  }
  const perA = `${antes.periodicidadeValor} ${antes.periodicidadeUnidade}`;
  const perD = `${depois.periodicidadeValor} ${depois.periodicidadeUnidade}`;
  if (perA !== perD) alteracoes.push({ campo: 'Periodicidade', antes: perA, depois: perD });
  if (JSON.stringify(antes.atividades) !== JSON.stringify(depois.atividades)) {
    alteracoes.push({ campo: 'Checklist', antes: resumoChecklist(antes.atividades), depois: resumoChecklist(depois.atividades) });
  }
  return alteracoes;
}
