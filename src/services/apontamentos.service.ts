import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';

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

  constructor(private authService: AuthService) {}

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

  async importarArquivo(file: File): Promise<{ inseridos: number }> {
    const token = await this.authService.getValidAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve((e.target?.result as string).split(',')[1]);
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });

    const resp = await fetch('/api/import-apontamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fileData: base64, fileName: file.name }),
    });

    const result = await resp.json() as { success: boolean; inseridos?: number; error?: string };
    if (!result.success) throw new Error(result.error || 'Erro ao importar.');
    return { inseridos: result.inseridos ?? 0 };
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
