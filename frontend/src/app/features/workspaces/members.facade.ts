import { inject, Injectable, InjectionToken } from '@angular/core';

import {
  WORKSPACE_MEMBERS_DEFAULT_PAGE_SIZE,
  WORKSPACE_MEMBERS_MAXIMUM_PAGE_SIZE,
  WorkspaceMemberActionId,
  WorkspaceMemberGridRow,
  WorkspaceMemberMockRecord,
  WorkspaceMemberRowAction,
  WorkspaceMembersScenario,
  WorkspaceMembersViewModel
} from './members.types';
import { WORKSPACE_MEMBERS_SCENARIOS } from './members.mock';

export const AIP_WORKSPACE_MEMBERS_MOCK = new InjectionToken<WorkspaceMembersScenario>('AIP_WORKSPACE_MEMBERS_MOCK');

@Injectable({
  providedIn: 'root'
})
export class WorkspaceMembersFacade {
  private readonly scenario: WorkspaceMembersScenario =
    inject(AIP_WORKSPACE_MEMBERS_MOCK, { optional: true }) ?? WORKSPACE_MEMBERS_SCENARIOS.default;

  getPage(workspaceId: string): WorkspaceMembersViewModel {
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
        maximumPageSize: WORKSPACE_MEMBERS_MAXIMUM_PAGE_SIZE
      },
      queryOwnership: {
        loadedRowsOwner: 'backendAuthorization',
        clientSearchOwner: 'alreadyLoadedAuthorizedRowsOnly',
        futureSortOwner: 'backendWhenLive',
        futureFilterOwner: 'backendWhenLive'
      },
      message: this.scenario.message
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
      rowActions: this.buildActions(member)
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
        disabledReason: member.mockDetailSupported ? undefined : '削除済み'
      });
    }

    if (member.capabilities.includes('changeRole') && member.accountStatus !== 'removed') {
      actions.push({
        id: 'changeRole',
        label: '権限変更',
        destructive: false,
        disabled: false
      });
    }

    if (member.capabilities.includes('disableMember') && member.accountStatus !== 'removed') {
      actions.push({
        id: 'disableMember',
        label: member.accountStatus === 'disabled' ? '解除確認' : '利用停止',
        destructive: true,
        disabled: false
      });
    }

    return actions satisfies readonly WorkspaceMemberRowAction[];
  }

  isDestructiveAction(actionId: string): actionId is WorkspaceMemberActionId {
    return actionId === 'disableMember';
  }
}
