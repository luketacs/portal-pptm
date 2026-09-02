import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ManutencaoProgramacaoService } from '../../../services/manutencao-programacao.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
import { ApontamentosService } from '../../../services/apontamentos.service';
import { ExcelExportService, ProgramacaoSemanalGrupo } from '../../../services/excel-export.service';
import {
  ConsultaSigmaResultado, EquipeApoioItem, FeriasTecnico, ManutencaoArea, ManutencaoOrdem, ManutencaoTipo,
  OperadorEscalaApoio, SigmaBacklogItem,
} from '../../../models/manutencao-programacao.model';
import { EquipeApoio, Turno, TURNO_LABEL, turnoNoDia } from '../../../utils/escala-apoio';

type AreaFiltro = 'todos' | ManutencaoArea;

const AREA_LABEL: Record<ManutencaoArea, string> = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  APOIO: 'Apoio',
};

// Apoio programa por empresa/equipe (OPERAÇÃO, TOP ANDAIMES, SERVPLEX...), não por
// técnico individual — cadastro editável por Admin (ver "Gerenciar Apoio").

const TIPO_LABEL: Record<ManutencaoTipo, string> = {
  ordem: 'Ordem de Serviço',
  folga: 'Folga',
  treinamento: 'Treinamento',
  exame_medico: 'Exame Médico (ASO)',
};
const TIPO_BADGE: Record<ManutencaoTipo, string> = {
  ordem: '',
  folga: 'bg-purple-100 text-purple-700',
  treinamento: 'bg-indigo-100 text-indigo-700',
  exame_medico: 'bg-teal-100 text-teal-700',
};
// Linha inteira ganha um fundo leve pra folga/treinamento/exame médico se destacarem
// das OS de verdade sem precisar ler cada célula.
const TIPO_LINHA_CLASSE: Record<ManutencaoTipo, string> = {
  ordem: '',
  folga: 'bg-purple-50/40',
  treinamento: 'bg-indigo-50/40',
  exame_medico: 'bg-teal-50/40',
};
// Exemplo de descrição no placeholder do formulário, um pra cada tipo que não é OS.
const TIPO_MOTIVO_EXEMPLO: Partial<Record<ManutencaoTipo, string>> = {
  folga: 'ex.: Atestado médico',
  treinamento: 'ex.: Curso NR-10',
  exame_medico: 'ex.: ASO periódico',
};

// Status vem do SIGMA (texto livre, ver ManutencaoStatus) — só uns poucos códigos
// conhecidos ganham cor; qualquer outro cai no estilo neutro por padrão.
const STATUS_BADGE_CONHECIDOS: Record<string, string> = {
  PEND: 'bg-amber-100 text-amber-700',
  EXPA: 'bg-red-100 text-red-700',
  CONC: 'bg-green-100 text-green-700',
  EXEC: 'bg-green-100 text-green-700',
  CANC: 'bg-gray-200 text-gray-500',
};
const STATUS_BADGE_PADRAO = 'bg-slate-100 text-slate-600';

// "Natureza Manutenção" no SIGMA — as 3 opções que aparecem em toda versão da
// planilha. Igual status/LOTO: texto livre no banco, mas seletor fechado no formulário.
const TIPO_SERVICO_OPCOES = ['CORRETIVA', 'PREVENTIVA', 'MELHORIA'];
const TIPO_SERVICO_BADGE: Record<string, string> = {
  CORRETIVA: 'bg-red-50 text-red-600',
  PREVENTIVA: 'bg-blue-50 text-blue-600',
  MELHORIA: 'bg-purple-50 text-purple-600',
};
const TIPO_SERVICO_BADGE_PADRAO = 'bg-slate-50 text-slate-500';

// LOTO (bloqueio do equipamento) tem só essas 3 opções — é o que evita duas equipes
// baterem de frente (uma precisando do equipamento rodando, outra precisando parado).
const LOTO_OPCOES = ['LOTO', 'SEM LOTO', 'FUNCIONANDO'];
const LOTO_BADGE: Record<string, string> = {
  LOTO: 'bg-red-100 text-red-700',
  'SEM LOTO': 'bg-slate-100 text-slate-600',
  FUNCIONANDO: 'bg-green-100 text-green-700',
};
const LOTO_BADGE_PADRAO = 'bg-slate-50 text-slate-400';

const DIAS_SEMANA_LABEL = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

function segundaFeiraDe(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = date.getDay(); // 0=dom, 1=seg, ..., 6=sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return date;
}

