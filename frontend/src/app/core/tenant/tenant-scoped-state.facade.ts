import { Injectable, signal } from '@angular/core';

export interface TenantScopedStateSnapshot {
  readonly activeProjectId: string | null;
  readonly activeConversationId: string | null;
  readonly activeFileId: string | null;
  readonly activeTaskId: string | null;
  readonly activeGridId: string | null;
  readonly rightPanelMembers: readonly string[];
  readonly notifications: readonly string[];
}

const EMPTY_TENANT_SCOPED_STATE: TenantScopedStateSnapshot = {
  activeProjectId: null,
  activeConversationId: null,
  activeFileId: null,
  activeTaskId: null,
  activeGridId: null,
  rightPanelMembers: [],
  notifications: []
};

@Injectable({ providedIn: 'root' })
export class TenantScopedStateFacade {
  private readonly tenantScopedState = signal<TenantScopedStateSnapshot>(EMPTY_TENANT_SCOPED_STATE);

  readonly state = this.tenantScopedState.asReadonly();

  clearTenantScopedState(): void {
    this.tenantScopedState.set(EMPTY_TENANT_SCOPED_STATE);
  }
}
