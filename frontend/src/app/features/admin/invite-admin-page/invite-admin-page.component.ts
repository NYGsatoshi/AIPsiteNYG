import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, switchMap } from 'rxjs';

import { CsrfTokenService } from '../../../core/auth/csrf-token.service';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';

type InvitePageStatus = 'loading' | 'ready' | 'empty' | 'permissionDenied' | 'error';
type WorkspaceRole = 'Owner' | 'Admin' | 'Adviser' | 'Member' | 'ReadOnly';

interface WorkspaceDto {
  readonly id?: unknown;
  readonly name?: unknown;
}

interface InviteDto {
  readonly id?: unknown;
  readonly workspaceId?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly expiresAt?: unknown;
  readonly acceptedAt?: unknown;
  readonly revokedAt?: unknown;
  readonly createdAt?: unknown;
}

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface WorkspaceOption {
  readonly id: string;
  readonly name: string;
}

interface InviteRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: string;
}

@Component({
  selector: 'app-invite-admin-page',
  standalone: true,
  imports: [FormsModule, AppEmptyStateComponent, AppInlineLoadingComponent, AppPermissionDeniedComponent],
  templateUrl: './invite-admin-page.component.html',
  styleUrl: './invite-admin-page.component.scss'
})
export class InviteAdminPageComponent {
  private readonly http = inject(HttpClient);
  private readonly csrfTokens = inject(CsrfTokenService);

  readonly status = signal<InvitePageStatus>('loading');
  readonly message = signal<string | null>(null);
  readonly workspaces = signal<readonly WorkspaceOption[]>([]);
  readonly invites = signal<readonly InviteRow[]>([]);
  readonly selectedWorkspaceId = signal('');
  readonly email = signal('');
  readonly role = signal<WorkspaceRole>('Member');
  readonly expiresAt = signal('');
  readonly submitting = signal(false);
  readonly createdNotice = signal<string | null>(null);

  readonly canSubmit = computed(
    () =>
      !this.submitting() &&
      this.selectedWorkspaceId().length > 0 &&
      this.email().trim().length > 0 &&
      this.role().length > 0
  );

  readonly roleOptions: readonly WorkspaceRole[] = ['Member', 'ReadOnly', 'Adviser', 'Admin', 'Owner'];

  constructor() {
    this.load();
  }

  load(): void {
    this.status.set('loading');
    this.message.set(null);
    this.http.get<readonly WorkspaceDto[]>('/api/workspaces', { withCredentials: true }).subscribe({
      next: (response) => {
        const workspaces = response.map(toWorkspaceOption).filter((workspace) => workspace.id.length > 0);
        this.workspaces.set(workspaces);
        this.selectedWorkspaceId.set(workspaces[0]?.id ?? '');
        this.status.set(workspaces.length > 0 ? 'ready' : 'empty');
        this.loadInvites();
      },
      error: (error: { status?: number }) => {
        this.status.set(error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error');
        this.message.set(
          error.status === 401 || error.status === 403
            ? 'Admin access is required.'
            : 'Workspace API request failed.'
        );
      }
    });
  }

  createInvite(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.createdNotice.set(null);
    const body = {
      workspaceId: this.selectedWorkspaceId(),
      email: this.email().trim(),
      role: this.role(),
      expiresAt: this.toExpiresAtIso()
    };

    this.csrfTokens
      .ensureToken('admin-invites')
      .pipe(
        switchMap((csrfToken) =>
          this.http.post<InviteDto>('/api/admin/invites', body, {
            withCredentials: true,
            headers: {
              [csrfToken.headerName]: csrfToken.token
            }
          })
        ),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (invite) => {
          this.email.set('');
          this.createdNotice.set(`${stringValue(invite.email) || body.email} was created. Invite token delivery is not implemented in this UI.`);
          this.loadInvites();
        },
        error: (error: { status?: number; error?: { error?: string } }) => {
          this.message.set(error.error?.error ?? 'Invite creation failed.');
          if (error.status === 401 || error.status === 403) {
            this.status.set('permissionDenied');
          }
        }
      });
  }

  private loadInvites(): void {
    this.http
      .get<PagedResponseDto<InviteDto>>('/api/admin/invites', { withCredentials: true })
      .subscribe({
        next: (response) => this.invites.set((response.items ?? []).map(toInviteRow)),
        error: (error: { status?: number }) => {
          if (error.status === 401 || error.status === 403) {
            this.status.set('permissionDenied');
            this.message.set('Admin access is required.');
          }
        }
      });
  }

  private toExpiresAtIso(): string | null {
    const value = this.expiresAt();
    return value.length > 0 ? new Date(value).toISOString() : null;
  }
}

function toWorkspaceOption(workspace: WorkspaceDto): WorkspaceOption {
  const id = stringValue(workspace.id);
  return {
    id,
    name: stringValue(workspace.name) || id
  };
}

function toInviteRow(invite: InviteDto): InviteRow {
  const acceptedAt = stringValue(invite.acceptedAt);
  const revokedAt = stringValue(invite.revokedAt);
  return {
    id: stringValue(invite.id),
    workspaceId: stringValue(invite.workspaceId),
    email: stringValue(invite.email),
    role: stringValue(invite.role),
    status: revokedAt ? 'Revoked' : acceptedAt ? 'Accepted' : 'Pending',
    expiresAt: formatDate(invite.expiresAt)
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}
