import { ChangeDetectionStrategy, Component, computed, effect, OnDestroy, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { HeaderComponent } from '../components/header/header.component';
import { SidebarComponent } from '../components/sidebar/sidebar.component';
import { NotificationComponent } from '../components/notification/notification.component';
import { RequestService } from '../services/request.service';
import { UserService } from '../services/user.service';
import { NotificationService } from '../services/notification.service';
import { SessionTimeoutService } from '../services/session-timeout.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet, 
    HeaderComponent, 
    SidebarComponent, 
    NotificationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnDestroy {
  currentUser;
  isInitializing; // Will be linked to authService.isInitializing
  private sessionCheckInterval?: number;
  private routerSubscription?: Subscription;
  currentUrl = signal('/');
  isPublicAuthRoute;
  shouldShowAuthTransition;

  constructor(
    public authService: AuthService,
    private requestService: RequestService,
    private userService: UserService,
    private notificationService: NotificationService,
    private sessionTimeoutService: SessionTimeoutService,
    private router: Router
  ) {
    this.currentUser = this.authService.currentUser;
    this.isInitializing = this.authService.isInitializing;
    this.currentUrl.set(this.router.url || '/');

    this.routerSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.currentUrl.set(event.urlAfterRedirects || event.url);
      }
    });

    this.isPublicAuthRoute = computed(() => {
      const url = this.currentUrl();
      return url.startsWith('/login') || url.startsWith('/forgot-password') || url.startsWith('/reset-password') || url.startsWith('/privacy-policy') || url.startsWith('/change-password-required');
    });

    this.shouldShowAuthTransition = computed(() => {
      const user = this.currentUser();
      const isPublicRoute = this.isPublicAuthRoute();

      // Em rotas públicas (login/recuperação), nunca bloquear a UI com overlay global.
      // O próprio componente de login controla seu spinner local.
      if (isPublicRoute) {
        return this.isInitializing();
      }

      return this.isInitializing()
        || this.authService.isLoggingOut()
        || this.authService.isAuthenticating()
        || !user;
    });

    // Start auth initialization immediately but don't block the UI
    this.authService.initializeApp().then(() => {
      console.log('[AppComponent] Auth initialization complete');
    }).catch((err) => {
      console.error('[AppComponent] Auth initialization error:', err);
    });

    effect(() => {
      const user = this.currentUser();
      const isAuthRoute = this.isPublicAuthRoute();
      const stillInitializing = this.isInitializing();

      // Proteção extra: se não está inicializando, não tem usuário e não está em rota pública, força navegação e reseta loading
      if (!stillInitializing && !user && !isAuthRoute) {
        // Resetar possíveis loading travados
        try {
          this.authService.isLoggingOut.set(false);
          this.authService.isAuthenticating.set(false);
        } catch {}
        this.router.navigateByUrl('/login', { replaceUrl: true });
      }
    });

    // Verificação periódica de sessão a cada 5 minutos
    this.sessionCheckInterval = window.setInterval(async () => {
      const user = this.currentUser();
      if (user) {
        const isValid = await this.authService.checkSession();
        if (!isValid) {
          console.warn('[AppComponent] Session expired, logging out');
          this.notificationService.showError('Sua sessão expirou. Por favor, faça login novamente.');
          await this.authService.logout();
          await this.router.navigateByUrl('/login', { replaceUrl: true });
        }
      }
    }, 5 * 60 * 1000); // 5 minutos

    // Reactively load data when the user logs in.
    // This effect runs whenever the currentUser signal changes.
    let lastUserId: string | null = null;
    effect(() => {
      const user = this.currentUser();
      
      // Só carrega se o usuário mudou (evita recargas desnecessárias)
      if (user && user.id !== lastUserId) {
        lastUserId = user.id;
        console.log('[AppComponent] User logged in, loading data...');
          
        // Iniciar monitoramento de timeout de sessão
        this.sessionTimeoutService.start();
        console.log('[AppComponent] Session timeout monitoring started');
          
          // User is logged in, load the necessary data for the app.
          // Use timeout to prevent indefinite waiting
          Promise.all([
          Promise.race([
            this.requestService.loadRequests(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 8000))
          ]).catch((err) => {
            console.warn('[AppComponent] Failed to load requests:', err);
            this.notificationService.showError('Erro ao carregar solicitações. Recarregue a página.');
          }),
          Promise.race([
            this.userService.loadUsers(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Users timeout')), 8000))
          ]).catch((err) => {
            console.warn('[AppComponent] Failed to load users:', err);
            // Don't show error for users - it's optional
          })
        ]).catch((err) => {
          console.error('[AppComponent] Error loading data:', err);
        });
      } else if (!user) {
        // User logged out: clear cached data to prevent stale state
        lastUserId = null;
        this.requestService.clearRequests();
        this.userService.clearUsers();
        
        // Parar monitoramento de timeout de sessão
        this.sessionTimeoutService.stop();
        console.log('[AppComponent] Session timeout monitoring stopped');
      }
    });
  }

  ngOnDestroy() {
    // Limpar intervalo de verificação de sessão
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = undefined;
    }
    
    // Parar monitoramento de timeout de sessão
    this.sessionTimeoutService.stop();

    this.routerSubscription?.unsubscribe();
  }
}
