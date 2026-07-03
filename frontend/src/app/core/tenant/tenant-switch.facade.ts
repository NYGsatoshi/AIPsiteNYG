import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';

import { AuthCurrentTenant, AuthSessionFacade } from '../auth/auth-session.facade';
import { CsrfTokenService } from '../auth/csrf-token.service';
import { ActiveWorkspaceFacade } from '../workspace/active-workspace.facade';
import { RightPanelFacade } from '../../shared/right-panel/right-panel.facade';
import { TenantScopedStateFacade } from './tenant-scoped-state.facade';

@Injectable({ providedIn: 'root' })
export class TenantSwitchFacade {
  private readonly http = inject(HttpClient);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly rightPanel = inject(RightPanelFacade);
  private readonly tenantScopedState = inject(TenantScopedStateFacade);
  private readonly csrfTokens = inject(CsrfTokenService);

  switchTenant(tenantId: string): Observable<AuthCurrentTenant | null> {
    this.clearTenantScopedState();

    return this.http.post<unknown>('/api/tenants/switch', { tenantId }).pipe(
      switchMap(() => this.refetchSessionShell()),
      catchError(() => of(null))
    );
  }

  clearTenantScopedState(): void {
    this.activeWorkspace.clearWorkspace();
    this.rightPanel.clearPanelState();
    this.tenantScopedState.clearTenantScopedState();
    this.csrfTokens.clearToken();
  }

  refetchSessionShell(): Observable<AuthCurrentTenant | null> {
    return forkJoin({
      session: this.authSession.refreshSessionContext(),
      tenant: this.authSession.refreshCurrentTenant()
    }).pipe(map(({ tenant }) => tenant));
  }
}
