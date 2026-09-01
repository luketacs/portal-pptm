import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export interface Apontamento {
  id: string;
  data_registro: string;
  id_sigma_os: string;
  registrador: string;
  executante: string;
  solicitante: string;
  area_manutencao: string;
  numero_pt: string;
  status_operacao: string;
  data: string;
  hora_inicial: string;
  hora_final: string;
  intervalo: string;
  feedback: string;
  status_usuario: string;
  equipe: string;
  supervisor: string;
  operador_sala: string;
  operador_campo: string;
  empresa: string;
  os_protheus: string;
  horas: number;
}

// Data de corte: a partir de 01/06/2026 todos passam a ter 6.5h/dia
const CUTOFF_DISPONIBILIDADE = '2026-06-01';
const DISP_PADRAO = 6.5;

// "Hora Disponível": jornada cheia do colaborador (sem descontar o intervalo de almoço).
//  - Turno (07:30-19:30 ou 19:30-07:30): 12h disponíveis.
//  - Horário ADM (07:30-16:00): 8,5h disponíveis.
// A partir de 01/06/2026 as equipes elétrica e mecânica passam do turno para o horário ADM;
// a equipe de operação (restante) permanece no turno de 12h o ano todo.
const DISPONIVEL_TURNO_HORAS = 12;
const DISPONIVEL_ADM_HORAS = 8.5;

export interface Colaborador {
  nome: string;
  matricula: string;
  area: string;
  email: string;
  nomeNorm: string;
  disponibilidade: number;          // horas por dia antes do corte
  disponibilidade_pos_corte?: number; // horas por dia a partir do corte (se diferente)
}

export interface RankingItem {
  colaborador: Colaborador;
  totalHoras: number;
  totalOS: number;
  horasProgramadas: number; // dias trabalhados × disponibilidade cadastrada — só calculada p/ elétrica e mecânica
  horasDisponiveis: number; // dias trabalhados × jornada cheia do turno/horário (12h turno ou 8,5h ADM)
  eficiencia: number;       // totalHoras / horasProgramadas × 100
  temApontamentos: boolean;
}

export interface ApontamentosStats {
  totalOS: number;
  totalHoras: number;
  mediaHorasPorOS: number;
  porStatus: { status: string; count: number }[];
  porArea: { area: string; count: number; horas: number }[];
  ranking: RankingItem[];
  periodoInicio: string;
  periodoFim: string;
}

export type EquipeTab = 'eletrica' | 'mecanica' | 'operacao';

@Injectable({ providedIn: 'root' })
export class ApontamentosService {
  isLoading   = signal(false);
  lastUpdated = signal<Date | null>(null);
  error       = signal('');

  private readonly _colaboradoresData = signal<Colaborador[]>([]);
  private get _colaboradores(): Colaborador[] { return this._colaboradoresData(); }
  // Leitura pública da lista (nome/matrícula/área) — usada por outras telas que
  // precisam de um seletor de técnico/colaborador (ex.: Programação de Manutenção).
  colaboradores = this._colaboradoresData.asReadonly();

  constructor(
    private authService: AuthService,
    private supabaseService: SupabaseService
  ) {}

  // ── Matrícula / Colaboradores ────────────────────────────────────────────

