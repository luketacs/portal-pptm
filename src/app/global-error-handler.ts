import { ErrorHandler, Injectable } from '@angular/core';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    try {
      const safeMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[GlobalErrorHandler]', safeMessage);
    } catch {
      // no-op
    }
  }
}
