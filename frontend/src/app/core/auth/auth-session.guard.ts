import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthSessionFacade } from './auth-session.facade';

export const authSessionGuard: CanActivateFn = () => {
  const authSession = inject(AuthSessionFacade);
  const router = inject(Router);

  return authSession.validateServerSession().pipe(
    map((session) => session.isAuthenticated || router.parseUrl('/login')),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 403) {
        authSession.clearSessionState('anonymous');
        return of(router.parseUrl('/permission-denied'));
      }

      authSession.clearSessionState('anonymous');
      return of(router.parseUrl('/login'));
    })
  );
};
