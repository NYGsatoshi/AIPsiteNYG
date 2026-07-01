import { InjectionToken, inject, Injectable, signal } from '@angular/core';

import { AppCapability } from '../../shared/navigation/navigation.models';

export type AuthSessionStatus = 'active' | 'expired';

export interface AuthSessionSnapshot {
  readonly status: AuthSessionStatus;
  readonly displayName: string;
  readonly supportingUsers: readonly string[];
  readonly capabilities: readonly AppCapability[];
}

export const DEFAULT_AUTH_SESSION: AuthSessionSnapshot = {
  status: 'active',
  displayName: '制作班メンバーA',
  supportingUsers: ['通知確認ユーザー', '検証 一号', '架空 二号'],
  capabilities: ['workspace:view', 'projects:view', 'files:view', 'account:view', 'audit:view']
};

export const AIP_AUTH_SESSION_MOCK = new InjectionToken<AuthSessionSnapshot>('AIP_AUTH_SESSION_MOCK');

@Injectable({ providedIn: 'root' })
export class AuthSessionFacade {
  private readonly initialSession = inject(AIP_AUTH_SESSION_MOCK, { optional: true }) ?? DEFAULT_AUTH_SESSION;
  private readonly sessionState = signal<AuthSessionSnapshot>(this.initialSession);

  readonly session = this.sessionState.asReadonly();

  expireSession(): void {
    this.sessionState.update((session) => ({ ...session, status: 'expired' }));
  }

  setMockSession(session: AuthSessionSnapshot): void {
    this.sessionState.set(session);
  }
}
