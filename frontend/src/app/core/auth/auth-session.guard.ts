import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthSessionFacade } from './auth-session.facade';

export const authSessionGuard: CanActivateFn = () => {
  const authSession = inject(AuthSessionFacade);
  const router = inject(Router);

  return authSession.bootstrap().pipe(
    map((session) => (session.isAuthenticated ? true : router.createUrlTree(['/login']))),
    catchError(() => {
      authSession.clearSessionState('anonymous');
      return of(router.createUrlTree(['/login']));
    })
  );
};
