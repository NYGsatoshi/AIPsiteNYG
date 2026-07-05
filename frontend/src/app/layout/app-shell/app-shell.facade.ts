import { computed, Injectable, InjectionToken, inject } from '@angular/core';

import { AuthSessionFacade, AuthSessionSnapshot } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade, WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import {
  filterNavigationItems,
  NavigationItem
} from '../../shared/navigation/navigation.models';
import { RightPanelFacade } from '../../shared/right-panel/right-panel.facade';
import { RightPanelMode } from '../../shared/right-panel/right-panel.types';

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
    label: 'Workspaces',
    route: '/workspaces',
    requiredCapability: 'workspace:view'
  },
  {
    id: 'announcements',
    label: 'Announcements',
    route: '/announcements',
    requiredCapability: 'announcements:view'
  },
  {
    id: 'projects',
    label: 'Projects',
    route: '/projects',
    requiredCapability: 'projects:view'
  },
  {
    id: 'files',
    label: 'Files',
    route: '/files',
    requiredCapability: 'files:view'
  },
  {
    id: 'account',
    label: 'Account',
    route: '/account',
    requiredCapability: 'account:view'
  },
  {
    id: 'audit',
    label: 'Audit',
    route: '/admin/audit',
    requiredCapability: 'audit:view'
  },
  {
    id: 'invites',
    label: 'Invites',
    route: '/admin/invites',
    requiredCapability: 'invite:read'
  }
];

export const AIP_APP_SHELL_MOCK = new InjectionToken<AppShellMockState>('AIP_APP_SHELL_MOCK');

@Injectable({ providedIn: 'root' })
export class AppShellFacade {
  private readonly authSession = inject(AuthSessionFacade);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly rightPanel = inject(RightPanelFacade);
  private readonly mockState = inject(AIP_APP_SHELL_MOCK, { optional: true });

  readonly viewModel = computed<AppShellViewModel>(() => {
    const session = this.authSession.session();
    const allItems = this.mockState?.navigationItems ?? DEFAULT_NAVIGATION_ITEMS;

    return {
      session,
      workspace: this.activeWorkspace.activeWorkspace(),
      navigationItems: filterNavigationItems(allItems, session.capabilities),
      rightPanelMode: this.rightPanel.mode()
    };
  });

  setRightPanelMode(mode: RightPanelMode): void {
    this.rightPanel.setMode(mode);
  }

  toggleRightPanel(): void {
    this.rightPanel.togglePanel();
  }
}
