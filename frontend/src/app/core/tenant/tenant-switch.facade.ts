import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';

import { AuthCurrentTenant, AuthSessionFacade } from '../auth/auth-session.facade';
import { CsrfTokenService } from '../auth/csrf-token.service';
import { ActiveWorkspaceFacade } from '../workspace/active-workspace.facade';
import { TenantScopedStateFacade } from './tenant-scoped-state.facade';

@Injectable({ providedIn: 'root' })
export class TenantSwitchFacade {
  private readonly httpBackend = inject(HttpBackend, { optional: true });
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly tenantScopedState = inject(TenantScopedStateFacade);
  private readonly csrfTokens = inject(CsrfTokenService);

  switchTenant(tenantId: string): Observable<AuthCurrentTenant | null> {
    this.clearTenantScopedState();

    const http = this.createBackendHttpClient();
    if (!http) {
      return of(null);
    }

    return http.post<AuthCurrentTenant>('/api/tenants/switch', { tenantId }, { withCredentials: true }).pipe(
      switchMap(() => this.refetchSessionShell()),
      catchError(() => of(null))
    );
  }

  clearTenantScopedState(): void {
    this.activeWorkspace.clearWorkspace();
    this.tenantScopedState.clearTenantScopedState();
    this.csrfTokens.clearToken();
  }

  refetchSessionShell(): Observable<AuthCurrentTenant | null> {
    return forkJoin({
      session: this.authSession.refreshSessionContext(),
      tenant: this.authSession.refreshCurrentTenant()
    }).pipe(map(({ tenant }) => tenant));
  }

  private createBackendHttpClient(): HttpClient | null {
    return this.httpBackend ? new HttpClient(this.httpBackend) : null;
  }
}
