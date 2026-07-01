import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';

import { AuthSessionFacade, AuthSessionSnapshot } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade, WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import {
  filterNavigationItems,
  NavigationItem
} from '../../shared/navigation/navigation.models';

export type RightPanelMode = 'collapsed' | 'expanded';

export interface AppShellViewModel {
  readonly session: AuthSessionSnapshot;
  readonly workspace: WorkspaceSummary | null;
  readonly navigationItems: readonly NavigationItem[];
  readonly rightPanelMode: RightPanelMode;
}

export interface AppShellMockState {
  readonly navigationItems?: readonly NavigationItem[];
  readonly rightPanelMode?: RightPanelMode;
}

export const DEFAULT_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'workspaces',
    label: '場所',
    route: '/app/workspaces',
    requiredCapability: 'workspace:view'
  },
  {
    id: 'projects',
    label: '制作',
    route: '/app/projects',
    requiredCapability: 'projects:view'
  },
  {
    id: 'files',
    label: 'ファイル',
    route: '/app/files',
    requiredCapability: 'files:view'
  },
  {
    id: 'account',
    label: '設定',
    route: '/app/account',
    requiredCapability: 'account:view'
  },
  {
    id: 'audit',
    label: '監査',
    route: '/app/admin/audit',
    requiredCapability: 'audit:view'
  }
];

export const AIP_APP_SHELL_MOCK = new InjectionToken<AppShellMockState>('AIP_APP_SHELL_MOCK');

@Injectable({ providedIn: 'root' })
export class AppShellFacade {
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly mockState = inject(AIP_APP_SHELL_MOCK, { optional: true });
  private readonly rightPanelModeState = signal<RightPanelMode>(this.mockState?.rightPanelMode ?? 'collapsed');

  readonly viewModel = computed<AppShellViewModel>(() => {
    const session = this.authSession.session();
    const allItems = this.mockState?.navigationItems ?? DEFAULT_NAVIGATION_ITEMS;

    return {
      session,
      workspace: this.activeWorkspace.activeWorkspace(),
      navigationItems: filterNavigationItems(allItems, session.capabilities),
      rightPanelMode: this.rightPanelModeState()
    };
  });

  setRightPanelMode(mode: RightPanelMode): void {
    this.rightPanelModeState.set(mode);
  }

  toggleRightPanel(): void {
    this.rightPanelModeState.update((mode) => (mode === 'expanded' ? 'collapsed' : 'expanded'));
  }
}
