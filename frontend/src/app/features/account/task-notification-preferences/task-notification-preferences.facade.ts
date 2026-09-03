import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { effect, inject, Injectable, signal } from '@angular/core';

import { AuthSessionFacade } from '../../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';

export type TaskNotificationPreferenceStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error' | 'permissionDenied';

export interface TaskNotificationPreferenceViewModel {
  readonly status: TaskNotificationPreferenceStatus;
  readonly workspaceId: string | null;
  readonly storedDeadlineDigestLocalTime: string | null;
  readonly effectiveDeadlineDigestLocalTime: string | null;
  readonly workspaceTimeZoneId: string | null;
  readonly version: number | null;
  readonly message: string | null;
}

interface PreferenceDto {
  readonly deadlineDigestLocalTime?: unknown;
  readonly effectiveDeadlineDigestLocalTime?: unknown;
  readonly workspaceTimeZoneId?: unknown;
  readonly version?: unknown;
}

/**
 * Server-authoritative preference state for the current Workspace. It has no
 * browser timezone or storage fallback: null means inherit exactly as the API
 * defines it, and every write carries the returned optimistic version.
 */
@Injectable({ providedIn: 'root' })
export class TaskNotificationPreferencesFacade {
  private readonly http = inject(HttpClient);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly realtime = inject(RealtimeFacade);
  private readonly state = signal<TaskNotificationPreferenceViewModel>(this.empty());
  private requestGeneration = 0;
  private observedTenantId: string | null = null;

  readonly viewModel = this.state.asReadonly();

  constructor() {
    this.realtime.registerProtectedStateClearer?.('task-notification-preferences', () => this.clear());
    effect(() => {
      const workspaceId = this.activeWorkspace.activeWorkspace()?.id ?? null;
      const tenant = this.authSession.currentTenant();
      if (!this.authSession.isAuthenticated() || !tenant?.isAvailable || !workspaceId) {
        this.observedTenantId = null;
        this.clear();
        return;
      }

      const tenantChanged = this.observedTenantId !== tenant.tenantId;
      if (tenantChanged) {
        // Workspace IDs and active-view state are never carried across a
        // Tenant boundary, even briefly while the new HTTP projection loads.
        this.clear();
        this.observedTenantId = tenant.tenantId;
      }

      if (tenantChanged || this.state().workspaceId !== workspaceId || this.state().status === 'idle') {
        this.load(workspaceId);
      }
    });
  }

  refresh(): void {
    const workspaceId = this.activeWorkspace.activeWorkspace()?.id ?? this.state().workspaceId;
    if (workspaceId) {this.load(workspaceId);}
  }

  save(deadlineDigestLocalTime: string | null): void {
    const current = this.state();
    if (!current.workspaceId || !current.version || current.status === 'saving') {return;}
    if (deadlineDigestLocalTime !== null && !isQuarterHour(deadlineDigestLocalTime)) {
      this.state.set({ ...current, status: 'error', message: 'Choose a 15-minute time between 00:00 and 23:45.' });
      return;
    }

    const generation = ++this.requestGeneration;
    this.state.set({ ...current, status: 'saving', message: null });
    this.http.patch<PreferenceDto>(
      `/api/me/workspaces/${current.workspaceId}/task-notification-preferences`,
      { deadlineDigestLocalTime, expectedVersion: current.version },
      { withCredentials: true },
    ).subscribe({
      next: (response) => {
        if (generation !== this.requestGeneration) {return;}
        this.state.set(this.fromResponse(current.workspaceId!, response));
      },
      error: (error: unknown) => {
        if (generation !== this.requestGeneration) {return;}
        if (error instanceof HttpErrorResponse && error.status === 409) {
          // A conflict is resolved only from an authoritative GET; no local
          // rounding, merge, or storage cache is treated as the source.
          this.load(current.workspaceId!, 'This preference changed elsewhere. The server value was reloaded.');
          return;
        }
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403 || error.status === 404)) {
          this.clear();
          this.state.set({ ...this.empty(), status: 'permissionDenied', message: 'This Workspace preference is no longer available.' });
          return;
        }
        this.state.set({ ...current, status: 'error', message: 'The preference could not be saved. Try again.' });
      },
    });
  }

  clear(): void {
    this.requestGeneration++;
    this.state.set(this.empty());
  }

  private load(workspaceId: string, successMessage: string | null = null): void {
    const generation = ++this.requestGeneration;
    this.state.set({ ...this.state(), workspaceId, status: 'loading', message: null });
    this.http.get<PreferenceDto>(
      `/api/me/workspaces/${workspaceId}/task-notification-preferences`,
      { withCredentials: true },
    ).subscribe({
      next: (response) => {
        if (generation !== this.requestGeneration) {return;}
        this.state.set({ ...this.fromResponse(workspaceId, response), message: successMessage });
      },
      error: (error: unknown) => {
        if (generation !== this.requestGeneration) {return;}
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403 || error.status === 404)) {
          this.state.set({ ...this.empty(), status: 'permissionDenied', message: 'This Workspace preference is no longer available.' });
          return;
        }
        this.state.set({ ...this.empty(), workspaceId, status: 'error', message: 'The preference could not be loaded. Try again.' });
      },
    });
  }

  private fromResponse(workspaceId: string, response: PreferenceDto): TaskNotificationPreferenceViewModel {
    const stored = nullableQuarterHour(response.deadlineDigestLocalTime);
    const effective = quarterHour(response.effectiveDeadlineDigestLocalTime);
    const timeZone = stringValue(response.workspaceTimeZoneId);
    const version = positiveInteger(response.version);
    if (!effective || !timeZone || !version) {
      return { ...this.empty(), workspaceId, status: 'error', message: 'The preference response was incomplete.' };
    }
    return {
      status: 'ready',
      workspaceId,
      storedDeadlineDigestLocalTime: stored,
      effectiveDeadlineDigestLocalTime: effective,
      workspaceTimeZoneId: timeZone,
      version,
      message: null,
    };
  }

  private empty(): TaskNotificationPreferenceViewModel {
    return {
      status: 'idle',
      workspaceId: null,
      storedDeadlineDigestLocalTime: null,
      effectiveDeadlineDigestLocalTime: null,
      workspaceTimeZoneId: null,
      version: null,
      message: null,
    };
  }
}

export function taskNotificationPreferenceTimeOptions(): readonly string[] {
  return Array.from({ length: 96 }, (_, index) => {
    const hours = String(Math.floor(index / 4)).padStart(2, '0');
    const minutes = String((index % 4) * 15).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
}

export function isQuarterHour(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/u.test(value);
}

function nullableQuarterHour(value: unknown): string | null {
  return value === null || value === undefined ? null : quarterHour(value);
}

function quarterHour(value: unknown): string | null {
  return typeof value === 'string' && isQuarterHour(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
