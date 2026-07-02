import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WorkspaceEmptyStateComponent } from '../workspace-empty-state/workspace-empty-state.component';
import { WorkspaceSummaryListComponent } from '../workspace-summary-list/workspace-summary-list.component';
import { WorkspacesFacade } from '../workspaces.facade';
import { WorkspaceCardViewModel } from '../workspaces.types';

@Component({
  selector: 'app-workspace-dashboard-page',
  standalone: true,
  imports: [FormsModule, WorkspaceEmptyStateComponent, WorkspaceSummaryListComponent],
  templateUrl: './workspace-dashboard-page.component.html',
  styleUrl: './workspace-dashboard-page.component.scss'
})
export class WorkspaceDashboardPageComponent {
  private readonly facade = inject(WorkspacesFacade);

  readonly dashboard = this.facade.dashboard;
  readonly searchValue = signal('');
  readonly filteredWorkspaces = computed(() => this.filterWorkspaces(this.dashboard().workspaces, this.searchValue()));

  updateSearch(value: string): void {
    this.searchValue.set(value);
  }

  canCreateWorkspace(): boolean {
    return this.dashboard().pageCapabilities.includes('createWorkspace');
  }

  private filterWorkspaces(workspaces: readonly WorkspaceCardViewModel[], searchValue: string): readonly WorkspaceCardViewModel[] {
    const query = searchValue.trim().toLocaleLowerCase('ja-JP');
    if (!query) {
      return workspaces;
    }

    return workspaces.filter((workspace) =>
      [workspace.displayName, workspace.roleLabel, workspace.lastUpdatedLabel ?? '']
        .join(' ')
        .toLocaleLowerCase('ja-JP')
        .includes(query)
    );
  }
}