  async loadColaboradores(): Promise<Colaborador[]> {
    if (this._colaboradores.length > 0) return this._colaboradores;
    try {
      // Arquivo estático bundlado pelo Angular (public/matriculas.json)
      const resp = await fetch('/matriculas.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as Array<{ nome: string; matricula: string; area: string; email: string; disponibilidade?: number; disponibilidade_pos_corte?: number }>;
      this._colaboradoresData.set(data.map(d => ({
        nome:           d.nome.trim(),
        matricula:      String(d.matricula).trim(),
        area:           d.area.trim(),
        email:          d.email?.trim() ?? '',
        nomeNorm:       this.normalizar(d.nome),
        disponibilidade:          typeof d.disponibilidade         === 'number' ? d.disponibilidade         : DISP_PADRAO,
        disponibilidade_pos_corte: typeof d.disponibilidade_pos_corte === 'number' ? d.disponibilidade_pos_corte : undefined,
      })));
    } catch (err) {
      console.warn('[ApontamentosService] Falha ao carregar matriculas.json:', err);
      this._colaboradoresData.set([]);
    }
    return this._colaboradores;
  }

  getColaboradoresPorEquipe(equipe: EquipeTab): Colaborador[] {
    const termos: Record<EquipeTab, string> = {
      eletrica: 'ELETRIC',
      mecanica: 'MECAN',
      operacao: 'OPERA',
    };
    const termo = termos[equipe];
    return this._colaboradores.filter(c =>
      this.normalizar(c.area).includes(termo)
    );
  }

  /** Busca o colaborador pelo executante (matrícula ou nome — múltiplos formatos) */
  private matchColaborador(executante: string): Colaborador | null {
    if (!executante?.trim()) return null;
    const exec = executante.trim();

    // 1. Matrícula exata
    const porMatricula = this._colaboradores.find(c => c.matricula === exec);
    if (porMatricula) return porMatricula;

    // 2. Extrai parte numérica e tenta como matrícula (ex: "20006163 - WILLIANS" → "20006163")
    const numericPart = exec.replace(/\D+/g, '');
    if (numericPart.length >= 5) {
      const porNumerico = this._colaboradores.find(c => c.matricula === numericPart);
      if (porNumerico) return porNumerico;
    }

    // 3. Nome normalizado exato
    const normExec = this.normalizar(exec);
    let found = this._colaboradores.find(c => c.nomeNorm === normExec);
    if (found) return found;

    // 4. executante contém o nome completo do colaborador
    found = this._colaboradores.find(c => normExec.includes(c.nomeNorm));
    if (found) return found;

    // 5. nome do colaborador contém o executante
    found = this._colaboradores.find(c => c.nomeNorm.includes(normExec));
    if (found) return found;

    // 6. Cada parte do nome do executante (palavras) bate com início do nome do colaborador
    const partesExec = normExec.split(/\s+/).filter(p => p.length > 3);
    if (partesExec.length >= 2) {
      found = this._colaboradores.find(c =>
        partesExec.every(p => c.nomeNorm.includes(p))
      );
      if (found) return found;
    }

    return null;
  }

  // ── Apontamentos ─────────────────────────────────────────────────────────

  ultimaImportacao = signal<{ importado_em: string; total_registros: number } | null>(null);

  async loadApontamentos(): Promise<Apontamento[]> {
    this.isLoading.set(true);
    this.error.set('');
    try {
      const token = await this.authService.getValidAccessToken();

      const resp = await fetch(`/api/apontamentos`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const contentType = resp.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        throw new Error(`Função não encontrada (HTTP ${resp.status}). Faça o deploy: vercel --prod`);
      }

      const result = await resp.json() as {
        success: boolean;
        data?: Apontamento[];
        error?: string;
        ultima_importacao?: { importado_em: string; total_registros: number } | null;
      };

      if (!resp.ok || !result.success) {
        throw new Error(result.error || `Erro HTTP ${resp.status}`);
      }

      if (result.ultima_importacao) this.ultimaImportacao.set(result.ultima_importacao);
      this.lastUpdated.set(new Date());
      return result.data ?? [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      this.error.set(msg);
      return [];
    } finally {
      this.isLoading.set(false);
    }
  }

  // Lê e normaliza o Excel do SIGMA no browser, sem gravar no banco.
  // Usado pela importação manual de arquivo (admin).
  private async parsearArquivoSigma(file: File): Promise<{
    recordsFiltrados: Record<string, unknown>[];
    porMes: Record<string, number>;
    dataLimite: string;
  }> {
    // Carrega xlsx dinamicamente (só quando necessário)
    const XLSX = await import('xlsx');

    const buffer = await file.arrayBuffer();
    // raw:true + cellDates:false → datas de Excel viram seriais numéricos (sem conversão de timezone)
    // parseDateStr converte o serial via math UTC: sem dependência de fuso horário
    const wb    = XLSX.read(buffer, { type: 'array', cellDates: false });
    const ws    = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][];

    if (rows.length < 2) throw new Error('Arquivo vazio ou sem dados.');

    // ── Detecção de colunas ──────────────────────────────────────────────────
    // 1. Pelo cabeçalho (linha 0)
    const headers = (rows[0] as unknown[]).map(h =>
      String(h ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    );
    const colByHeader = (nomes: string[]) => {
      for (const n of nomes) {
        const idx = headers.findIndex(h => h === n || h.includes(n));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // 2. Pela forma do valor (varre as primeiras linhas de dados)
    const primeiraLinhaComDados = (rows as unknown[][]).slice(1, 20)
      .find(r => (r as unknown[]).some(v => v !== '' && v !== null && v !== undefined));

    const colByValuePattern = (pattern: RegExp) => {
      if (!primeiraLinhaComDados) return -1;
      return (primeiraLinhaComDados as unknown[]).findIndex(v => {
        if (v instanceof Date) return true; // Date object = célula de data
        return pattern.test(String(v ?? '').trim());
      });
    };

    // Padrões de data e hora
    const isDate = /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}/;
    const isTime = /^\d{1,2}:\d{2}/;

    const COLS = {
      // Detecta pelo cabeçalho; fallback por valor; fallback por índice fixo
      id_sigma_os:     colByHeader(['id sigma os', 'sigma os'])       !== -1 ? colByHeader(['id sigma os', 'sigma os'])       : 2,
      registrador:     colByHeader(['registrador'])                   !== -1 ? colByHeader(['registrador'])                   : 3,
      executante:      colByHeader(['executante'])                    !== -1 ? colByHeader(['executante'])                    : 4,
      solicitante:     colByHeader(['solicitante'])                   !== -1 ? colByHeader(['solicitante'])                   : 5,
      area_manutencao: colByHeader(['area manutencao'])               !== -1 ? colByHeader(['area manutencao'])               : 6,
      numero_pt:       colByHeader(['numero pt', 'nr pt'])            !== -1 ? colByHeader(['numero pt', 'nr pt'])            : 7,
      status_operacao: colByHeader(['status operacao'])               !== -1 ? colByHeader(['status operacao'])               : 8,
      // "Data" — procura pelo cabeçalho exato, depois pelo padrão de valor
      data: (() => {
        const byH = headers.findIndex(h => h === 'data');
        if (byH >= 0) return byH;
        const byV = colByValuePattern(isDate);
        return byV >= 0 ? byV : 9;
      })(),
      // Hora inicial — próxima coluna com padrão HH:MM após a coluna data
      hora_inicial:    colByHeader(['hora inicial'])                  !== -1 ? colByHeader(['hora inicial'])                  : 10,
      hora_final:      colByHeader(['hora final'])                    !== -1 ? colByHeader(['hora final'])                    : 11,
      intervalo:       colByHeader(['intervalo', 'intervalo almoco']) !== -1 ? colByHeader(['intervalo', 'intervalo almoco']) : 12,
      feedback:        colByHeader(['feedback'])                      !== -1 ? colByHeader(['feedback'])                      : 13,
      status_usuario:  colByHeader(['status usuario'])                !== -1 ? colByHeader(['status usuario'])                : 14,
      equipe:          colByHeader(['equipe'])                        !== -1 ? colByHeader(['equipe'])                        : 15,
      supervisor:      colByHeader(['supervisor'])                    !== -1 ? colByHeader(['supervisor'])                    : 16,
      operador_sala:   colByHeader(['operador sala'])                 !== -1 ? colByHeader(['operador sala'])                 : 17,
      operador_campo:  colByHeader(['operador campo'])                !== -1 ? colByHeader(['operador campo'])                : 18,
      empresa:         colByHeader(['empresa'])                       !== -1 ? colByHeader(['empresa'])                       : 19,
      os_protheus:     colByHeader(['os protheus', 'protheus'])       !== -1 ? colByHeader(['os protheus', 'protheus'])       : 20,
    };

    // Log para diagnóstico (visível no console do browser)
    console.log('[Apontamentos] Colunas detectadas:', COLS);
    console.log('[Apontamentos] Cabeçalhos:', headers.slice(0, 22));
    if (primeiraLinhaComDados) {
      console.log('[Apontamentos] Primeira linha de dados:', (primeiraLinhaComDados as unknown[]).slice(0, 22));
    }

    // Helper para extrair hora como "HH:MM"
    // Com raw:true os valores chegam como: string "08:30:00", fração decimal 0.354 (hora) ou inteiro 1 (intervalo)
    const extrairHora = (val: unknown): string => {
      if (!val && val !== 0) return '';
      if (typeof val === 'number') {
        if (val >= 0 && val < 1) {
          // Fração de dia: ex 0.354 = 08:30, 0.667 = 16:00
          const totalMin = Math.round(val * 24 * 60);
          return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
        }
        // Inteiro ≥ 1 → unidades de 30 min (convenção SIGMA: 1 = 30min, 2 = 60min)
        const totalMin = Math.round(val * 30);
        return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
      }
      const s = String(val).trim();
      const tmMatch = s.match(/(\d{1,2}):(\d{2})/);
      if (tmMatch) return `${String(tmMatch[1]).padStart(2, '0')}:${tmMatch[2]}`;
      // String numérica → mesma lógica: fração = horas do dia, inteiro = unidades de 30 min
      const n = parseFloat(s);
      if (!isNaN(n) && n >= 0) {
        const totalMin = n < 1 ? Math.round(n * 24 * 60) : Math.round(n * 30);
        return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
      }
      return '';
    };

    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const v = rows[i] as unknown[];
      if (!v[COLS.executante]) continue;
      const hi  = extrairHora(v[COLS.hora_inicial]);
      const hf  = extrairHora(v[COLS.hora_final]);
      const inv = extrairHora(v[COLS.intervalo]);
      const dataVal = v[COLS.data];
      records.push({
        id_sigma_os:     String(v[COLS.id_sigma_os]     ?? '').trim() || null,
        registrador:     String(v[COLS.registrador]     ?? '').trim() || null,
        executante:      String(v[COLS.executante]      ?? '').trim() || null,
        solicitante:     String(v[COLS.solicitante]     ?? '').trim() || null,
        area_manutencao: String(v[COLS.area_manutencao] ?? '').trim() || null,
        numero_pt:       String(v[COLS.numero_pt]       ?? '').trim() || null,
        status_operacao: String(v[COLS.status_operacao] ?? '').trim() || null,
        data:            this.parseDateStr(dataVal),
        hora_inicial:    hi  || null,
        hora_final:      hf  || null,
        intervalo:       inv || null,
        feedback:        String(v[COLS.feedback]        ?? '').trim() || null,
        status_usuario:  String(v[COLS.status_usuario]  ?? '').trim() || null,
        equipe:          String(v[COLS.equipe]          ?? '').trim() || null,
        supervisor:      String(v[COLS.supervisor]      ?? '').trim() || null,
        operador_sala:   String(v[COLS.operador_sala]   ?? '').trim() || null,
        operador_campo:  String(v[COLS.operador_campo]  ?? '').trim() || null,
        empresa:         String(v[COLS.empresa]         ?? '').trim() || null,
        os_protheus:     String(v[COLS.os_protheus]     ?? '').trim() || null,
        horas:           this.calcHoras(hi, hf, inv),
      });
    }

    // Filtra: a partir de 01/01 do ano atual (ano todo)
    const dataLimite = `${new Date().getFullYear()}-01-01`;
    const recordsFiltrados = records.filter(r => r.data && r.data >= dataLimite);

    // Diagnóstico: quantos registros por mês
    const porMes: Record<string, number> = {};
    for (const r of recordsFiltrados) {
      const mes = r.data?.substring(0, 7) ?? 'sem-data';
      porMes[mes] = (porMes[mes] ?? 0) + 1;
    }

    if (recordsFiltrados.length === 0) {
      const amostras = records.slice(0, 3).map(r => r.data ?? 'null').join(', ');
      throw new Error(`Nenhum registro a partir de ${dataLimite}. Lidos: ${records.length} | Datas: [${amostras}]`);
    }

    return { recordsFiltrados, porMes, dataLimite };
  }

  // Processa o Excel no browser e insere direto no Supabase via sessão do usuário (RLS)
  // Usado pela importação manual de arquivo — exige Admin autenticado.
  async importarArquivo(file: File): Promise<{ inseridos: number; porMes: Record<string, number> }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    const { recordsFiltrados, porMes, dataLimite } = await this.parsearArquivoSigma(file);

    const sb = this.supabaseService.client;

    // Deleta todos os registros do período antes de reinserir (garante dados limpos)
    const { error: deleteError } = await sb.from('apontamentos').delete().gte('data', dataLimite);
    if (deleteError) throw new Error(`Erro ao limpar dados anteriores: ${deleteError.message}`);

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < recordsFiltrados.length; i += BATCH) {
      const { error } = await sb.from('apontamentos').insert(recordsFiltrados.slice(i, i + BATCH));
      if (error) throw new Error(`Erro ao salvar: ${error.message}`);
      inserted += Math.min(BATCH, recordsFiltrados.length - i);
    }

    await sb.from('apontamentos_importacoes').insert({
      nome_arquivo:    file.name,
      total_registros: inserted,
      importado_por:   user.id,
    });

    return { inseridos: inserted, porMes };
  }

