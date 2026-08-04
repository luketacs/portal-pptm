import { Injectable, signal } from '@angular/core';

export interface NcmEntry {
  codigo: string;      // 8 dígitos, sem pontuação
  descricao: string;   // hierarquia completa (capítulo > posição > ... > item)
}

interface NcmEntryInterna extends NcmEntry {
  descricaoNorm: string;
  folhaNorm: string; // só o último trecho da hierarquia (o mais específico)
}

// Tabela oficial da Receita Federal / Siscomex (portalunico.siscomex.gov.br), baixada
// e processada em public/ncm.json — ver script de geração no histórico do projeto.
// Cada item já traz a hierarquia completa (capítulo > posição > ...) concatenada,
// porque a descrição do código final sozinha costuma ser genérica demais ("Outros").
@Injectable({ providedIn: 'root' })
export class NcmService {
  private _codigos = signal<NcmEntryInterna[]>([]);
  private _isLoading = signal(false);
  isLoading = this._isLoading.asReadonly();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  private readonly DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

  private normalizar(str: string): string {
    return String(str ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(this.DIACRITICOS, '');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this._isLoading.set(true);
    this.loadPromise = (async () => {
      try {
        const resp = await fetch('/ncm.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as { codigos: { c: string; d: string }[] };
        this._codigos.set(data.codigos.map(x => {
          const descricaoNorm = this.normalizar(x.d);
          const ultimoSeparador = descricaoNorm.lastIndexOf(' > ');
          return {
            codigo: x.c,
            descricao: x.d,
            descricaoNorm,
            folhaNorm: ultimoSeparador >= 0 ? descricaoNorm.slice(ultimoSeparador + 3) : descricaoNorm,
          };
        }));
        this.loaded = true;
      } catch (err) {
        console.warn('[NcmService] Falha ao carregar ncm.json:', err);
        this._codigos.set([]);
      } finally {
        this._isLoading.set(false);
      }
    })();
    return this.loadPromise;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  buscar(termo: string, limite = 40): NcmEntry[] {
    const alvo = termo.trim();
    if (!alvo) return [];

    const apenasDigitos = alvo.replace(/\D/g, '');
    if (apenasDigitos.length >= 4) {
      const porCodigo = this._codigos().filter(e => e.codigo.startsWith(apenasDigitos));
      if (porCodigo.length > 0) return porCodigo.slice(0, limite).map(({ codigo, descricao }) => ({ codigo, descricao }));
    }

    const palavras = this.normalizar(alvo).split(/\s+/).filter(Boolean);
    if (palavras.length === 0) return [];

    // Início de palavra (\b), não qualquer trecho — senão "rolamento" bate dentro de
    // "enrolamento", "parafuso" dentro de "aparafusado", etc.
    const regexes = palavras.map(p => new RegExp(`\\b${this.escapeRegex(p)}`));

    // Prioriza quem bate no trecho mais específico (a "folha" da hierarquia) — um termo
    // que só aparece lá em cima, num capítulo genérico (ex.: "parafusos" citado de
    // passagem na descrição de um lubrificante), é bem menos relevante.
    const encontrados: { item: NcmEntryInterna; relevancia: number }[] = [];
    for (const item of this._codigos()) {
      if (!regexes.every(r => r.test(item.descricaoNorm))) continue;
      const relevancia = regexes.every(r => r.test(item.folhaNorm)) ? 1 : 0;
      encontrados.push({ item, relevancia });
    }

    encontrados.sort((a, b) => b.relevancia - a.relevancia);
    return encontrados.slice(0, limite).map(({ item }) => ({ codigo: item.codigo, descricao: item.descricao }));
  }
}
