import { Injectable, signal } from '@angular/core';

/**
 * A short-lived, typed handoff from an authorized notification open response
 * to the lazy My Tasks owner. It is not browser storage and is cleared on all
 * realtime authorization boundaries.
 */
@Injectable({ providedIn: 'root' })
export class NotificationOpenContextService {
  private readonly digestWorkspaceIdState = signal<string | null>(null);

  readonly digestWorkspaceId = this.digestWorkspaceIdState.asReadonly();

  setDigestWorkspace(workspaceId: string): void {
    this.digestWorkspaceIdState.set(workspaceId);
  }

  takeDigestWorkspace(): string | null {
    const workspaceId = this.digestWorkspaceIdState();
    this.digestWorkspaceIdState.set(null);
    return workspaceId;
  }

  clear(): void {
    this.digestWorkspaceIdState.set(null);
  }
}
