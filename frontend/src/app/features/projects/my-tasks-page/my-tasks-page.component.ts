import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AppDataGridActionEvent } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { TaskGridRow } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-my-tasks-page',
  standalone: true,
  imports: [AppEmptyStateComponent, AppInlineLoadingComponent, AppPermissionDeniedComponent, TaskTableComponent],
  templateUrl: './my-tasks-page.component.html',
  styleUrl: './my-tasks-page.component.scss'
})
export class MyTasksPageComponent {
  private readonly facade = inject(ProjectsFacade);
  private readonly router = inject(Router);

  readonly page = computed(() => this.facade.getMyTasks());
  actionMessage = '';

  handleTaskAction(event: AppDataGridActionEvent<TaskGridRow>): void {
    if (event.actionId === 'openDetail') {
      void this.router.navigate(['/app/projects', event.row.projectId, 'tasks', event.row.id]);
      return;
    }

    this.actionMessage = `${event.actionId}:${event.row.id}`;
  }
}
