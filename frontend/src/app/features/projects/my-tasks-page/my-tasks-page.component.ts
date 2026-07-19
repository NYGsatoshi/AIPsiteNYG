import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AppDataGridActionEvent } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { MyTasksFacade } from '../my-tasks.facade';
import { MyTasksScope, MyTasksTab, MyTasksUrgencyGroup, MyTasksViewModel, TaskGridRow } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-my-tasks-page', standalone: true,
  imports: [AppEmptyStateComponent, AppErrorBannerComponent, AppInlineLoadingComponent, AppPermissionDeniedComponent, TaskTableComponent],
  templateUrl: './my-tasks-page.component.html', styleUrl: './my-tasks-page.component.scss'
})
export class MyTasksPageComponent {
  private readonly facade = inject(MyTasksFacade);
  private readonly router = inject(Router);
  private readonly flags = inject(FrontendFeatureFlagsService);
  readonly page = computed(() => this.facade.getMyTasks());
  readonly designSystemV04Enabled = this.flags.designSystemV04Enabled;
  readonly myTasksV1Enabled = this.flags.myTasksV1Enabled;
  readonly tabs: readonly { readonly id: MyTasksTab; readonly label: string }[] = [
    { id: 'assigned', label: 'Assigned to Me' }, { id: 'participating', label: 'Participating' }, { id: 'reviews', label: 'Reviews' },
    { id: 'created', label: 'Created by Me' }, { id: 'watching', label: 'Watching' }, { id: 'teamQueue', label: 'Team Queue' }, { id: 'completed', label: 'Completed' }
  ];
  readonly groups: readonly { readonly id: MyTasksUrgencyGroup; readonly label: string }[] = [
    { id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Today' }, { id: 'next7Days', label: 'Next 7 Days' }, { id: 'later', label: 'Later' }, { id: 'noDeadline', label: 'No Deadline' }
  ];

  constructor() { this.facade.load(); }
  retry(): void { this.facade.retry(); }
  setTab(tab: MyTasksTab): void { this.facade.setTab(tab); }
  setScope(scope: MyTasksScope): void { this.facade.setScope(scope, this.page().workspaceId); }
  count(vm: MyTasksViewModel, key: string): number { return vm.counts.find((item) => item.key === key)?.count ?? 0; }
  tasksForGroup(vm: MyTasksViewModel, group: MyTasksUrgencyGroup) { return vm.tasks.filter((task) => task.timeGroup === group); }
  handleTaskAction(event: AppDataGridActionEvent<TaskGridRow>): void { if (event.actionId === 'openDetail') void this.router.navigate(['/projects', event.row.projectId, 'tasks', event.row.id]); }
}