  private parseDateStr(val: unknown): string | null {
    if (!val && val !== 0) return null;

    // Date object (XLSX com cellDates: true)
    // XLSX gera datas como UTC midnight, mas o timezone local (GMT-3) faz o dia recuar.
    // Usamos getFullYear/Month/Date (horário LOCAL do browser) que reflete o dia correto.
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return null;
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // Serial Excel com componente de tempo (ex: 46173.875 = May 31 + 21h local = June 1 00:00 UTC)
    // O SIGMA guarda datas como DATETIME: a fração .875 representa midnight local UTC-3
    // Math.round strip o componente de tempo arredondando para o serial do dia correto
    if (typeof val === 'number' && val > 1) {
      const dateSerial = Math.round(val); // 46173.875 → 46174 = June 1
      const dt = new Date((dateSerial - 25569) * 86400 * 1000);
      if (isNaN(dt.getTime())) return null;
      const y  = dt.getUTCFullYear();
      const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const da = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${da}`;
    }

    const s = String(val).trim();
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (br) {
      let y = parseInt(br[3]);
      let m: string, d: string;
      if (br[3].length === 4) {
        // Ano com 4 dígitos → formato brasileiro DD/MM/YYYY
        // ex: "01/06/2026" = dia 1, mês 6 (junho) → "2026-06-01"
        d = br[1].padStart(2, '0'); // DIA  (primeiro número)
        m = br[2].padStart(2, '0'); // MÊS (segundo número)
      } else {
        // Ano com 2 dígitos → formato americano M/D/YY (confirmado no SIGMA)
        // ex: "11/3/24" = mês 11 (novembro), dia 3 → "2024-11-03"
        m = br[1].padStart(2, '0'); // MÊS (primeiro número)
        d = br[2].padStart(2, '0'); // DIA  (segundo número)
        if (y < 100) y += 2000;
      }
      return `${y}-${m}-${d}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    return null;
  }

  private calcHoras(hi: string, hf: string, inv: string): number {
    if (!hi || !hf) return 0;
    const toMin = (h: string) => {
      const p = h.split(':');
      return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
    };
    let mins = toMin(hf) - toMin(hi);
    // Turno noturno: ex 20:00 → 02:00 = -1080 min → soma 24h → 360 min = 6h
    if (mins < 0) mins += 24 * 60;
    if (inv) mins -= toMin(inv);
    return Math.max(0, parseFloat((mins / 60).toFixed(2)));
  }

  /** Filtra apontamentos pela área da equipe — usa matrícula/nome E campo equipe do SIGMA */
  filtrarPorEquipe(dados: Apontamento[], equipe: EquipeTab): Apontamento[] {
    const termosSIGMA: Record<EquipeTab, string> = {
      eletrica: 'ELETRIC',
      mecanica: 'MECAN',
      operacao: 'OPERA',
    };
    const termoSIGMA = termosSIGMA[equipe];

    const colab = this.getColaboradoresPorEquipe(equipe);
    const nomesNorm = new Set(colab.map(c => c.nomeNorm));

    return dados.filter(a => {
      // Critério 1: executante bate com colaborador da equipe (matrícula ou nome)
      const match = this.matchColaborador(a.executante);
      if (match && nomesNorm.has(match.nomeNorm)) return true;

      // Critério 2: campo equipe do SIGMA indica esta equipe (cobre formatos de executante não reconhecidos)
      if (a.equipe && this.normalizar(a.equipe).includes(termoSIGMA)) return true;

      return false;
    });
  }

  calcularStats(dados: Apontamento[], equipe: EquipeTab, filtroMes = ''): ApontamentosStats {
    const totalOS    = dados.length;
    const totalHoras = parseFloat(dados.reduce((s, a) => s + Number(a.horas ?? 0), 0).toFixed(2));
    const mediaHorasPorOS = totalOS > 0 ? parseFloat((totalHoras / totalOS).toFixed(2)) : 0;

    // Por status
    const statusMap: Record<string, number> = {};
    for (const a of dados) {
      const s = a.status_operacao?.trim() || 'SEM STATUS';
      statusMap[s] = (statusMap[s] || 0) + 1;
    }
    const porStatus = Object.entries(statusMap)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // Por área de manutenção
    const areaMap: Record<string, { count: number; horas: number }> = {};
    for (const a of dados) {
      const ar = a.area_manutencao?.trim() || 'SEM ÁREA';
      if (!areaMap[ar]) areaMap[ar] = { count: 0, horas: 0 };
      areaMap[ar].count++;
      areaMap[ar].horas = parseFloat((areaMap[ar].horas + Number(a.horas ?? 0)).toFixed(2));
    }
    const porArea = Object.entries(areaMap)
      .map(([area, v]) => ({ area, ...v }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 10);

    // ── H. Programada / H. Disponível: apenas nos dias em que o colaborador teve apontamento ──
    // Pré-calcula dias únicos com apontamento por colaborador
    const diasPorColab = new Map<string, Set<string>>();
    for (const a of dados) {
      const colab = this.matchColaborador(a.executante);
      if (!colab || !a.data) continue;
      if (!diasPorColab.has(colab.nomeNorm)) diasPorColab.set(colab.nomeNorm, new Set());
      diasPorColab.get(colab.nomeNorm)!.add(a.data);
    }

    // H. Programada = soma da disponibilidade cadastrada (matriculas.json) apenas nos dias com
    // apontamento. Eficiência é medida contra esse valor — calculado só para elétrica/mecânica.
    const calcProgramadas = (c: Colaborador): number => {
      if (equipe === 'operacao') return 0;
      const dias = diasPorColab.get(c.nomeNorm) ?? new Set<string>();
      let total = 0;
      for (const dia of dias) {
        const disp = dia >= CUTOFF_DISPONIBILIDADE
          ? (c.disponibilidade_pos_corte ?? c.disponibilidade)
          : c.disponibilidade;
        total += disp;
      }
      return parseFloat(total.toFixed(2));
    };

    // H. Disponível = soma da jornada cheia (turno de 12h ou horário ADM de 8,5h) apenas nos
    // dias com apontamento. Elétrica/mecânica migram do turno para o ADM em 01/06/2026;
    // a operação permanece no turno de 12h o ano todo.
    const calcDisponivel = (c: Colaborador): number => {
      const dias = diasPorColab.get(c.nomeNorm) ?? new Set<string>();
      let total = 0;
      for (const dia of dias) {
        const jornada = (equipe !== 'operacao' && dia >= CUTOFF_DISPONIBILIDADE)
          ? DISPONIVEL_ADM_HORAS
          : DISPONIVEL_TURNO_HORAS;
        total += jornada;
      }
      return parseFloat(total.toFixed(2));
    };

    // Para o label do período: usa datas reais dos dados
    const datasPresentes = dados.map(a => a.data!).filter(Boolean).sort();
    const periodoInicio = datasPresentes[0] ?? new Date().toISOString().split('T')[0];
    const periodoFim    = datasPresentes[datasPresentes.length - 1] ?? periodoInicio;

    // Ranking: TODOS os colaboradores da equipe
    const membros = this.getColaboradoresPorEquipe(equipe);
    const rankMap = new Map<string, RankingItem>();

    // Inicializa todos os membros com horasProgramadas/horasDisponiveis = 0 (calculado após acumular)
    for (const c of membros) {
      rankMap.set(c.nomeNorm, {
        colaborador: c, totalHoras: 0, totalOS: 0,
        horasProgramadas: 0, horasDisponiveis: 0, eficiencia: 0, temApontamentos: false,
      });
    }

    // Diagnóstico: executantes que não matcheiam (primeiros 8 de jan-mar)
    const execSemMatch: string[] = [];
    let totalSemMatch = 0;

    // Acumula apontamentos
    for (const a of dados) {
      const horas = Number(a.horas ?? 0);
      const colab = this.matchColaborador(a.executante);
      if (!colab) {
        totalSemMatch++;
        if (a.data && a.data < '2026-04-01' && execSemMatch.length < 8) {
          execSemMatch.push(`[${a.data}] "${a.executante}"`);
        }
        continue;
      }
      const item = rankMap.get(colab.nomeNorm);
      if (item) {
        item.totalHoras = parseFloat((item.totalHoras + horas).toFixed(2));
        item.totalOS++;
        item.temApontamentos = true;
      } else {
        rankMap.set(colab.nomeNorm, {
          colaborador: colab,
          totalHoras: parseFloat(horas.toFixed(2)),
          totalOS: 1,
          horasProgramadas: calcProgramadas(colab),
          horasDisponiveis: calcDisponivel(colab),
          eficiencia: 0, temApontamentos: true,
        });
      }
    }

    if (totalSemMatch > 0) {
      console.warn(`[Stats] ${totalSemMatch} registros sem colaborador mapeado. Exemplos jan-mar:`, execSemMatch);
    }

    // Calcula horasProgramadas, horasDisponiveis e eficiência final para cada membro
    for (const item of rankMap.values()) {
      item.horasProgramadas = calcProgramadas(item.colaborador);
      item.horasDisponiveis = calcDisponivel(item.colaborador);
      item.eficiencia = item.horasProgramadas > 0
        ? parseFloat(((item.totalHoras / item.horasProgramadas) * 100).toFixed(1))
        : 0;
    }

    const ranking = Array.from(rankMap.values())
      .sort((a, b) => b.totalHoras - a.totalHoras || b.totalOS - a.totalOS);

    return { totalOS, totalHoras, mediaHorasPorOS, porStatus, porArea, ranking, periodoInicio, periodoFim };
  }

  parseDate(str: string): Date | null {
    if (!str) return null;
    const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return new Date(+br[3], +br[2] - 1, +br[1]);
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDate(str: string): string {
    const d = this.parseDate(str);
    if (!d) return str;
    return new Intl.DateTimeFormat('pt-BR').format(d);
  }

  private normalizar(str: string): string {
    return String(str ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
}
