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
    this.lastActivity = Date.now();
    this.warningShown = false;
    this.resetInactivityTimer();
  };

  /**
   * Reseta o timer de inatividade
   */
  private resetInactivityTimer(): void {
    this.clearTimers();

    // Timer para mostrar aviso antes de fazer logout
    this.warningTimer = window.setTimeout(() => {
      this.showInactivityWarning();
    }, this.INACTIVITY_TIMEOUT - this.WARNING_TIME);

    // Timer para fazer logout automático
    this.inactivityTimer = window.setTimeout(() => {
      this.handleInactivityTimeout();
    }, this.INACTIVITY_TIMEOUT);
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
