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

export interface Colaborador {
  nome: string;
  matricula: string;
  area: string;      // "Elétrica", "Mecânica" ou "Operação"
  email: string;
  nomeNorm: string;  // nome normalizado para matching
}

export interface RankingItem {
  colaborador: Colaborador;
  totalHoras: number;
  totalOS: number;
  temApontamentos: boolean;
}

export interface ApontamentosStats {
  totalOS: number;
  totalHoras: number;
  mediaHorasPorOS: number;
  porStatus: { status: string; count: number }[];
  porArea: { area: string; count: number; horas: number }[];
  ranking: RankingItem[];
}

export type EquipeTab = 'eletrica' | 'mecanica' | 'operacao';

@Injectable({ providedIn: 'root' })
export class ApontamentosService {
  isLoading   = signal(false);
  lastUpdated = signal<Date | null>(null);
  error       = signal('');

  private _colaboradores: Colaborador[] = [];

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
      const data = await resp.json() as Array<{ nome: string; matricula: string; area: string; email: string }>;
      this._colaboradores = data.map(d => ({
        nome:      d.nome.trim(),
        matricula: String(d.matricula).trim(),
        area:      d.area.trim(),
        email:     d.email?.trim() ?? '',
        nomeNorm:  this.normalizar(d.nome),
      }));
    } catch (err) {
      console.warn('[ApontamentosService] Falha ao carregar matriculas.json:', err);
      this._colaboradores = [];
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

  /** Busca o colaborador pelo executante (matrícula ou nome) */
  private matchColaborador(executante: string): Colaborador | null {
    if (!executante?.trim()) return null;
    const exec = executante.trim();

    // 1. Match por matrícula — SIGMA usa matrícula no campo Executante
    const porMatricula = this._colaboradores.find(c => c.matricula === exec);
    if (porMatricula) return porMatricula;

    // 2. Fallback por nome (caso o SIGMA mude o formato)
    const normExec = this.normalizar(exec);
    let found = this._colaboradores.find(c => c.nomeNorm === normExec);
    if (found) return found;

    found = this._colaboradores.find(c => normExec.includes(c.nomeNorm));
    if (found) return found;

    found = this._colaboradores.find(c => c.nomeNorm.includes(normExec));
    if (found) return found;

    return null;
  }

  // ── Apontamentos ─────────────────────────────────────────────────────────

  ultimaImportacao = signal<{ importado_em: string; total_registros: number } | null>(null);

  async loadApontamentos(dias = 60): Promise<Apontamento[]> {
    this.isLoading.set(true);
    this.error.set('');
    try {
      const token = await this.authService.getValidAccessToken();
      const params = new URLSearchParams({ dias: String(dias) });

      const resp = await fetch(`/api/apontamentos?${params}`, {
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

  // Processa o Excel no browser e insere direto no Supabase (sem Vercel)
  async importarArquivo(file: File): Promise<{ inseridos: number }> {
    const user = this.authService.currentUser();
    if (!user) throw new Error('Sessão expirada.');

    // Carrega xlsx dinamicamente (só quando necessário)
    const XLSX = await import('xlsx');

    const buffer = await file.arrayBuffer();
    const wb    = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws    = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    if (rows.length < 2) throw new Error('Arquivo vazio ou sem dados.');

    // Detecta colunas pelo nome do cabeçalho (robusto a variações do SIGMA)
    const headers = (rows[0] as unknown[]).map(h =>
      String(h ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    );
    const col = (nomes: string[]) => {
      for (const n of nomes) {
        const idx = headers.findIndex(h => h.includes(n));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // Mapeamento dinâmico — tenta por nome, cai no índice fixo como fallback
    const COLS = {
      id_sigma_os:     col(['id sigma os', 'sigma os', 'os sigma'])      ?? 2,
      registrador:     col(['registrador'])                               ?? 3,
      executante:      col(['executante'])                                ?? 4,
      solicitante:     col(['solicitante'])                               ?? 5,
      area_manutencao: col(['area manutencao', 'area de manutencao'])     ?? 6,
      numero_pt:       col(['numero pt', 'nr pt', 'pt'])                  ?? 7,
      status_operacao: col(['status operacao', 'status da operacao'])     ?? 8,
      data:            col(['data operacao', '^data$', 'data '])          ?? 9,
      hora_inicial:    col(['hora inicial', 'hora ini'])                  ?? 10,
      hora_final:      col(['hora final', 'hora fim'])                    ?? 11,
      intervalo:       col(['intervalo', 'almoco', 'intervalo almoco'])   ?? 12,
      feedback:        col(['feedback'])                                  ?? 13,
      status_usuario:  col(['status usuario'])                            ?? 14,
      equipe:          col(['equipe'])                                    ?? 15,
      supervisor:      col(['supervisor'])                                ?? 16,
      operador_sala:   col(['operador sala'])                             ?? 17,
      operador_campo:  col(['operador campo'])                            ?? 18,
      empresa:         col(['empresa'])                                   ?? 19,
      os_protheus:     col(['os protheus', 'protheus'])                   ?? 20,
    };

    // Helper para extrair hora como "HH:MM" de qualquer formato
    const extrairHora = (val: unknown): string => {
      if (!val) return '';
      if (val instanceof Date) {
        const h = String(val.getHours()).padStart(2, '0');
        const m = String(val.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      }
      const s = String(val).trim();
      const match = s.match(/(\d{1,2}):(\d{2})/);
      return match ? `${String(match[1]).padStart(2,'0')}:${match[2]}` : s;
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

    // Filtra: 1º dia do mês de 3 meses atrás até hoje (meses completos + mês atual)
    const inicio = new Date();
    inicio.setMonth(inicio.getMonth() - 3);
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    const dataLimite = inicio.toISOString().split('T')[0];
    const recordsFiltrados = records.filter(r => r.data && r.data >= dataLimite);

    if (recordsFiltrados.length === 0) {
      const totalLidos = records.length;
      const amostras = records.slice(0, 3).map(r => r.data ?? 'null').join(', ');
      throw new Error(
        `Nenhum registro a partir de ${dataLimite}. ` +
        `Total lido: ${totalLidos}. ` +
        `Primeiras datas: [${amostras || 'vazio'}]. ` +
        `Verifique se a coluna "Data" está no formato correto.`
      );
    }

    const sb = this.supabaseService.client;

    // Substitui todos os dados anteriores
    await sb.from('apontamentos').delete().gte('importado_em', '1900-01-01');

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

    return { inseridos: inserted };
  }

  private parseDateStr(val: unknown): string | null {
    if (!val && val !== 0) return null;

    // Date object (XLSX com cellDates: true)
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return null;
      // Usa UTC para não perder o dia por fuso horário
      const y = val.getUTCFullYear();
      const m = String(val.getUTCMonth() + 1).padStart(2, '0');
      const d = String(val.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // Número serial do Excel (ex: 45345 = dias desde 1900-01-01)
    if (typeof val === 'number' && val > 1) {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (isNaN(d.getTime())) return null;
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${da}`;
    }

    // String "DD/MM/YYYY" ou "YYYY-MM-DD" ou "DD/MM/YYYY HH:MM"
    const s = String(val).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
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

  /** Filtra apontamentos pela área da equipe — usa Matriculas como referência */
  filtrarPorEquipe(dados: Apontamento[], equipe: EquipeTab): Apontamento[] {
    const colab = this.getColaboradoresPorEquipe(equipe);
    if (colab.length === 0) {
      // Fallback: usa campo Equipe do SIGMA
      const termos: Record<EquipeTab, string> = { eletrica: 'ELÉTR', mecanica: 'MECÂN', operacao: 'OPERA' };
      return dados.filter(a => this.normalizar(a.equipe ?? '').includes(this.normalizar(termos[equipe])));
    }
    const nomesNorm = new Set(colab.map(c => c.nomeNorm));
    return dados.filter(a => {
      const match = this.matchColaborador(a.executante);
      return match ? nomesNorm.has(match.nomeNorm) : false;
    });
  }

  calcularStats(dados: Apontamento[], equipe: EquipeTab): ApontamentosStats {
    const totalOS    = dados.length;
    const totalHoras = parseFloat(dados.reduce((s, a) => s + (a.horas ?? 0), 0).toFixed(2));
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
      areaMap[ar].horas = parseFloat((areaMap[ar].horas + (a.horas ?? 0)).toFixed(2));
    }
    const porArea = Object.entries(areaMap)
      .map(([area, v]) => ({ area, ...v }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 10);

    // Ranking: TODOS os colaboradores da equipe + acumula apontamentos
    const membros = this.getColaboradoresPorEquipe(equipe);
    const rankMap = new Map<string, RankingItem>();

    // Inicializa todos com zero
    for (const c of membros) {
      rankMap.set(c.nomeNorm, { colaborador: c, totalHoras: 0, totalOS: 0, temApontamentos: false });
    }

    // Acumula apontamentos
    for (const a of dados) {
      const colab = this.matchColaborador(a.executante);
      if (!colab) continue;
      const item = rankMap.get(colab.nomeNorm);
      if (item) {
        item.totalHoras = parseFloat((item.totalHoras + (a.horas ?? 0)).toFixed(2));
        item.totalOS++;
        item.temApontamentos = true;
      } else {
        // Executante não está no cadastro mas tem apontamentos — inclui mesmo assim
        rankMap.set(colab.nomeNorm, {
          colaborador: colab,
          totalHoras: parseFloat((a.horas ?? 0).toFixed(2)),
          totalOS: 1,
          temApontamentos: true,
        });
      }
    }

    const ranking = Array.from(rankMap.values())
      .sort((a, b) => b.totalHoras - a.totalHoras || b.totalOS - a.totalOS);

    return { totalOS, totalHoras, mediaHorasPorOS, porStatus, porArea, ranking };
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
