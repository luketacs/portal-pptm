import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
} from '@angular/router';
import { AuthLogicService } from './auth.logic.service';

/**
 * A modern, functional route guard that delegates its logic to a dedicated service.
 * This pattern acts as a thin, clean adapter between the Angular Router and the
 * authentication logic. It resolves complex dependency injection issues by ensuring
 * that services with their own dependencies (like the Router) are instantiated in a
 * standard service context, not directly within the guard's execution path.
 */
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot
) => {
  const logicService = inject(AuthLogicService);
  // The Router is no longer injected here. The logic service will get it lazily.
  return logicService.checkAuth(route);
};
