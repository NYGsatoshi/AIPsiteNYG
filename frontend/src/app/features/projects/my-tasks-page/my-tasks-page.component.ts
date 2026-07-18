import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AppDataGridActionEvent } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { MyTasksFacade } from '../my-tasks.facade';
import { TaskGridRow } from '../projects.types';
import { AipKanbanComponent } from '../../../shared/ui/adapters/syncfusion/aip-adapter-shells.components';
import { AipKanbanContract } from '../../../shared/ui/contracts/aip-complex-adapter.contracts';
import { MyTasksProjection, WorkViewPreferenceService } from '../work-view-preference.service';
import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-my-tasks-page',
  standalone: true,
  imports: [
    AppEmptyStateComponent,
    AppErrorBannerComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    AipKanbanComponent,
    TaskTableComponent
  ],
  templateUrl: './my-tasks-page.component.html',
  styleUrl: './my-tasks-page.component.scss'
})
export class MyTasksPageComponent {
  private readonly facade = inject(MyTasksFacade);
  private readonly router = inject(Router);
  private readonly preferences = inject(WorkViewPreferenceService);
  private readonly flags = inject(FrontendFeatureFlagsService);

  readonly page = computed(() => this.facade.getMyTasks());
  actionMessage = '';
  readonly projection = signal<MyTasksProjection>(this.preferences.loadMyTasksProjection());
  readonly designSystemV04Enabled = this.flags.designSystemV04Enabled;

  constructor() {
    this.facade.load();
  }

  handleTaskAction(event: AppDataGridActionEvent<TaskGridRow>): void {
    if (event.actionId === 'openDetail') {
      void this.router.navigate(['/projects', event.row.projectId, 'tasks', event.row.id]);
      return;
    }

    this.actionMessage = `${event.actionId}:${event.row.id}`;
  }

  retry(): void {
    this.facade.retry();
  }

  setProjection(projection: MyTasksProjection): void {
    this.projection.set(projection);
    this.preferences.saveMyTasksProjection(projection);
  }

  kanbanContract(rows: readonly TaskGridRow[]): AipKanbanContract<TaskGridRow> {
    return {
      ariaLabel: 'My Tasks by status', presentation: 'desktop', state: 'ready', items: rows,
      itemIdentity: (row) => row.id,
      itemTitle: (row) => row.title,
      itemDescription: (row) => `${row.project} · ${row.priorityLabel}`,
      itemStatus: (row) => row.status,
      columns: [
        { id: 'notStarted', label: 'Not started' }, { id: 'inProgress', label: 'In progress' },
        { id: 'blocked', label: 'Blocked' }, { id: 'review', label: 'Review' },
        { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }
      ],
      canRequestTransition: (row, target) => row.allowedTransitions.includes(target as TaskGridRow['status'])
    };
  }
}
