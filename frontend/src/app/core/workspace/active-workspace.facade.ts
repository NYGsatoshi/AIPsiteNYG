import { InjectionToken, inject, Injectable, signal } from '@angular/core';

export interface WorkspaceSummary {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const DEFAULT_ACTIVE_WORKSPACE: WorkspaceSummary = {
  id: 'fictional-workspace-1',
  label: '検証ワークスペース',
  description: '準備中'
};

export const AIP_ACTIVE_WORKSPACE_MOCK = new InjectionToken<WorkspaceSummary | null>('AIP_ACTIVE_WORKSPACE_MOCK');

@Injectable({ providedIn: 'root' })
export class ActiveWorkspaceFacade {
  private readonly initialWorkspace = inject(AIP_ACTIVE_WORKSPACE_MOCK, { optional: true }) ?? DEFAULT_ACTIVE_WORKSPACE;
  private readonly activeWorkspaceState = signal<WorkspaceSummary | null>(this.initialWorkspace);

  readonly activeWorkspace = this.activeWorkspaceState.asReadonly();

  clearWorkspace(): void {
    this.activeWorkspaceState.set(null);
  }

  setMockWorkspace(workspace: WorkspaceSummary | null): void {
    this.activeWorkspaceState.set(workspace);
  }
}
