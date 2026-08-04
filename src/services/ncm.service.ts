import { Injectable, signal } from '@angular/core';
import { NcmEntry, NcmEntryIndexado, buscarNcm, indexarNcm } from '../utils/ncm-search';

export type { NcmEntry };

// Tabela oficial da Receita Federal / Siscomex (portalunico.siscomex.gov.br), baixada
// e processada em public/ncm.json — ver script de geração no histórico do projeto.
// Cada item já traz a hierarquia completa (capítulo > posição > ...) concatenada,
// porque a descrição do código final sozinha costuma ser genérica demais ("Outros").
@Injectable({ providedIn: 'root' })
export class NcmService {
  private _codigos = signal<NcmEntryIndexado[]>([]);
  private _isLoading = signal(false);
  isLoading = this._isLoading.asReadonly();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this._isLoading.set(true);
    this.loadPromise = (async () => {
      try {
        const resp = await fetch('/ncm.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as { codigos: { c: string; d: string }[] };
        this._codigos.set(data.codigos.map(x => indexarNcm(x.c, x.d)));
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

  buscar(termo: string, limite = 40): NcmEntry[] {
    return buscarNcm(this._codigos(), termo, limite);
  }
}
