import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import {
  WORKSPACE_MEMBERS_DEFAULT_PAGE_SIZE,
  WORKSPACE_MEMBERS_MAXIMUM_PAGE_SIZE,
  WorkspaceMemberActionId,
  WorkspaceMemberAccountStatusLabel,
  WorkspaceMemberGridRow,
  WorkspaceMemberMockRecord,
  WorkspaceMemberRowAction,
  WorkspaceMembersScenario,
  WorkspaceMembersViewModel,
} from './members.types';

export const AIP_WORKSPACE_MEMBERS_MOCK = new InjectionToken<WorkspaceMembersScenario>(
  'AIP_WORKSPACE_MEMBERS_MOCK',
);

interface WorkspaceMemberDto {
  readonly userId?: unknown;
  readonly displayName?: unknown;
  readonly role?: unknown;
  readonly status?: unknown;
  readonly joinedAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class WorkspaceMembersFacade {
  private readonly http = inject(HttpClient);
  private readonly scenario = inject(AIP_WORKSPACE_MEMBERS_MOCK, { optional: true });
  private readonly livePages = signal<Record<string, WorkspaceMembersViewModel>>({});

  getPage(workspaceId: string): WorkspaceMembersViewModel {
    if (!this.scenario) {
      const page = this.livePages()[workspaceId];
      if (page) {
        return page;
      }

      this.loadMembers(workspaceId);
      return this.emptyPage(workspaceId, 'loading');
    }

    const authorizedRows = this.scenario.members
      .filter((member) => member.workspaceId === workspaceId)
      .map((member) => this.toGridRow(member));

    return {
      status: this.scenario.status,
      workspaceId,
      title: this.scenario.title,
      subtitle: this.scenario.subtitle,
      rows: authorizedRows,
      columns: [],
      pageSize: {
        defaultPageSize: WORKSPACE_MEMBERS_DEFAULT_PAGE_SIZE,
        maximumPageSize: WORKSPACE_MEMBERS_MAXIMUM_PAGE_SIZE,
      },
      queryOwnership: {
        loadedRowsOwner: 'backendAuthorization',
        clientSearchOwner: 'alreadyLoadedAuthorizedRowsOnly',
        futureSortOwner: 'backendWhenLive',
        futureFilterOwner: 'backendWhenLive',
      },
      message: this.scenario.message,
    };
  }

  reload(workspaceId: string): void {
    this.loadMembers(workspaceId, true);
  }

  private loadMembers(workspaceId: string, force = false): void {
    if (!force && this.livePages()[workspaceId]?.status === 'loading') {
      return;
    }

    this.setLivePage(workspaceId, this.emptyPage(workspaceId, 'loading'));
    this.http
      .get<
        readonly WorkspaceMemberDto[]
      >(`/api/workspaces/${workspaceId}/members`, { withCredentials: true })
      .subscribe({
        next: (members) => {
          const rows = members.map((member) =>
            this.toGridRow(this.toMockRecord(member, workspaceId)),
          );
          this.setLivePage(workspaceId, {
            ...this.emptyPage(workspaceId, rows.length === 0 ? 'empty' : 'ready'),
            rows,
            message: rows.length === 0 ? 'No members were returned by the API.' : undefined,
          });
        },
        error: (error: { status?: number }) => {
          this.setLivePage(workspaceId, {
            ...this.emptyPage(
              error.status === 401 || error.status === 403 ? workspaceId : workspaceId,
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'error',
            ),
            message:
              error.status === 401 || error.status === 403
                ? 'Authentication or member permission is required.'
                : 'Workspace member API request failed.',
          });
        },
      });
  }

  private setLivePage(workspaceId: string, page: WorkspaceMembersViewModel): void {
    this.livePages.update((pages) => ({ ...pages, [workspaceId]: page }));
  }

  private emptyPage(
    workspaceId: string,
    status: WorkspaceMembersViewModel['status'],
  ): WorkspaceMembersViewModel {
    return {
      status,
      workspaceId,
      title: 'Workspace members',
      subtitle: 'Live API data',
      rows: [],
      columns: [],
      pageSize: {
        defaultPageSize: WORKSPACE_MEMBERS_DEFAULT_PAGE_SIZE,
        maximumPageSize: WORKSPACE_MEMBERS_MAXIMUM_PAGE_SIZE,
      },
      queryOwnership: {
        loadedRowsOwner: 'backendAuthorization',
        clientSearchOwner: 'alreadyLoadedAuthorizedRowsOnly',
        futureSortOwner: 'backendWhenLive',
        futureFilterOwner: 'backendWhenLive',
      },
    };
  }

  private toGridRow(member: WorkspaceMemberMockRecord): WorkspaceMemberGridRow {
    return {
      id: member.id,
      workspaceId: member.workspaceId,
      displayName: member.displayName,
      role: member.role,
      roleLabel: member.roleLabel,
      groupProjectLabel: member.groupProjectLabel,
      accountStatus: member.accountStatus,
      accountStatusLabel: member.accountStatusLabel,
      joinedAtLabel: member.joinedAtLabel,
      rowActions: this.buildActions(member),
    };
  }

  private buildActions(member: WorkspaceMemberMockRecord): readonly WorkspaceMemberRowAction[] {
    const actions: WorkspaceMemberRowAction[] = [];

    if (member.capabilities.includes('openMemberDetail')) {
      actions.push({
        id: 'openMemberDetail',
        label: '詳細',
        destructive: false,
        disabled: !member.mockDetailSupported,
        disabledReason: member.mockDetailSupported ? undefined : '削除済み',
      });
    }

    if (member.capabilities.includes('changeRole') && member.accountStatus !== 'removed') {
      actions.push({
        id: 'changeRole',
        label: '権限変更',
        destructive: false,
        disabled: false,
      });
    }

    if (member.capabilities.includes('disableMember') && member.accountStatus !== 'removed') {
      actions.push({
        id: 'disableMember',
        label: member.accountStatus === 'disabled' ? '解除確認' : '利用停止',
        destructive: true,
        disabled: false,
      });
    }

    return actions.filter((action) => action.id === 'openMemberDetail') satisfies readonly WorkspaceMemberRowAction[];
  }

  private toMockRecord(member: WorkspaceMemberDto, workspaceId: string): WorkspaceMemberMockRecord {
    const accountStatus = memberStatus(member.status);
    const role = memberRole(member.role);

    return {
      id: stringValue(member.userId) ?? '',
      workspaceId,
      displayName: stringValue(member.displayName) ?? 'Member',
      role,
      roleLabel: role,
      groupProjectLabel: 'Workspace',
      accountStatus,
      accountStatusLabel: accountStatusLabel(accountStatus),
      joinedAtLabel: formatDate(member.joinedAt),
      capabilities: ['openMemberDetail'],
      mockDetailSupported: false,
    };
  }

  isDestructiveAction(actionId: string): actionId is WorkspaceMemberActionId {
    return actionId === 'disableMember';
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleDateString() : '';
}

function memberRole(value: unknown): WorkspaceMemberGridRow['role'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === '0' || normalized === 'owner') {
    return 'owner';
  }
  if (
    normalized === '1' ||
    normalized === 'admin' ||
    normalized === '2' ||
    normalized === 'adviser'
  ) {
    return 'teacher';
  }
  if (normalized === '4' || normalized === 'readonly') {
    return 'viewer';
  }
  return 'member';
}

function memberStatus(value: unknown): WorkspaceMemberGridRow['accountStatus'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === '2' || normalized === 'suspended') {
    return 'disabled';
  }
  return 'active';
}

function accountStatusLabel(
  status: WorkspaceMemberGridRow['accountStatus'],
): WorkspaceMemberAccountStatusLabel {
  if (status === 'disabled') {
    return '蛻ｩ逕ｨ蛛懈ｭ｢' as WorkspaceMemberAccountStatusLabel;
  }
  if (status === 'removed') {
    return '蜑企勁貂医∩' as WorkspaceMemberAccountStatusLabel;
  }
  return '蜿ょ刈荳ｭ' as WorkspaceMemberAccountStatusLabel;
}
