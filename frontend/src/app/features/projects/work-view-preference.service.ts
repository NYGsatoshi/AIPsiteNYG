import { Injectable, inject } from '@angular/core';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';

export type MyTasksProjection = 'list' | 'kanban';

const preferenceVersion = 'v1';

/**
 * Browser-only presentation preference. It deliberately carries no task data
 * and has no server-side entity: the active tenant and authenticated user own
 * the key namespace.
 */
@Injectable({ providedIn: 'root' })
export class WorkViewPreferenceService {
  private readonly auth = inject(AuthSessionFacade);

  loadMyTasksProjection(): MyTasksProjection {
    const value = this.read('my-tasks');
    return value === 'kanban' ? 'kanban' : 'list';
  }

  saveMyTasksProjection(projection: MyTasksProjection): void {
    this.write('my-tasks', projection);
  }

  private read(screenId: string): string | null {
    try { return globalThis.localStorage?.getItem(this.key(screenId)) ?? null; } catch { return null; }
  }

  private write(screenId: string, value: string): void {
    try { globalThis.localStorage?.setItem(this.key(screenId), value); } catch { /* Browser privacy mode must not block task access. */ }
  }

  private key(screenId: string): string {
    const user = this.auth.currentUser();
    const tenant = this.auth.currentTenant();
    return `aipsite.work-view.${preferenceVersion}.${tenant?.tenantId ?? 'unresolved'}.${user?.userId ?? 'anonymous'}.${screenId}`;
  }
}
