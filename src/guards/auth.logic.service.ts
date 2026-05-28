import { Injectable, Injector } from '@angular/core';
import { Router, ActivatedRouteSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * This service encapsulates the core logic for the authentication guard.
 * By placing dependencies like Router and AuthService here, we leverage Angular's
 * standard, robust constructor injection, avoiding complex DI scenarios
 * within the functional guard itself. This resolves stubborn circular dependency
 * issues that can arise during the router's initialization phase.
 */
@Injectable({ providedIn: 'root' })
export class AuthLogicService {
  // We inject the Injector service to lazily get the Router later.
  constructor(private authService: AuthService, private injector: Injector) {}

  // The router is no longer passed in as an argument.
  async checkAuth(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    // Durante logout, sempre forar tela de login e bloquear redirecionamentos por role
    if (this.authService.isLoggingOut()) {
      const router = this.injector.get(Router);
      return router.createUrlTree(['/login']);
    }

    //  CORREO CRTICA: Aguardar inicializao completa antes de verificar usuário
    // Previne tela branca e logout involuntrio ao dar F5
    let maxWaitTime = 5000; // 5 segundos mximo
    const startTime = Date.now();
    
    while (this.authService.isInitializing() && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    if (this.authService.isInitializing()) {
      console.warn('[AuthGuard] Initialization timeout, proceeding with current state');
    }

    const currentUser = this.authService.currentUser();

    if (!currentUser) {
      // If no user and initialization is complete, redirect to login.
      const router = this.injector.get(Router);
      return router.createUrlTree(['/login']);
    }

    // Se o usuário precisa trocar a senha, redirecionar para a tela de troca
    if (currentUser.must_change_password) {
      const targetPath = route.routeConfig?.path;
      if (targetPath !== 'change-password-required') {
        const router = this.injector.get(Router);
        return router.createUrlTree(['/change-password-required']);
      }
      return true;
    }

    // Validar que o role  um dos valores esperados
    const validRoles = ['Admin', 'Solicitante', 'Visualizador'];
    if (!currentUser.role || !validRoles.includes(currentUser.role)) {
      console.warn('[AuthGuard] Invalid or missing user role:', currentUser.role);
      await Promise.resolve();
      const router = this.injector.get(Router);
      return router.createUrlTree(['/requests']);
    }

    const requiredRoles = route.data['roles'] as string[] | undefined;
    if (requiredRoles && requiredRoles.length > 0) {
      // Check if the user has a role and if it's one of the required roles.
      if (!requiredRoles.includes(currentUser.role)) {
        console.warn('[AuthGuard] User role', currentUser.role, 'not in required roles:', requiredRoles);
        // By making this async and pushing the injector call to a microtask,
        // we ensure the Router has finished its synchronous initialization
        // before we attempt to retrieve it. This breaks the dependency cycle.
        await Promise.resolve();
        const router: Router = this.injector.get(Router);
        
        //  CORREO: Redirecionar baseado no role para evitar loop infinito
        if (currentUser.role === 'Visualizador') {
          return router.createUrlTree(['/dashboard']);
        } else if (currentUser.role === 'Solicitante') {
          return router.createUrlTree(['/requests/new']);
        }
        
        // Fallback seguro
        return router.createUrlTree(['/requests']);
      }
    }

    // If all checks pass, allow navigation.
    return true;
  }
}



