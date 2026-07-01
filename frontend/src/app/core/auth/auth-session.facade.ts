import { HttpBackend, HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, Observable, of, tap } from 'rxjs';

import { AppCapability } from '../../shared/navigation/navigation.models';
import { TenantScopedStateFacade } from '../tenant/tenant-scoped-state.facade';
import { ActiveWorkspaceFacade } from '../workspace/active-workspace.facade';
import { CsrfTokenService } from './csrf-token.service';

export type AuthSessionStatus = 'anonymous' | 'active' | 'expired';

export interface AuthCurrentUser {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly systemRole: string;
  readonly status: string;
}

export interface AuthCurrentTenant {
  readonly tenantId: string;
  readonly tenantSlug?: string | null;
  readonly isAvailable: boolean;
  readonly isPlatformScope: boolean;
  readonly displayName?: string | null;
  readonly status?: string | null;
  readonly currentUserRole?: string | null;
  readonly appMode?: string | number;
  readonly allowTenantSwitching: boolean;
}

export interface AuthNavigationState {
  readonly capabilities: readonly AppCapability[];
  readonly isLoaded: boolean;
}

export interface AuthSessionSnapshot {
  readonly status: AuthSessionStatus;
  readonly currentUser: AuthCurrentUser | null;
  readonly currentTenant: AuthCurrentTenant | null;
  readonly isAuthenticated: boolean;
  readonly displayName: string;
  readonly supportingUsers: readonly string[];
  readonly capabilities: readonly AppCapability[];
  readonly navigation: AuthNavigationState;
}

export const DEFAULT_AUTH_SESSION: AuthSessionSnapshot = {
  status: 'active',
  currentUser: {
    userId: 'mock-user-a',
    displayName: 'Mock User A',
    email: 'mock-user-a@example.invalid',
    systemRole: 'TenantUser',
    status: 'Active'
  },
  currentTenant: {
    tenantId: 'mock-tenant',
    tenantSlug: 'mock',
    isAvailable: true,
    isPlatformScope: false,
    displayName: 'Mock Tenant',
    status: 'Active',
    currentUserRole: 'Admin',
    appMode: 'OnPremSingleTenant',
    allowTenantSwitching: true
  },
  isAuthenticated: true,
  displayName: 'Mock User A',
  supportingUsers: ['Support User', 'Review User', 'Operations User'],
  capabilities: ['workspace:view', 'projects:view', 'files:view', 'account:view', 'audit:view'],
  navigation: {
    capabilities: ['workspace:view', 'projects:view', 'files:view', 'account:view', 'audit:view'],
    isLoaded: true
  }
};

export const AIP_AUTH_SESSION_MOCK = new InjectionToken<AuthSessionSnapshot>('AIP_AUTH_SESSION_MOCK');

interface AuthStatusResponse {
  readonly isAuthenticated?: boolean;
  readonly user?: AuthCurrentUser;
}

@Injectable({ providedIn: 'root' })
export class AuthSessionFacade {
  private readonly initialSession = inject(AIP_AUTH_SESSION_MOCK, { optional: true }) ?? DEFAULT_AUTH_SESSION;
  private readonly httpBackend = inject(HttpBackend, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly csrfTokens = inject(CsrfTokenService);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly tenantScopedState = inject(TenantScopedStateFacade);
  private readonly sessionState = signal<AuthSessionSnapshot>(this.initialSession);

  readonly session = this.sessionState.asReadonly();
  readonly currentUser = computed(() => this.sessionState().currentUser);
  readonly currentTenant = computed(() => this.sessionState().currentTenant);
  readonly isAuthenticated = computed(() => this.sessionState().isAuthenticated);
  readonly navigation = computed(() => this.sessionState().navigation);

  clearSessionState(status: AuthSessionStatus = 'anonymous'): void {
    this.sessionState.set(createSessionSnapshot(null, null, status, []));
    this.activeWorkspace.clearWorkspace();
    this.tenantScopedState.clearTenantScopedState();
    this.csrfTokens.clearToken();
  }

  handleTerminal401(): void {
    this.clearSessionState('expired');
    void this.router?.navigateByUrl('/session-expired');
  }

  markSessionExpired(): void {
    this.clearSessionState('expired');
  }

  logoutLocally(): void {
    this.clearSessionState('anonymous');
  }

  refreshCurrentUser(): Observable<AuthSessionSnapshot | null> {
    const http = this.createBackendHttpClient();
    if (!http) {
      return of(null);
    }

    return http.get<AuthCurrentUser>('/api/auth/me', { withCredentials: true }).pipe(
      tap((user) => this.patchUser(user)),
      map(() => this.sessionState()),
      catchError(() => of(null))
    );
  }

  refreshSessionContext(): Observable<AuthSessionSnapshot | null> {
    const http = this.createBackendHttpClient();
    if (!http) {
      return of(null);
    }

    return http.get<AuthStatusResponse>('/api/auth/status', { withCredentials: true }).pipe(
      tap((status) => {
        if (status.isAuthenticated && status.user) {
          this.patchUser(status.user);
          return;
        }

        this.clearSessionState('anonymous');
      }),
      map(() => this.sessionState()),
      catchError(() => of(null))
    );
  }

  refreshCurrentTenant(): Observable<AuthCurrentTenant | null> {
    const http = this.createBackendHttpClient();
    if (!http) {
      return of(null);
    }

    return http.get<AuthCurrentTenant>('/api/tenants/current', { withCredentials: true }).pipe(
      tap((tenant) => this.patchTenant(tenant)),
      catchError(() => of(null))
    );
  }

  csrfCacheKey(): string {
    const tenant = this.sessionState().currentTenant;
    return tenant?.tenantId ?? tenant?.tenantSlug ?? 'tenant-unresolved';
  }

  setMockSession(session: AuthSessionSnapshot): void {
    this.sessionState.set(session);
  }

  private patchUser(user: AuthCurrentUser): void {
    this.sessionState.update((session) =>
      createSessionSnapshot(user, session.currentTenant, 'active', session.capabilities)
    );
  }

  private patchTenant(tenant: AuthCurrentTenant): void {
    this.sessionState.update((session) =>
      createSessionSnapshot(session.currentUser, tenant, session.currentUser ? 'active' : 'anonymous', session.capabilities)
    );
  }

  private createBackendHttpClient(): HttpClient | null {
    return this.httpBackend ? new HttpClient(this.httpBackend) : null;
  }
}

function createSessionSnapshot(
  user: AuthCurrentUser | null,
  tenant: AuthCurrentTenant | null,
  status: AuthSessionStatus,
  capabilities: readonly AppCapability[]
): AuthSessionSnapshot {
  return {
    status,
    currentUser: user,
    currentTenant: tenant,
    isAuthenticated: status === 'active' && user !== null,
    displayName: user?.displayName ?? '',
    supportingUsers: [],
    capabilities,
    navigation: {
      capabilities,
      isLoaded: capabilities.length > 0
    }
  };
}