function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatarDiaMes(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatarDataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

function somaHoras(ordens: ManutencaoOrdem[]): number {
  return Math.round(ordens.reduce((soma, o) => soma + (o.duracaoHoras ?? 0), 0) * 100) / 100;
}

// Datas reais (não rótulos) da semana SEG–SEX a partir da segunda-feira ('YYYY-MM-DD').
function diasDaSemana(segundaIso: string): { data: string; label: string }[] {
  const [ano, mes, dia] = segundaIso.split('-').map(Number);
  return DIAS_SEMANA_LABEL.map((label, i) => {
    const d = new Date(ano, mes - 1, dia + i);
    return { data: paraIso(d), label };
  });
}

function normalizarTexto(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Mesma normalização usada em api/sigma-ordens-proxy.js — precisa bater pra achar a
// chave certa no resultado (o SIGMA usa número de OS com 6 dígitos e zero à esquerda).
function normalizarNumeroOs(v: string): string {
  const s = v.trim();
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s.toUpperCase();
}

@Component({
  selector: 'app-manutencao-programacao',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manutencao-programacao.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManutencaoProgramacaoComponent implements OnInit {
  readonly areaLabel = AREA_LABEL;
  readonly lotoOpcoes = LOTO_OPCOES;
  readonly tipoServicoOpcoes = TIPO_SERVICO_OPCOES;
  readonly tipoLabel = TIPO_LABEL;
  private readonly tiposFormPadrao: ManutencaoTipo[] = ['ordem', 'folga', 'treinamento', 'exame_medico'];
  // Apoio programa por empresa/equipe, não por pessoa — folga/treinamento/exame médico
  // não fazem sentido nesse contexto, só "ordem" fica disponível.
  tiposForm = computed<ManutencaoTipo[]>(() => this.areaFixa === 'APOIO' ? ['ordem'] : this.tiposFormPadrao);

  motivoPlaceholder(tipo: ManutencaoTipo): string {
    const exemplo = TIPO_MOTIVO_EXEMPLO[tipo];
    return exemplo ? `${TIPO_LABEL[tipo]} — ${exemplo}` : TIPO_LABEL[tipo];
  }

  statusBadgeClass(status: string): string {
    return STATUS_BADGE_CONHECIDOS[status.toUpperCase()] ?? STATUS_BADGE_PADRAO;
  }

  lotoBadgeClass(loto: string): string {
    return LOTO_BADGE[loto.toUpperCase()] ?? LOTO_BADGE_PADRAO;
  }

  tipoServicoBadgeClass(tipoServico: string): string {
    return TIPO_SERVICO_BADGE[tipoServico.toUpperCase()] ?? TIPO_SERVICO_BADGE_PADRAO;
  }

  tipoBadgeClass(tipo: ManutencaoTipo): string {
    return TIPO_BADGE[tipo];
  }

  linhaClasse(tipo: ManutencaoTipo): string {
    return TIPO_LINHA_CLASSE[tipo];
  }

  conflitoLotoTitle(itens: { status: string; descricao: string; tecnico: string }[]): string {
    return `Conflito: ${itens.map(i => `${i.status} (${i.tecnico} — ${i.descricao})`).join(' vs. ')}`;
  }

  // Número da semana no padrão ISO 8601 (segunda-feira, semana com a 1ª
  // quinta-feira do ano) — conferido contra a planilha original: 27/07/2026 cai na
  // "S31", que é exatamente o que esse cálculo dá.
  private numeroSemanaISO(dataIso: string): number {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const diaDaSemana = (data.getUTCDay() + 6) % 7;
    data.setUTCDate(data.getUTCDate() - diaDaSemana + 3);
    const primeiraQuinta = new Date(Date.UTC(data.getUTCFullYear(), 0, 4));
    const diffDias = (data.getTime() - primeiraQuinta.getTime()) / 86400000;
    return 1 + Math.round(diffDias / 7);
  }

  private diaMesCompacto(dataIso: string): string {
    const [, mes, dia] = dataIso.split('-').map(Number);
    return `${dia}/${mes}`;
  }

  diaMesPadded(dataIso: string): string {
    const [, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}`;
  }

  exportandoSemana = signal(false);

  async exportarSemana(): Promise<void> {
    const grupos: ProgramacaoSemanalGrupo[] = this.grupos().map(g => ({
      tecnico: g.tecnico,
      linhas: g.ordens.map(o => ({
        tipo: o.tipo,
        numeroOs: o.numeroOs,
        semOs: o.semOs,
        descricao: o.descricao,
        duracaoHoras: o.duracaoHoras,
        equipamento: o.equipamento || '—',
        recursos: o.recursos || '—',
        loto: o.loto || '—',
        areaAtuacao: o.areaAtuacao || '—',
        diasPrevistos: o.diasPrevistos,
        status: o.tipo === 'ordem' ? o.status : '',
      })),
    }));

    if (grupos.length === 0) {
      this.notificationService.showError('Nenhum lançamento na semana selecionada pra exportar.');
      return;
    }

    const semana = this.semanaFiltro();
    const [ano] = semana.split('-').map(Number);
    const dias = this.diasDaSemanaAtual();
    const semanaLabel = `S${this.numeroSemanaISO(semana)} ${ano} (${this.diaMesPadded(dias[0].data)} À ${this.diaMesPadded(dias[6].data)})`;

    this.exportandoSemana.set(true);
    try {
      await this.excelExportService.exportarProgramacaoSemanal({
        semanaLabel,
        areaLabel: this.areaFixa ? this.areaLabel[this.areaFixa] : 'Elétrica + Mecânica',
        dias: dias.map(d => ({ data: d.data, diaMes: this.diaMesCompacto(d.data), label: d.label })),
        grupos,
      });
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao gerar o Excel.');
    } finally {
      this.exportandoSemana.set(false);
    }
  }

  errorMessage = signal('');
  isProcessando = signal(false);

  // Grupos (técnico ou dia, conforme a tela) começam todos abertos — só entra no mapa
  // quem foi fechado manualmente, então trocar de semana/filtro não perde estado à toa.
  private gruposFechados = signal<Record<string, boolean>>({});

  isGrupoExpandido(chave: string): boolean {
    return !this.gruposFechados()[chave];
  }

  toggleGrupo(chave: string): void {
    this.gruposFechados.update(atual => ({ ...atual, [chave]: !atual[chave] }));
  }

  recolherTodos(chaves: string[]): void {
    const novo: Record<string, boolean> = {};
    for (const c of chaves) novo[c] = true;
    this.gruposFechados.set(novo);
  }

  expandirTodos(): void {
    this.gruposFechados.set({});
  }

  // Filtros
  // 8 semanas à frente (cobre o horizonte de 4 semanas partindo de qualquer uma
  // delas) + a atual + 4 semanas passadas pra referência/histórico.
  readonly semanas = (() => {
    const result: { value: string; label: string }[] = [];
    const hojeSegunda = segundaFeiraDe(new Date());
    for (let i = -8; i < 5; i++) {
      const inicio = new Date(hojeSegunda);
      inicio.setDate(inicio.getDate() - i * 7);
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 6);
      const inicioIso = paraIso(inicio);
      result.push({ value: inicioIso, label: `Semana ${this.numeroSemanaISO(inicioIso)} (${formatarDiaMes(inicio)} a ${formatarDiaMes(fim)})` });
    }
    return result;
  })();

  semanaFiltro = signal(paraIso(segundaFeiraDe(new Date())));
  areaFiltro = signal<AreaFiltro>('todos');
  statusFiltro = signal<'todos' | string>('todos');
  tecnicoFiltro = signal<'todos' | string>('todos');
  searchTerm = signal('');

  diasDaSemanaAtual = computed(() => diasDaSemana(this.semanaFiltro()));
  semanaFiltroLabel = computed(() => this.semanas.find(s => s.value === this.semanaFiltro())?.label ?? this.semanaFiltro());

  isLoading = this.manutencaoService.isLoading;
  currentUser = this.authService.currentUser;
  isAdmin = computed(() => this.authService.currentUser()?.role === 'Admin');

  private ordensDaSemanaCalc(semana: string): ManutencaoOrdem[] {
    return this.manutencaoService.ordens().filter(o => o.semanaInicio === semana);
  }
  ordensDaSemana = computed(() => this.ordensDaSemanaCalc(this.semanaFiltro()));

  private listaFiltradaCalc(ordensDaSemana: ManutencaoOrdem[]): ManutencaoOrdem[] {
    const area = this.areaFiltro();
    const status = this.statusFiltro();
    const tecnico = this.tecnicoFiltro();
    const termo = this.searchTerm().trim().toLowerCase();

    return ordensDaSemana.filter(o => {
      if (area !== 'todos' && o.area !== area) return false;
      if (status !== 'todos' && o.status !== status) return false;
      if (tecnico !== 'todos' && o.tecnicoNome !== tecnico) return false;
      if (termo) {
        const texto = `${o.numeroOs ?? ''} ${o.descricao} ${o.equipamento ?? ''} ${o.tecnicoNome}`.toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  }
  listaFiltrada = computed(() => this.listaFiltradaCalc(this.ordensDaSemana()));

  // Agrupada por técnico — usado nas telas de área única (mais perto do que a planilha
  // já mostra hoje, bloco por executante). Cada grupo já sai com a capacidade da semana
  // (Efetivo) calculada, pra comparar contra as horas já alocadas.
  // Primeiro dia previsto de uma ordem (SEG antes de QUI, etc.) — usado só pra
  // ordenar a exibição dentro do bloco do técnico. Sem dia marcado vai pro final.
  private primeiroDia(o: ManutencaoOrdem): string {
    return o.diasPrevistos.length > 0 ? [...o.diasPrevistos].sort()[0] : '9999-12-31';
  }

  // Período de férias do técnico que toca algum dos dias informados (a semana em
  // exibição, por ex.) — `null` se não tiver nenhuma férias cadastrada nesse período.
  private feriasNoIntervalo(tecnicoNome: string, diasIso: string[]): FeriasTecnico | null {
    if (diasIso.length === 0) return null;
    return this.manutencaoService.ferias().find(f =>
      f.tecnicoNome === tecnicoNome && diasIso.some(d => d >= f.dataInicio && d <= f.dataFim),
    ) ?? null;
  }

  // Folga já lançada pro técnico que toca algum dos dias informados — se ele está de
  // folga, não deixa lançar mais nada (OS, treinamento, exame médico, outra folga)
  // nesses dias. `idExcluir` evita a folga se auto-bloquear quando ela mesma está
  // sendo editada.
  private folgaNoIntervalo(tecnicoNome: string, diasIso: string[], idExcluir?: string | null): ManutencaoOrdem | null {
    if (diasIso.length === 0) return null;
    return this.manutencaoService.ordens().find(o =>
      o.tipo === 'folga' && o.tecnicoNome === tecnicoNome && o.id !== idExcluir
        && o.diasPrevistos.some(d => diasIso.includes(d)),
    ) ?? null;
  }

  private gruposCalc(lista: ManutencaoOrdem[], dias: { data: string; label: string }[]) {
    const porTecnico = new Map<string, ManutencaoOrdem[]>();
    for (const o of lista) {
      const lista2 = porTecnico.get(o.tecnicoNome) ?? [];
      lista2.push(o);
      porTecnico.set(o.tecnicoNome, lista2);
    }
    const diasIso = dias.map(d => d.data);
    // Técnico de férias na semana aparece mesmo sem nenhum lançamento — o objetivo é
    // justamente avisar antes de alguém tentar programar algo pra ele.
    const area = this.areaFiltro();
    for (const f of this.manutencaoService.ferias()) {
      if (area !== 'todos' && f.area !== area) continue;
      if (porTecnico.has(f.tecnicoNome)) continue;
      if (!diasIso.some(d => d >= f.dataInicio && d <= f.dataFim)) continue;
      porTecnico.set(f.tecnicoNome, []);
    }
    return Array.from(porTecnico.entries())
      .map(([tecnico, ordens]) => {
        const ordensOrdenadas = [...ordens].sort((a, b) => this.primeiroDia(a).localeCompare(this.primeiroDia(b)));
        const totalHoras = somaHoras(ordensOrdenadas);
        const capacidade = this.capacidadeSemana(tecnico, ordensOrdenadas, dias);
        const saldo = capacidade !== null ? parseFloat((capacidade - totalHoras).toFixed(2)) : null;
        const ferias = this.feriasNoIntervalo(tecnico, diasIso);
        return { tecnico, ordens: ordensOrdenadas, totalHoras, capacidade, saldo, ferias };
      })
      .sort((a, b) => a.tecnico.localeCompare(b.tecnico));
  }
  grupos = computed(() => this.gruposCalc(this.listaFiltrada(), this.diasDaSemanaAtual()));

  // Efetivo/capacidade: soma a disponibilidade cadastrada (matriculas.json, mesma fonte
  // do Relatório Mensal PCM) nos dias úteis da semana, descontando os dias em que o
  // técnico já tem folga/treinamento lançado. `null` quando o técnico não está no
  // matriculas.json (não dá pra saber a disponibilidade dele).
  private capacidadeSemana(tecnicoNome: string, ordensDoTecnico: ManutencaoOrdem[], dias: { data: string; label: string }[]): number | null {
    const colaborador = this.apontamentosService.colaboradores().find(c => c.nome === tecnicoNome);
    if (!colaborador) return null;

    const diasIndisponiveis = new Set(
      ordensDoTecnico.filter(o => o.tipo !== 'ordem').flatMap(o => o.diasPrevistos),
    );

    let total = 0;
    for (const dia of dias) {
      if (diasIndisponiveis.has(dia.data)) continue;
      total += this.apontamentosService.disponibilidadeNoDia(colaborador, dia.data);
    }
    return parseFloat(total.toFixed(2));
  }

  // Agrupada por dia — usado na tela geral (as duas áreas juntas), pra ver de cara
  // tudo que está programado pra cada dia da semana, cruzando Elétrica e Mecânica.
  // Uma OS com vários dias marcados aparece em cada um deles.
  private gruposPorDiaCalc(lista: ManutencaoOrdem[], dias: { data: string; label: string }[]) {
    const porDia = new Map<string, ManutencaoOrdem[]>();
    for (const o of lista) {
      for (const dia of o.diasPrevistos) {
        const lista2 = porDia.get(dia) ?? [];
        lista2.push(o);
        porDia.set(dia, lista2);
      }
    }
    const hojeIso = paraIso(new Date());
    return dias.map(d => {
      const ordens = (porDia.get(d.data) ?? []).sort((a, b) => a.tecnicoNome.localeCompare(b.tecnicoNome));
      return {
        data: d.data,
        label: d.label,
        dataLabel: formatarDataCurta(d.data),
        ordens,
        totalHoras: somaHoras(ordens),
        hoje: d.data === hojeIso,
      };
    });
  }
  gruposPorDia = computed(() => this.gruposPorDiaCalc(this.listaFiltrada(), this.diasDaSemanaAtual()));

  // OS sem nenhum dia marcado — não some da tela geral, fica numa seção à parte.
  ordensSemDia = computed(() => this.listaFiltrada().filter(o => o.diasPrevistos.length === 0));

  // ── Horizonte de 4 semanas (empilhado) ──────────────────────────────────────
  // Repete o mesmo conteúdo da semana única (LOTO, técnicos/dias, escala) pras
  // próximas 4 semanas a partir da selecionada, pra planejar sem trocar o filtro
  // repetidamente. Cada bloco calcula tudo com as mesmas contas de sempre, só que
  // parametrizadas pela semana dele em vez de ler semanaFiltro() direto.
  horizonteAtivo = signal(false);

  private semanaMaisIso(semanaBase: string, semanas: number): string {
    const [ano, mes, dia] = semanaBase.split('-').map(Number);
    return paraIso(new Date(ano, mes - 1, dia + semanas * 7));
  }

  horizonteSemanas = computed(() => {
    const base = this.semanaFiltro();
    return [0, 1, 2, 3].map(i => this.semanaMaisIso(base, i));
  });

  blocosHorizonte = computed(() => {
    return this.horizonteSemanas().map(semana => {
      const dias = diasDaSemana(semana);
      const ordensDaSemana = this.ordensDaSemanaCalc(semana);
      const lista = this.listaFiltradaCalc(ordensDaSemana);
      const grupos = this.gruposCalc(lista, dias);
      const gruposPorDia = this.gruposPorDiaCalc(lista, dias);
      const ordensSemDia = lista.filter(o => o.diasPrevistos.length === 0);
      const quadroLoto = this.quadroLotoCalc(ordensDaSemana, dias);
      const escalaDaSemana = this.areaFixa === 'APOIO' ? this.escalaDaSemanaCalc(dias) : [];
      const label = this.semanas.find(s => s.value === semana)?.label ?? semana;
      const diasIso = dias.map(d => d.data);
      return { semana, label, dias, diasIso, ordensDaSemana, grupos, gruposPorDia, ordensSemDia, quadroLoto, escalaDaSemana };
    });
  });

  // Chaves de todos os grupos visíveis agora (técnico ou dia, conforme a tela) —
  // usado pelos botões "Expandir todos"/"Recolher todos".
  chavesGruposVisiveis = computed(() => {
    if (this.areaFixa) return this.grupos().map(g => `tec:${g.tecnico}`);
    const chaves = this.gruposPorDia().map(d => `dia:${d.data}`);
    if (this.ordensSemDia().length > 0) chaves.push('sem-dia');
    return chaves;
  });

  tecnicosComOrdemNaSemana = computed(() => {
    const nomes = new Set(this.ordensDaSemana().filter(o => this.areaFiltro() === 'todos' || o.area === this.areaFiltro()).map(o => o.tecnicoNome));
    return Array.from(nomes).sort();
  });

  // Status vem do SIGMA, sem lista fechada — o filtro mostra só os valores que
  // realmente aparecem na semana/área selecionada.
  statusesComOrdemNaSemana = computed(() => {
    const valores = new Set(this.ordensDaSemana().filter(o => this.areaFiltro() === 'todos' || o.area === this.areaFiltro()).map(o => o.status));
    return Array.from(valores).sort();
  });

  countTotal = computed(() => this.listaFiltrada().length);

  equipamentos = this.manutencaoService.equipamentos;

  // Cadastro de equipes/empresas do Apoio e da escala de turno — no banco, editável
  // por Admin (ver "Gerenciar Apoio" mais abaixo). O rodízio D/N/F em si continua
  // calculado, só o registro de quem está em qual equipe é que é editável.
  equipesApoio = this.manutencaoService.equipesApoio;
  escalaApoio = this.manutencaoService.escalaApoio;
  readonly turnoLabel = TURNO_LABEL;

  private async carregarDadosApoio(): Promise<void> {
    try {
      await this.manutencaoService.loadApoioCadastros();
    } catch (err) {
      console.error('[ManutencaoProgramacaoComponent] Falha ao carregar cadastros do Apoio:', err);
    }
  }

  // Escala de turno (D/N/F) por equipe, pros dias da semana selecionada — calculada,
  // não editada manualmente (o rodízio de 8 dias é fixo, ver src/utils/escala-apoio.ts).
  private escalaDaSemanaCalc(dias: { data: string; label: string }[]) {
    const porEquipe = new Map<EquipeApoio, OperadorEscalaApoio[]>();
    for (const op of this.escalaApoio()) {
      const lista = porEquipe.get(op.equipe) ?? [];
      lista.push(op);
      porEquipe.set(op.equipe, lista);
    }
    return (['A', 'B', 'C', 'D'] as EquipeApoio[])
      .filter(eq => porEquipe.has(eq))
      .map(equipe => ({
        equipe,
        integrantesLabel: porEquipe.get(equipe)!.map(i => i.nome).join(', '),
        turnos: dias.map(d => ({ data: d.data, label: d.label, turno: turnoNoDia(equipe, d.data) as Turno })),
      }));
  }
  escalaDaSemana = computed(() => this.escalaDaSemanaCalc(this.diasDaSemanaAtual()));

  // ── Férias (Admin): período de férias por técnico, pra avisar/bloquear
  // lançamento de atividade nesse período. Só faz sentido pra Elétrica/Mecânica.
  readonly ferias = this.manutencaoService.ferias;
  feriasAberto = signal(false);
  feriasTecnicoNome = signal('');
  feriasTecnicoMatricula = signal('');
  feriasArea = signal<ManutencaoArea>('ELETRICA');
  feriasDataInicio = signal('');
  feriasDataFim = signal('');

  tecnicosParaFerias = computed(() => this.tecnicosPorArea(this.feriasArea()));

  abrirFerias(): void {
    this.feriasArea.set(this.areaFixa === 'MECANICA' ? 'MECANICA' : 'ELETRICA');
    this.feriasTecnicoNome.set('');
    this.feriasTecnicoMatricula.set('');
    this.feriasDataInicio.set('');
    this.feriasDataFim.set('');
    this.feriasAberto.set(true);
  }

  fecharFerias(): void {
    this.feriasAberto.set(false);
  }

  onFeriasAreaSelected(area: ManutencaoArea): void {
    this.feriasArea.set(area);
    this.feriasTecnicoNome.set('');
    this.feriasTecnicoMatricula.set('');
  }

  onFeriasTecnicoSelected(nome: string): void {
    this.feriasTecnicoNome.set(nome);
    const colaborador = this.tecnicosParaFerias().find(c => c.nome === nome);
    this.feriasTecnicoMatricula.set(colaborador?.matricula ?? '');
  }

  canConfirmarFerias(): boolean {
    return !this.isProcessando() && !!this.feriasTecnicoNome().trim()
      && !!this.feriasDataInicio() && !!this.feriasDataFim() && this.feriasDataFim() >= this.feriasDataInicio();
  }

  async adicionarFerias(): Promise<void> {
    if (!this.canConfirmarFerias()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarFerias({
        tecnicoNome: this.feriasTecnicoNome(),
        tecnicoMatricula: this.feriasTecnicoMatricula() || null,
        area: this.feriasArea(),
        dataInicio: this.feriasDataInicio(),
        dataFim: this.feriasDataFim(),
      });
      this.notificationService.showSuccess('Férias cadastradas.');
      this.feriasTecnicoNome.set('');
      this.feriasTecnicoMatricula.set('');
      this.feriasDataInicio.set('');
      this.feriasDataFim.set('');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao cadastrar férias.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerFerias(item: FeriasTecnico): Promise<void> {
    if (this.isProcessando() || !confirm(`Remover férias de "${item.tecnicoNome}"?`)) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirFerias(item.id);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover férias.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Gerenciar Apoio (Admin): cadastro de equipes/empresas e da escala de turno ──
  gerenciarApoioAberto = signal(false);
  novaEquipeApoioNome = signal('');
  novoOperadorNome = signal('');
  novoOperadorEquipe = signal<EquipeApoio>('A');
  readonly equipesApoioOpcoes: EquipeApoio[] = ['A', 'B', 'C', 'D'];

  async adicionarEquipeApoio(): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarEquipeApoio(this.novaEquipeApoioNome());
      this.novaEquipeApoioNome.set('');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar equipe/empresa.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerEquipeApoio(item: EquipeApoioItem): Promise<void> {
    if (this.isProcessando() || !confirm(`Remover "${item.nome}" do cadastro? Lançamentos já feitos com essa equipe não são afetados.`)) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirEquipeApoio(item.id);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover equipe/empresa.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async adicionarOperadorEscala(): Promise<void> {
    if (this.isProcessando()) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarOperadorEscala(this.novoOperadorNome(), this.novoOperadorEquipe());
      this.novoOperadorNome.set('');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar operador.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  async removerOperadorEscala(item: OperadorEscalaApoio): Promise<void> {
    if (this.isProcessando() || !confirm(`Remover "${item.nome}" da escala?`)) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluirOperadorEscala(item.id);
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao remover operador.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // Backlog do SIGMA (OS abertas da área, ainda não lançadas aqui) — só faz sentido
  // nas telas de área única, porque o campo de área do SIGMA é por OS, não por semana.
  // Não é tempo real: o proxy cacheia a exportação do SIGMA por até ~10min pra não
  // rebaixar um arquivo de vários MB a cada clique — por isso busca de novo toda vez
  // que o painel é aberto (não só na primeira vez) e mostra o horário da última busca.
  // Menu "Mais ações" no cabeçalho — agrupa Backlog/Gerenciar Apoio/Feriado/Férias
  // pra não empilhar um botão por ação na barra de topo.
  menuAcoesAberto = signal(false);

  // Menu ⋯ de ações por linha (+ Apoio/Editar/Excluir) — só um aberto por vez,
  // guardado pelo id da ordem.
  linhaMenuAberta = signal<string | null>(null);

  toggleLinhaMenu(id: string): void {
    this.linhaMenuAberta.update(atual => atual === id ? null : id);
  }

  backlogAberto = signal(false);
  backlogCarregando = signal(false);
  backlogErro = signal('');
  backlogAtualizadoEm = signal<number | null>(null);
  private backlogSigma = signal<SigmaBacklogItem[]>([]);

  private numerosOsJaProgramados = computed(() => {
    const area = this.areaFixa;
    if (!area) return new Set<string>();
    return new Set(
      this.manutencaoService.ordens()
        .filter(o => o.area === area && o.numeroOs?.trim())
        .map(o => normalizarNumeroOs(o.numeroOs!)),
    );
  });

  backlogFiltrado = computed(() => {
    const jaProgramados = this.numerosOsJaProgramados();
    return this.backlogSigma().filter(item => !jaProgramados.has(normalizarNumeroOs(item.numeroOs)));
  });

  backlogAtualizadoEmLabel(): string {
    const ts = this.backlogAtualizadoEm();
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  async toggleBacklog(): Promise<void> {
    const abrir = !this.backlogAberto();
    this.backlogAberto.set(abrir);
    if (abrir) {
      await this.carregarBacklog();
    }
  }

  async carregarBacklog(): Promise<void> {
    if (!this.areaFixa || this.areaFixa === 'APOIO') return;
    this.backlogCarregando.set(true);
    this.backlogErro.set('');
    try {
      const { itens, atualizadoEm } = await this.manutencaoService.consultarBacklogSigma(this.areaFixa);
      this.backlogSigma.set(itens);
      this.backlogAtualizadoEm.set(atualizadoEm);
    } catch (err: unknown) {
      this.backlogErro.set(err instanceof Error ? err.message : 'Erro ao consultar o backlog do SIGMA.');
    } finally {
      this.backlogCarregando.set(false);
    }
  }

  // Quadro de bloqueios (LOTO) por equipamento/dia — logo no topo da tela, pra
  // qualquer time ver antes de programar se o equipamento já está comprometido
  // num estado incompatível (ex.: uma equipe precisa dele rodando, outra parado).
  // Olha a semana inteira (as duas áreas juntas, ignora técnico/status/busca) —
  // o ponto é visibilidade cruzada entre equipes, não só o que o filtro atual mostra.
  // OS sem dia marcado é tratada como valendo a semana toda (mais seguro do que
  // simplesmente não aparecer no quadro).
  private quadroLotoCalc(ordensDaSemana: ManutencaoOrdem[], diasSemana: { data: string; label: string }[]) {
    const dias = diasSemana.map(d => d.data);
    const porEquipamento = new Map<string, Map<string, { status: string; descricao: string; tecnico: string; area: ManutencaoArea }[]>>();

    for (const o of ordensDaSemana) {
      const equipamento = o.equipamento?.trim();
      const loto = o.loto?.trim();
      if (!equipamento || !loto) continue;

      const diasDaOrdem = o.diasPrevistos.length > 0 ? o.diasPrevistos.filter(d => dias.includes(d)) : dias;
      if (!porEquipamento.has(equipamento)) porEquipamento.set(equipamento, new Map());
      const porDia = porEquipamento.get(equipamento)!;
      for (const dia of diasDaOrdem) {
        const lista = porDia.get(dia) ?? [];
        lista.push({ status: loto, descricao: o.descricao, tecnico: o.tecnicoNome, area: o.area });
        porDia.set(dia, lista);
      }
    }

    return Array.from(porEquipamento.entries())
      .map(([equipamento, porDia]) => ({
        equipamento,
        dias: dias.map(dia => {
          const itens = porDia.get(dia) ?? [];
          const statusUnicos = new Set(itens.map(i => i.status.toUpperCase()));
          return { data: dia, itens, conflito: statusUnicos.size > 1 };
        }),
      }))
      // "Sem LOTO" é o estado padrão/sem novidade — só vale a pena aparecer no
      // quadro o equipamento que tem algo realmente pra observar (bloqueio,
      // funcionando marcado, ou conflito entre equipes).
      .filter(linha => linha.dias.some(d => d.conflito || d.itens.some(i => i.status.toUpperCase() !== 'SEM LOTO')))
      .sort((a, b) => a.equipamento.localeCompare(b.equipamento));
  }
  quadroLoto = computed(() => this.quadroLotoCalc(this.ordensDaSemana(), this.diasDaSemanaAtual()));

  // ── Modal: criar/editar OS ─────────────────────────────────────────────
  formAberto = signal(false);
  formIdEdicao = signal<string | null>(null);
  formTipo = signal<ManutencaoTipo>('ordem');
  formArea = signal<ManutencaoArea>('ELETRICA');
  formNumeroOs = signal('');
  formSemOs = signal(false);
  formDescricao = signal('');
  formEquipamento = signal('');
  formRecursos = signal('');
  formLoto = signal('');
  formAreaAtuacao = signal('');
  formDuracaoHoras = signal<number | null>(null);
  formTipoServico = signal('');
  formTecnicoNome = signal('');
  formTecnicoMatricula = signal('');
  formDiasSelecionados = signal<string[]>([]);
  formObservacoes = signal('');
  buscandoOsNoSigma = signal(false);

  tecnicosDaAreaForm = computed(() => this.tecnicosPorArea(this.formArea()));

  // ── Integração com o SIGMA (mesmos links que a planilha "Fechamento Semanal.2"
  // usa via Power Query) — preenche a descrição sozinha ao informar o número da OS, e
  // confere se ela já foi apontada (executada) dentro da semana programada. Best-effort:
  // se o SIGMA estiver fora do ar, a tela continua funcionando normalmente, só sem esse
  // preenchimento/validação.
  sigmaPorOs = signal<Record<string, ConsultaSigmaResultado>>({});

  private numerosOsVisiveis = computed(() => {
    const ordens = this.horizonteAtivo()
      ? this.blocosHorizonte().flatMap(b => b.ordensDaSemana)
      : this.ordensDaSemana();
    return [...new Set(ordens.map(o => o.numeroOs).filter((n): n is string => !!n?.trim()))];
  });

  // Telas separadas por área (/manutencao/programacao/eletrica ou /mecanica) travam o
  // filtro nessa área e escondem o seletor; a rota combinada (/manutencao/programacao,
  // sem "area" nos dados da rota) mostra as duas juntas com o seletor liberado. O
  // quadro de LOTO continua mostrando as duas áreas sempre, mesmo nas telas travadas —
  // é justamente aí que mora o conflito entre equipes.
  areaFixa: ManutencaoArea | null = null;
  pageTitle = 'Programação de Manutenção';

  constructor(
    private route: ActivatedRoute,
    private manutencaoService: ManutencaoProgramacaoService,
    private authService: AuthService,
    private notificationService: NotificationService,
    private apontamentosService: ApontamentosService,
    private excelExportService: ExcelExportService,
  ) {
    const area = this.route.snapshot.data['area'] as ManutencaoArea | undefined;
    if (area) {
      this.areaFixa = area;
      this.areaFiltro.set(area);
      this.pageTitle = `Programação ${AREA_LABEL[area]}`;
    }

    // Refaz a consulta ao SIGMA sempre que a lista de OS visíveis na semana mudar
    // (troca de semana, nova OS criada, número de OS editado etc.).
    effect(() => {
      const numeros = this.numerosOsVisiveis();
      if (numeros.length === 0) return;
      this.buscarExecucaoSigma(numeros);
    });
  }

  private async buscarExecucaoSigma(numeros: string[]): Promise<void> {
    try {
      const resultado = await this.manutencaoService.consultarOrdensSigma(numeros);
      this.sigmaPorOs.update(atual => ({ ...atual, ...resultado }));
    } catch {
      // Consulta best-effort — falha do SIGMA não deve travar a tela de programação.
    }
  }

  // Selo de execução por OS, pra saber se ela já foi apontada (executada) dentro da
  // semana programada, ou fora dela, ou ainda nem apontada. `null` = ou não tem número
  // de OS pra checar, ou a consulta ao SIGMA ainda não voltou.
  statusExecucao(o: ManutencaoOrdem, diasSemanaOverride?: string[]): { label: string; class: string; dot: string; title: string } | null {
    if (!o.numeroOs?.trim()) return null;
    const resultado = this.sigmaPorOs()[normalizarNumeroOs(o.numeroOs)];
    if (!resultado) return null;

    if (resultado.apontamentos.length === 0) {
      return { label: 'Não executada', class: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400', title: 'Nenhum apontamento encontrado no SIGMA pra essa OS.' };
    }

    const diasDaSemana = o.diasPrevistos.length > 0 ? o.diasPrevistos : (diasSemanaOverride ?? this.diasDaSemanaAtual().map(d => d.data));
    const dentroDaSemana = resultado.apontamentos.filter(a => diasDaSemana.includes(a.data));
    if (dentroDaSemana.length > 0) {
      return {
        label: 'Executada', class: 'bg-green-100 text-green-700', dot: 'bg-green-500',
        title: `Executada — apontada em: ${dentroDaSemana.map(a => a.data).join(', ')}`,
      };
    }
    return {
      label: 'Fora da semana', class: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500',
      title: `Apontada fora da semana programada, em: ${resultado.apontamentos.map(a => a.data).join(', ')}`,
    };
  }

  // "Dias" em texto compacto (ex.: "SEG, QUA, SEX") em vez das 7 pastilhas — mesma
  // informação, ocupando uma linha só. `dias` é opcional pra reaproveitar nos blocos
  // do horizonte de 4 semanas, que usam datas diferentes de diasDaSemanaAtual().
  diasResumo(o: ManutencaoOrdem, dias?: { data: string; label: string }[]): string {
    const base = dias ?? this.diasDaSemanaAtual();
    const label = base.filter(d => o.diasPrevistos.includes(d.data)).map(d => d.label).join(', ');
    return label || '—';
  }

  // ── Buscar descrição da OS no SIGMA ao sair do campo "Número da OS" ───
  async buscarDescricaoDaOs(): Promise<void> {
    const numero = this.formNumeroOs().trim();
    if (!numero) return;

    this.buscandoOsNoSigma.set(true);
    try {
      const resultado = await this.manutencaoService.consultarOrdensSigma([numero]);
      const info = resultado[normalizarNumeroOs(numero)]?.os;
      if (!info) {
        this.notificationService.showError(`OS ${numero} não encontrada no SIGMA — confira o número ou preencha manualmente.`);
        return;
      }
      if (!this.formDescricao().trim()) this.formDescricao.set(info.descricao);
      if (!this.formEquipamento().trim() && this.equipamentos().includes(info.equipamento)) {
        this.formEquipamento.set(info.equipamento);
      }
      if (!this.formTipoServico().trim() && this.tipoServicoOpcoes.includes(info.tipoServico)) {
        this.formTipoServico.set(info.tipoServico);
      }
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao consultar a OS no SIGMA.');
    } finally {
      this.buscandoOsNoSigma.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.manutencaoService.load();
      await this.apontamentosService.loadColaboradores();
      await this.manutencaoService.loadEquipamentos();
      if (this.areaFixa === 'APOIO') await this.carregarDadosApoio();
      else await this.manutencaoService.loadFerias();
    } catch {
      this.errorMessage.set('Erro ao carregar a programação de manutenção.');
    }
  }

  private tecnicosPorArea(area: ManutencaoArea): { nome: string; matricula: string | null }[] {
    if (area === 'APOIO') {
      return this.equipesApoio().map(e => ({ nome: e.nome, matricula: null }));
    }
    const termo = area === 'ELETRICA' ? 'ELETR' : 'MECAN';
    return this.apontamentosService.colaboradores()
      .filter(c => normalizarTexto(c.area).includes(termo))
      .map(c => ({ nome: c.nome, matricula: c.matricula }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // Todos os técnicos das duas áreas (Elétrica + Mecânica) — usado no lançamento de
  // feriado, que vale pra equipe toda. Apoio fica de fora (folga é um conceito por
  // pessoa, e lá quem aparece é empresa/equipe).
  todosTecnicos = computed(() => [
    ...this.tecnicosPorArea('ELETRICA').map(c => ({ nome: c.nome, matricula: c.matricula, area: 'ELETRICA' as ManutencaoArea })),
    ...this.tecnicosPorArea('MECANICA').map(c => ({ nome: c.nome, matricula: c.matricula, area: 'MECANICA' as ManutencaoArea })),
  ]);

  // ── Feriado (folga em lote pra toda a equipe) ─────────────────────────
  feriadoAberto = signal(false);
  feriadoDiasSelecionados = signal<string[]>([]);
  feriadoMotivo = signal('Feriado');

  abrirFeriado(): void {
    this.feriadoDiasSelecionados.set([]);
    this.feriadoMotivo.set('Feriado');
    this.feriadoAberto.set(true);
  }

  fecharFeriado(): void {
    this.feriadoAberto.set(false);
  }

  toggleDiaFeriado(dataIso: string): void {
    const atual = this.feriadoDiasSelecionados();
    this.feriadoDiasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  canConfirmarFeriado(): boolean {
    return this.feriadoDiasSelecionados().length > 0 && this.todosTecnicos().length > 0 && !this.isProcessando();
  }

  async confirmarFeriado(): Promise<void> {
    if (!this.canConfirmarFeriado()) return;
    const tecnicos = this.todosTecnicos();
    const motivo = this.feriadoMotivo().trim() || 'Feriado';
    if (!confirm(`Lançar "${motivo}" pra ${tecnicos.length} técnicos (Elétrica + Mecânica)?`)) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarFolgaEmLote({
        diasPrevistos: this.feriadoDiasSelecionados(),
        motivo,
        tecnicos,
      });
      this.notificationService.showSuccess(`"${motivo}" lançado pra ${tecnicos.length} técnicos.`);
      this.fecharFeriado();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao lançar feriado.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Criar/Editar OS ────────────────────────────────────────────────────
  abrirCriar(): void {
    this.formIdEdicao.set(null);
    this.formTipo.set('ordem');
    const area = this.areaFiltro();
    this.formArea.set(area !== 'todos' ? area : 'ELETRICA');
    this.formNumeroOs.set('');
    this.formSemOs.set(false);
    this.formDescricao.set('');
    this.formEquipamento.set('');
    this.formRecursos.set('');
    this.formLoto.set('');
    this.formAreaAtuacao.set('');
    this.formDuracaoHoras.set(null);
    this.formTipoServico.set('');
    this.formTecnicoNome.set('');
    this.formTecnicoMatricula.set('');
    this.formDiasSelecionados.set([]);
    this.formObservacoes.set('');
    this.formAberto.set(true);
  }

  // Abre "Novo lançamento" já preenchido a partir de um item do backlog do SIGMA —
  // poupa digitar o número da OS e esperar a busca (blur) que abrirCriar() + digitação
  // manual exigiriam.
  programarDoBacklog(item: SigmaBacklogItem): void {
    this.abrirCriar();
    this.formNumeroOs.set(item.numeroOs);
    this.formDescricao.set(item.descricao);
    if (this.equipamentos().includes(item.equipamento)) this.formEquipamento.set(item.equipamento);
    if (this.tipoServicoOpcoes.includes(item.tipoServico)) this.formTipoServico.set(item.tipoServico);
  }

  abrirEditar(o: ManutencaoOrdem): void {
    this.formIdEdicao.set(o.id);
    this.formTipo.set(o.tipo);
    this.formArea.set(o.area);
    this.formNumeroOs.set(o.numeroOs ?? '');
    this.formSemOs.set(o.semOs);
    this.formDescricao.set(o.descricao);
    this.formEquipamento.set(o.equipamento ?? '');
    this.formRecursos.set(o.recursos ?? '');
    this.formLoto.set(o.loto ?? '');
    this.formTipoServico.set(o.tipoServico ?? '');
    this.formAreaAtuacao.set(o.areaAtuacao ?? '');
    this.formDuracaoHoras.set(o.duracaoHoras);
    this.formTecnicoNome.set(o.tecnicoNome);
    this.formTecnicoMatricula.set(o.tecnicoMatricula ?? '');
    this.formDiasSelecionados.set([...o.diasPrevistos]);
    this.formObservacoes.set(o.observacoes ?? '');
    this.formAberto.set(true);
  }

  fecharForm(): void {
    this.formAberto.set(false);
  }

  // ── Adicionar apoio (duplica a OS pra um segundo técnico) ─────────────────
  // Cada técnico (principal e apoio) fica com seu próprio lançamento, editável
  // separadamente (dias, duração, status) — assim a OS aparece na agenda e na
  // capacidade dos dois, sem um único registro compartilhado entre eles.
  apoioAberto = signal(false);
  apoioOrigem = signal<ManutencaoOrdem | null>(null);
  apoioTecnicoNome = signal('');
  apoioTecnicoMatricula = signal('');

  tecnicosParaApoio = computed(() => {
    const origem = this.apoioOrigem();
    if (!origem) return [];
    return this.tecnicosPorArea(origem.area).filter(t => t.nome !== origem.tecnicoNome);
  });

  abrirApoio(o: ManutencaoOrdem): void {
    this.apoioOrigem.set(o);
    this.apoioTecnicoNome.set('');
    this.apoioTecnicoMatricula.set('');
    this.apoioAberto.set(true);
  }

  fecharApoio(): void {
    this.apoioAberto.set(false);
    this.apoioOrigem.set(null);
  }

  onApoioTecnicoSelected(nome: string): void {
    this.apoioTecnicoNome.set(nome);
    const colaborador = this.tecnicosParaApoio().find(c => c.nome === nome);
    this.apoioTecnicoMatricula.set(colaborador?.matricula ?? '');
  }

  // Mesmo bloqueio de férias/folga do formulário principal, aplicado ao técnico de
  // apoio nos dias da OS de origem.
  apoioTecnicoBloqueio = computed<{ motivo: string } | null>(() => {
    const origem = this.apoioOrigem();
    const nome = this.apoioTecnicoNome().trim();
    if (!origem || !nome) return null;
    const ferias = this.feriasNoIntervalo(nome, origem.diasPrevistos);
    if (ferias) return { motivo: `${nome} está de férias de ${this.formatarDataBr(ferias.dataInicio)} a ${this.formatarDataBr(ferias.dataFim)}.` };
    const folga = this.folgaNoIntervalo(nome, origem.diasPrevistos);
    if (folga) return { motivo: `${nome} já está de folga em algum desses dias.` };
    return null;
  });

  canConfirmarApoio(): boolean {
    return !this.isProcessando() && !!this.apoioOrigem() && !!this.apoioTecnicoNome().trim() && !this.apoioTecnicoBloqueio();
  }

  async confirmarApoio(): Promise<void> {
    const origem = this.apoioOrigem();
    if (!this.canConfirmarApoio() || !origem) return;
    this.isProcessando.set(true);
    try {
      await this.manutencaoService.criarOrdem({
        tipo: 'ordem',
        area: origem.area,
        semanaInicio: origem.semanaInicio,
        numeroOs: origem.numeroOs ?? undefined,
        semOs: origem.semOs,
        descricao: origem.descricao,
        equipamento: origem.equipamento ?? undefined,
        recursos: origem.recursos ?? undefined,
        loto: origem.loto ?? undefined,
        areaAtuacao: origem.areaAtuacao ?? undefined,
        duracaoHoras: origem.duracaoHoras ?? undefined,
        tipoServico: origem.tipoServico ?? undefined,
        tecnicoNome: this.apoioTecnicoNome(),
        tecnicoMatricula: this.apoioTecnicoMatricula() || undefined,
        diasPrevistos: origem.diasPrevistos,
        status: 'PEND',
        observacoes: origem.observacoes ?? undefined,
      });
      this.notificationService.showSuccess(`OS adicionada também para ${this.apoioTecnicoNome()}.`);
      this.fecharApoio();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar apoio.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  onTecnicoSelected(nome: string): void {
    this.formTecnicoNome.set(nome);
    const colaborador = this.tecnicosDaAreaForm().find(c => c.nome === nome);
    this.formTecnicoMatricula.set(colaborador?.matricula ?? '');
  }

  toggleDia(dataIso: string): void {
    const atual = this.formDiasSelecionados();
    this.formDiasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  // Descrição some pra folga/treinamento se a pessoa não digitar nada — usa o
  // próprio nome do tipo ("Folga", "Treinamento") em vez de obrigar a preencher.
  private descricaoParaEnvio(): string {
    return this.formDescricao().trim() || TIPO_LABEL[this.formTipo()];
  }

  // Avisa/bloqueia se o técnico escolhido no formulário está de férias em algum dos
  // dias marcados — não deixa lançar nada pra ele nesse período.
  formTecnicoFerias = computed<FeriasTecnico | null>(() => {
    const nome = this.formTecnicoNome().trim();
    const dias = this.formDiasSelecionados();
    if (!nome || dias.length === 0) return null;
    return this.feriasNoIntervalo(nome, dias);
  });

  // Mesma ideia pra folga: se o técnico já está de folga em algum dos dias marcados,
  // bloqueia — não deixa empilhar OS/treinamento/exame médico em cima da folga.
  formTecnicoFolga = computed<ManutencaoOrdem | null>(() => {
    const nome = this.formTecnicoNome().trim();
    const dias = this.formDiasSelecionados();
    if (!nome || dias.length === 0) return null;
    return this.folgaNoIntervalo(nome, dias, this.formIdEdicao());
  });

  formatarDataBr(dataIso: string): string {
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  canConfirmarForm(): boolean {
    if (this.isProcessando() || !this.formTecnicoNome().trim()) return false;
    if (this.formTecnicoFerias() || this.formTecnicoFolga()) return false;
    if (this.formTipo() === 'ordem') {
      return !!this.formDescricao().trim() && !!this.formLoto();
    }
    // Folga/treinamento: precisa de pelo menos um dia marcado, senão não diz nada.
    return this.formDiasSelecionados().length > 0;
  }

  async confirmarForm(): Promise<void> {
    if (!this.canConfirmarForm()) return;
    this.isProcessando.set(true);
    try {
      const tipo = this.formTipo();
      const ehOrdem = tipo === 'ordem';
      const idEdicao = this.formIdEdicao();
      if (idEdicao) {
        await this.manutencaoService.editarOrdem(idEdicao, {
          tipo,
          area: this.formArea(),
          numeroOs: ehOrdem ? (this.formNumeroOs().trim() || null) : null,
          semOs: ehOrdem && this.formSemOs(),
          descricao: this.descricaoParaEnvio(),
          equipamento: ehOrdem ? (this.formEquipamento().trim() || null) : null,
          recursos: ehOrdem ? (this.formRecursos().trim() || null) : null,
          loto: ehOrdem ? (this.formLoto().trim() || null) : null,
          areaAtuacao: ehOrdem ? (this.formAreaAtuacao().trim() || null) : null,
          duracaoHoras: ehOrdem ? this.formDuracaoHoras() : null,
          tipoServico: ehOrdem ? (this.formTipoServico().trim() || null) : null,
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || null,
          diasPrevistos: this.formDiasSelecionados(),
          // Status é sempre PEND ao adicionar/editar — quem diz se já foi executada é
          // o apontamento do SIGMA (ver statusExecucao()), não um campo digitado.
          status: ehOrdem ? 'PEND' : '',
          observacoes: this.formObservacoes().trim() || null,
        });
        this.notificationService.showSuccess(`${TIPO_LABEL[tipo]} atualizada.`);
      } else {
        await this.manutencaoService.criarOrdem({
          tipo,
          area: this.formArea(),
          semanaInicio: this.semanaFiltro(),
          numeroOs: ehOrdem ? (this.formNumeroOs().trim() || undefined) : undefined,
          semOs: ehOrdem && this.formSemOs(),
          descricao: this.descricaoParaEnvio(),
          equipamento: ehOrdem ? (this.formEquipamento().trim() || undefined) : undefined,
          recursos: ehOrdem ? (this.formRecursos().trim() || undefined) : undefined,
          loto: ehOrdem ? (this.formLoto().trim() || undefined) : undefined,
          areaAtuacao: ehOrdem ? (this.formAreaAtuacao().trim() || undefined) : undefined,
          duracaoHoras: ehOrdem ? (this.formDuracaoHoras() ?? undefined) : undefined,
          tipoServico: ehOrdem ? (this.formTipoServico().trim() || undefined) : undefined,
          tecnicoNome: this.formTecnicoNome(),
          tecnicoMatricula: this.formTecnicoMatricula() || undefined,
          diasPrevistos: this.formDiasSelecionados(),
          status: ehOrdem ? 'PEND' : undefined,
          observacoes: this.formObservacoes().trim() || undefined,
        });
        this.notificationService.showSuccess(`${TIPO_LABEL[tipo]} adicionada à programação.`);
      }
      this.fecharForm();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao salvar OS.');
    } finally {
      this.isProcessando.set(false);
    }
  }

  // ── Excluir ────────────────────────────────────────────────────────────
  async excluir(o: ManutencaoOrdem): Promise<void> {
    if (this.isProcessando()) return;
    if (!confirm(`Excluir "${o.descricao}" (${o.tecnicoNome})?\n\nEsta ação não pode ser desfeita.`)) return;

    this.isProcessando.set(true);
    try {
      await this.manutencaoService.excluir(o.id);
      this.notificationService.showSuccess('Excluído.');
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao excluir.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
