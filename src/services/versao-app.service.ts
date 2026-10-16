import { Injectable, signal } from '@angular/core';

// Avisa que subiu uma atualização do sistema enquanto a página estava aberta. A versão
// vem de /version.json (gerado no build, ver scripts/gerar-versao.mjs): a primeira
// leitura é a versão desta aba; se uma leitura seguinte vier diferente, novaVersao liga
// e a faixa do app-root pede pra recarregar. Confere a cada 5 min e sempre que a aba
// volta a ficar visível (quem deixou a aba aberta de um dia pro outro vê na hora).
@Injectable({ providedIn: 'root' })
export class VersaoAppService {
  private readonly INTERVALO_MS = 5 * 60_000;
  private versaoAtual: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly aoMudarVisibilidade = () => { if (document.visibilityState === 'visible') void this.verificar(); };

  novaVersao = signal(false);

  iniciar(): void {
    if (this.timer) return;
    void this.verificar();
    this.timer = setInterval(() => void this.verificar(), this.INTERVALO_MS);
    document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
  }

  // Chamado também pelo GlobalErrorHandler quando um pedaço lazy da tela (chunk) não
  // existe mais no servidor — sinal certo de que subiu versão nova.
  marcarNovaVersao(): void {
    this.novaVersao.set(true);
    this.parar();
  }

  async verificar(): Promise<void> {
    if (this.novaVersao()) return;
    const versao = await this.lerVersaoPublicada();
    if (!versao) return; // offline, ou ng serve sem version.json — tenta na próxima
    if (this.versaoAtual === null) this.versaoAtual = versao;
    else if (versao !== this.versaoAtual) this.marcarNovaVersao();
  }

  recarregar(): void {
    window.location.reload();
  }

  private parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.aoMudarVisibilidade);
  }

  private async lerVersaoPublicada(): Promise<string | null> {
    try {
      const resp = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) return null;
      const dados = await resp.json() as { versao?: unknown };
      return typeof dados.versao === 'string' && dados.versao ? dados.versao : null;
    } catch {
      return null;
    }
  }
}
