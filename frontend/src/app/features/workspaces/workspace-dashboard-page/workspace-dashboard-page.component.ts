import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { WorkspaceCreateDialogComponent } from '../workspace-create-dialog/workspace-create-dialog.component';
import { WorkspaceEmptyStateComponent } from '../workspace-empty-state/workspace-empty-state.component';
import { WorkspaceSummaryListComponent } from '../workspace-summary-list/workspace-summary-list.component';
import { WorkspacesFacade } from '../workspaces.facade';
import { WorkspaceCardViewModel, WorkspaceCreateInput } from '../workspaces.types';

@Component({
  selector: 'app-workspace-dashboard-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    WorkspaceCreateDialogComponent,
    WorkspaceEmptyStateComponent,
    WorkspaceSummaryListComponent,
  ],
  templateUrl: './workspace-dashboard-page.component.html',
  styleUrl: './workspace-dashboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class WorkspaceDashboardPageComponent {
  private readonly facade = inject(WorkspacesFacade);

  readonly dashboard = this.facade.dashboard;
  readonly workspaceCreate = this.facade.workspaceCreate;
  readonly searchValue = signal('');
  readonly createDialogOpen = signal(false);
  readonly createdAnnouncement = signal<string | null>(null);
  readonly filteredWorkspaces = computed(() => this.filterWorkspaces(this.dashboard().workspaces, this.searchValue()));
  readonly needsAttentionCount = computed(() =>
    this.dashboard().workspaces.reduce(
      (total, workspace) => total + (workspace.needsAttentionCount ?? 0),
      0,
    ),
  );
  readonly needsAttentionItems = computed(() =>
    this.dashboard().workspaces.flatMap((workspace) =>
      (workspace.needsAttentionItems ?? []).map((item) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.displayName,
        item,
      })),
    ),
  );

  updateSearch(value: string): void {
    this.searchValue.set(value);
  }

  canCreateWorkspace(): boolean {
    return this.dashboard().pageCapabilities.includes('createWorkspace');
  }

  hasPendingWorkspaceActivation(): boolean {
    return this.workspaceCreate().status === 'committedPendingActivation';
  }

  openCreateDialog(): void {
    if (!this.canCreateWorkspace()) {
      return;
    }

    this.facade.resetWorkspaceCreatePresentation();
    this.createdAnnouncement.set(null);
    this.createDialogOpen.set(true);
  }

  resumeWorkspaceActivation(): void {
    if (!this.hasPendingWorkspaceActivation()) {
      return;
    }

    this.createdAnnouncement.set(null);
    this.createDialogOpen.set(true);
  }

  closeCreateDialog(): void {
    const createStatus = this.workspaceCreate().status;
    if (createStatus === 'submitting') {
      return;
    }

    if (createStatus !== 'committedPendingActivation') {
      this.facade.resetWorkspaceCreatePresentation();
    }
    this.createDialogOpen.set(false);
  }

  async createWorkspace(input: WorkspaceCreateInput): Promise<void> {
    const activated = await this.facade.createWorkspace(input);
    if (!activated) {
      return;
    }

    this.searchValue.set('');
    this.createDialogOpen.set(false);
    this.createdAnnouncement.set(`${input.name.trim()} Workspaceを作成し、選択しました。`);
  }

  async retryWorkspaceActivation(): Promise<void> {
    const activated = await this.facade.retryWorkspaceActivation();
    if (!activated) {
      return;
    }

    const createdId = this.workspaceCreate().createdWorkspaceId;
    const createdName = this.dashboard().workspaces.find((workspace) => workspace.id === createdId)?.displayName;
    this.searchValue.set('');
    this.createDialogOpen.set(false);
    this.createdAnnouncement.set(
      createdName
        ? `${createdName} Workspaceを選択しました。`
        : '作成したWorkspaceを選択しました。',
    );
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
