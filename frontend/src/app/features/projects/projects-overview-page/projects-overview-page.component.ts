import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AppDataGridActionEvent } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { ProjectSummaryPanelComponent } from '../project-summary-panel/project-summary-panel.component';
import { TaskGridRow } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-projects-overview-page',
  standalone: true,
  imports: [
    RouterLink,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    ProjectSummaryPanelComponent,
    TaskTableComponent
  ],
  templateUrl: './projects-overview-page.component.html',
  styleUrl: './projects-overview-page.component.scss'
})
export class ProjectsOverviewPageComponent {
  private readonly facade = inject(ProjectsFacade);
  private readonly router = inject(Router);

  readonly page = computed(() => this.facade.getProjectsOverview());
  actionMessage = '';

  handleTaskAction(event: AppDataGridActionEvent<TaskGridRow>): void {
    if (event.actionId === 'openDetail') {
      void this.router.navigate(['/app/projects', event.row.projectId, 'tasks', event.row.id]);
      return;
    }

    this.actionMessage = `${event.actionId}:${event.row.id}`;
  }
}
