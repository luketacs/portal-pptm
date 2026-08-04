import { Injectable, signal } from '@angular/core';

export interface NcmEntry {
  codigo: string;      // 8 dígitos, sem pontuação
  descricao: string;   // hierarquia completa (capítulo > posição > ... > item)
}

interface NcmEntryInterna extends NcmEntry {
  descricaoNorm: string;
  folhaNorm: string;  // só o último trecho da hierarquia (o mais específico)
  restoNorm: string;  // tudo, exceto o 1º trecho (o capítulo)
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
          const segmentos = descricaoNorm.split(' > ');
          return {
            codigo: x.c,
            descricao: x.d,
            descricaoNorm,
            folhaNorm: segmentos[segmentos.length - 1],
            // Sem o 1º trecho (capítulo) — ele costuma listar várias famílias de produto
            // diferentes numa frase só (ex.: "Sabões... preparações lubrificantes... ceras..."),
            // então um termo que só aparece ali é falso positivo na maioria das vezes.
            restoNorm: segmentos.length > 1 ? segmentos.slice(1).join(' > ') : descricaoNorm,
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

    // Relevância: 2 = bate no trecho mais específico (a "folha"); 1 = bate em algum
    // trecho intermediário; 0 = só bate no título do capítulo (1º trecho), que costuma
    // listar várias famílias de produto bem diferentes numa frase só — nesse caso o termo
    // buscado geralmente não tem nada a ver com o item em si, é só menção de passagem.
    const bons: { item: NcmEntryInterna; relevancia: number }[] = [];
    const somenteCapitulo: NcmEntryInterna[] = [];
    for (const item of this._codigos()) {
      if (!regexes.every(r => r.test(item.descricaoNorm))) continue;
      if (regexes.every(r => r.test(item.folhaNorm))) {
        bons.push({ item, relevancia: 2 });
      } else if (regexes.every(r => r.test(item.restoNorm))) {
        bons.push({ item, relevancia: 1 });
      } else {
        somenteCapitulo.push(item);
      }
    }

    bons.sort((a, b) => b.relevancia - a.relevancia);
    // Só cai pros resultados "só bate no capítulo" se não achou nada melhor — mais vale
    // isso do que dizer que não encontrou nada.
    const fonte = bons.length > 0 ? bons.map(b => b.item) : somenteCapitulo;
    return fonte.slice(0, limite).map(item => ({ codigo: item.codigo, descricao: item.descricao }));
  }
}
