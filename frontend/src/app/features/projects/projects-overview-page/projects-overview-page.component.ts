import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { ActiveWorkspaceFacade } from '../../../core/workspace/active-workspace.facade';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { WorkspacesFacade } from '../../workspaces/workspaces.facade';
import { ProjectCreateInput } from '../project-create.api';
import { ProjectCreateDialogComponent } from '../project-create-dialog/project-create-dialog.component';
import { ProjectCreateFacade } from '../project-create.facade';
import { ProjectsFacade } from '../projects.facade';
import { ProjectSummaryPanelComponent } from '../project-summary-panel/project-summary-panel.component';
import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';

@Component({
  selector: 'app-projects-overview-page',
  standalone: true,
  imports: [
    RouterLink,
    AppEmptyStateComponent,
    AppErrorBannerComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    ProjectCreateDialogComponent,
    ProjectSummaryPanelComponent,
  ],
  templateUrl: './projects-overview-page.component.html',
  styleUrl: './projects-overview-page.component.scss',
})
export class ProjectsOverviewPageComponent {
  private readonly facade = inject(ProjectsFacade);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly activeWorkspace = inject(ActiveWorkspaceFacade);
  private readonly workspaces = inject(WorkspacesFacade);
  private readonly projectCreate = inject(ProjectCreateFacade);
  private readonly routeWorkspaceId = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('workspaceId')),
      distinctUntilChanged(),
    ),
    { initialValue: this.route.snapshot.paramMap.get('workspaceId') },
  );
  private readonly createQueryRequested = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('create') === '1'),
      distinctUntilChanged(),
    ),
    { initialValue: this.route.snapshot.queryParamMap.get('create') === '1' },
  );
  private readonly workspaceScopeId = computed(
    () => this.routeWorkspaceId() ?? this.activeWorkspace.activeWorkspace()?.id ?? null,
  );
  private observedWorkspaceScopeId = this.workspaceScopeId();
  private handledCreateQuery = false;

  readonly page = computed(() => this.facade.getProjectsOverview());
  readonly designSystemV04Enabled = this.flags.designSystemV04Enabled;
  readonly createDialogOpen = signal(false);
  readonly createOptions = this.projectCreate.options;
  readonly createState = this.projectCreate.createState;
  private readonly scopedWorkspace = computed(() => {
    // A valid Workspace route owns scope. The global Projects route uses only
    // the canonical active Workspace selected by the shell.
    const workspaceId = this.workspaceScopeId();
    if (!workspaceId) {
      return null;
    }

    return this.workspaces.dashboard().workspaces.find((item) => item.id === workspaceId);
  });
  readonly createWorkspace = computed(() => {
    const workspace = this.scopedWorkspace();
    if (!workspace?.capabilities.includes('openProjectCreate')) {
      return null;
    }

    return { id: workspace.id, name: workspace.displayName };
  });

  constructor() {
    effect(() => {
      const nextWorkspaceScopeId = this.workspaceScopeId();
      if (nextWorkspaceScopeId === this.observedWorkspaceScopeId) {
        return;
      }

      this.observedWorkspaceScopeId = nextWorkspaceScopeId;
      this.createDialogOpen.set(false);
      this.projectCreate.clearWorkspaceScope();
    });

    effect(() => {
      const createRequested = this.createQueryRequested();
      if (!createRequested) {
        this.handledCreateQuery = false;
        return;
      }
      if (this.handledCreateQuery) {
        return;
      }

      const workspaceId = this.workspaceScopeId();
      const dashboard = this.workspaces.dashboard();
      if (!workspaceId || dashboard.status === 'loading') {
        return;
      }

      // A ready dashboard row is the authoritative presentation grant. A
      // ready list without the row is also an authoritative denial. Consume
      // the marker either way so reload/back cannot loop the command surface.
      if (dashboard.status !== 'ready') {
        return;
      }

      this.handledCreateQuery = true;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { create: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      if (this.createWorkspace()) {
        this.openCreateDialog();
      }
    });
  }

  retry(): void {
    this.facade.retryProjects();
  }

  openCreateDialog(): void {
    const workspace = this.createWorkspace();
    if (!workspace) {
      return;
    }

    this.projectCreate.resetCreatePresentation();
    this.createDialogOpen.set(true);
    void this.projectCreate.loadOptions(workspace.id);
  }

  resumeCreatedProject(): void {
    if (this.createState().status === 'committedPendingNavigation') {
      this.createDialogOpen.set(true);
    }
  }

  cancelCreateDialog(): void {
    this.createDialogOpen.set(false);
    this.projectCreate.resetCreatePresentation();
  }

  retryCreateOptions(): void {
    const workspace = this.createWorkspace();
    if (workspace) {
      void this.projectCreate.loadOptions(workspace.id);
    }
  }

  async submitProject(input: ProjectCreateInput): Promise<void> {
    const workspace = this.createWorkspace();
    if (!workspace) {
      return;
    }

    if (await this.projectCreate.createProject(workspace.id, input)) {
      this.createDialogOpen.set(false);
    }
  }

  async retryCreatedProjectNavigation(): Promise<void> {
    if (await this.projectCreate.retryCreatedProjectNavigation()) {
      this.createDialogOpen.set(false);
    }
  }
}
