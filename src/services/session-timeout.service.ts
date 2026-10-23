import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';

/**
 * Serviço responsável por gerenciar o timeout de sessão por inatividade
 * Faz logout automático quando o usuário fica inativo por muito tempo
 */
@Injectable({ providedIn: 'root' })
export class SessionTimeoutService implements OnDestroy {
  // Tempo de inatividade em milissegundos (30 minutos)
  private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000;
  
  // Tempo para avisar antes de fazer logout (5 minutos antes)
  private readonly WARNING_TIME = 5 * 60 * 1000;
  
  // Timer de inatividade
  private inactivityTimer?: number;
  
  // Timer de aviso
  private warningTimer?: number;
  
  // Flag para saber se já mostrou o aviso
  private warningShown = false;
  
  // Flag para saber se o serviço está ativo
  private isActive = false;
  
  // Timestamp da última atividade
  private lastActivity = Date.now();

  // Atividade compartilhada entre as abas: o logout é global (derruba a sessão em todas),
  // então uma aba parada não pode deslogar enquanto o usuário trabalha em outra — era isso
  // que fazia as SCs sumirem ("não existe") no meio da edição.
  private readonly ATIVIDADE_STORAGE_KEY = 'portal-pptm-ultima-atividade';
  // mousemove dispara dezenas de vezes por segundo; grava/reagenda no máx. a cada 5 s.
  private readonly INTERVALO_REGISTRO_MS = 5000;
  private ultimoRegistro = 0;

  // Eventos que resetam o timer de inatividade
  private readonly ACTIVITY_EVENTS = [
    'mousedown',
    'mousemove',
    'keydown',
    'scroll',
    'touchstart',
    'click'
  ];

  constructor(
    private authService: AuthService,
    private router: Router,
    private notificationService: NotificationService,
    private ngZone: NgZone
  ) {}

  ngOnDestroy(): void {
    this.stop();
  }

  /**
   * Inicia o monitoramento de inatividade
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    console.log('[SessionTimeout] Starting inactivity monitoring...');
    this.isActive = true;
    this.lastActivity = Date.now();
    this.warningShown = false;

    // Registrar listeners de atividade
    this.registerActivityListeners();
    
    // Iniciar timer de inatividade
    this.resetInactivityTimer();
  }

  /**
   * Para o monitoramento de inatividade
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    console.log('[SessionTimeout] Stopping inactivity monitoring...');
    this.isActive = false;

    // Remover listeners de atividade
    this.unregisterActivityListeners();
    
    // Limpar timers
    this.clearTimers();
  }

  /**
   * Registra os listeners de atividade do usuário
   */
  private registerActivityListeners(): void {
    // Executar fora do Angular zone para melhor performance
    this.ngZone.runOutsideAngular(() => {
      this.ACTIVITY_EVENTS.forEach(event => {
        window.addEventListener(event, this.onUserActivity, true);
      });
    });
  }

  /**
   * Remove os listeners de atividade do usuário
   */
  private unregisterActivityListeners(): void {
    this.ACTIVITY_EVENTS.forEach(event => {
      window.removeEventListener(event, this.onUserActivity, true);
    });
  }

  /**
   * Callback chamado quando há atividade do usuário
   */
  private onUserActivity = (): void => {
    const agora = Date.now();
    this.lastActivity = agora;
    this.warningShown = false;
    if (agora - this.ultimoRegistro < this.INTERVALO_REGISTRO_MS) return;
    this.ultimoRegistro = agora;
    try { localStorage.setItem(this.ATIVIDADE_STORAGE_KEY, String(agora)); } catch { /* storage bloqueado */ }
    this.resetInactivityTimer();
  };

  // Última atividade em qualquer aba aberta do portal.
  private ultimaAtividadeGeral(): number {
    let outraAba = 0;
    try { outraAba = Number(localStorage.getItem(this.ATIVIDADE_STORAGE_KEY)) || 0; } catch { /* storage bloqueado */ }
    return Math.max(this.lastActivity, outraAba);
  }

  // Se outra aba teve atividade, reagenda os timers pro tempo que falta em vez de avisar/deslogar.
  private outraAbaAtiva(): boolean {
    const parado = Date.now() - this.ultimaAtividadeGeral();
    if (parado >= this.INACTIVITY_TIMEOUT - this.WARNING_TIME) return false;
    this.agendarTimers(this.INACTIVITY_TIMEOUT - parado);
    return true;
  }

  /**
   * Reseta o timer de inatividade
   */
  private resetInactivityTimer(): void {
    this.agendarTimers(this.INACTIVITY_TIMEOUT);
  }

  private agendarTimers(ateLogoutMs: number): void {
    this.clearTimers();

    // Timer para mostrar aviso antes de fazer logout
    this.warningTimer = window.setTimeout(() => {
      this.showInactivityWarning();
    }, Math.max(0, ateLogoutMs - this.WARNING_TIME));

    // Timer para fazer logout automático
    this.inactivityTimer = window.setTimeout(() => {
      this.handleInactivityTimeout();
    }, ateLogoutMs);
  }

  /**
   * Limpa todos os timers
   */
  private clearTimers(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = undefined;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = undefined;
    }
  }

  /**
   * Mostra aviso de inatividade
   */
  private showInactivityWarning(): void {
    if (this.warningShown || !this.isActive) {
      return;
    }
    if (this.outraAbaAtiva()) return;

    this.warningShown = true;
    
    // Executar dentro do Angular zone para atualizar a UI
    this.ngZone.run(() => {
      this.notificationService.showWarning(
        'Sua sessão irá expirar em 5 minutos devido à inatividade. ' +
        'Mova o mouse ou pressione qualquer tecla para continuar conectado.',
        10000 // Mostrar por 10 segundos
      );
      console.log('[SessionTimeout] Inactivity warning shown');
    });
  }

  /**
   * Trata o timeout de inatividade fazendo logout
   */
  private handleInactivityTimeout(): void {
    if (!this.isActive) {
      return;
    }
    // Checa de novo na hora: o aviso pode ter sido pulado e outra aba ter atividade recente.
    const parado = Date.now() - this.ultimaAtividadeGeral();
    if (parado < this.INACTIVITY_TIMEOUT) {
      this.agendarTimers(this.INACTIVITY_TIMEOUT - parado);
      return;
    }

    console.warn('[SessionTimeout] Inactivity timeout reached, logging out...');
    
    // Executar dentro do Angular zone para atualizar a UI
    this.ngZone.run(async () => {
      // Para o monitoramento
      this.stop();

      // Mostra mensagem
      this.notificationService.showError(
        'Sua sessão expirou devido à inatividade. Por favor, faça login novamente.'
      );

      // Faz logout
      let navigationTimeout: any;
      try {
        navigationTimeout = setTimeout(() => {
          this.router.navigateByUrl('/login', { replaceUrl: true });
        }, 8000); // Força navegação após 8s se travar
        await this.authService.logout();
        await this.router.navigateByUrl('/login', { replaceUrl: true });
      } catch (error) {
        console.error('[SessionTimeout] Error during logout:', error);
        // Força navegação mesmo com erro
        await this.router.navigateByUrl('/login', { replaceUrl: true });
      } finally {
        clearTimeout(navigationTimeout);
      }
    });
  }

  /**
   * Obtém o tempo desde a última atividade em milissegundos
   */
  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivity;
  }

  /**
   * Verifica se o serviço está ativo
   */
  isMonitoring(): boolean {
    return this.isActive;
  }
}
