import { ErrorHandler, Injectable, inject } from '@angular/core';
import { VersaoAppService } from '../services/versao-app.service';

// Tela lazy (loadComponent) cujo arquivo sumiu do servidor: a aba ainda está na versão
// antiga e o deploy novo trocou os nomes dos chunks.
const ERRO_CHUNK_ANTIGO = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i;

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private versaoApp = inject(VersaoAppService);

  handleError(error: unknown): void {
    try {
      const safeMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[GlobalErrorHandler]', safeMessage);
      if (ERRO_CHUNK_ANTIGO.test(safeMessage)) this.versaoApp.marcarNovaVersao();
    } catch {
      // no-op
    }
  }
}
