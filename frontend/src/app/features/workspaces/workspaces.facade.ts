import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import { DEFAULT_WORKSPACE_DASHBOARD } from './workspaces.mock';
import { WorkspaceDashboardViewModel } from './workspaces.types';

export const AIP_WORKSPACES_DASHBOARD_MOCK = new InjectionToken<WorkspaceDashboardViewModel>('AIP_WORKSPACES_DASHBOARD_MOCK');

@Injectable({
  providedIn: 'root'
})
export class WorkspacesFacade {
  private readonly initialDashboard = inject(AIP_WORKSPACES_DASHBOARD_MOCK, { optional: true }) ?? DEFAULT_WORKSPACE_DASHBOARD;
  private readonly dashboardState = signal<WorkspaceDashboardViewModel>(this.initialDashboard);

  readonly dashboard = this.dashboardState.asReadonly();
}
