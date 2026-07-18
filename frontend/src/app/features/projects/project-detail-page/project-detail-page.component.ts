import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AipGanttComponent, AipKanbanComponent } from '../../../shared/ui/adapters/syncfusion/aip-adapter-shells.components';
import { AipGanttContract, AipKanbanContract } from '../../../shared/ui/contracts/aip-complex-adapter.contracts';
import { ProjectDetailFacade, ProjectDetailTab } from '../project-detail.facade';
import { TaskGridRow } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({ selector: 'app-project-detail-page', standalone: true, imports: [AppEmptyStateComponent, AppErrorBannerComponent, AppInlineLoadingComponent, AppPermissionDeniedComponent, AipKanbanComponent, AipGanttComponent, TaskTableComponent], templateUrl: './project-detail-page.component.html', styleUrl: './project-detail-page.component.scss' })
export class ProjectDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly facade = inject(ProjectDetailFacade);
  readonly page = computed(() => this.facade.view());
  readonly tab = signal<ProjectDetailTab>('tasks');
  readonly tabs: readonly { id: ProjectDetailTab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'tasks', label: 'Tasks' }, { id: 'list', label: 'List' }, { id: 'schedule', label: 'Schedule' }, { id: 'workload', label: 'Workload' }, { id: 'members', label: 'Members' }];
  constructor() { const projectId = this.route.snapshot.paramMap.get('projectId'); if (projectId) this.facade.load(projectId); }
  openTask(row: TaskGridRow): void { void this.router.navigate(['/projects', row.projectId, 'tasks', row.id]); }
  kanban(rows: readonly TaskGridRow[]): AipKanbanContract<TaskGridRow> { return { ariaLabel: 'Project tasks by status', presentation: 'desktop', state: 'ready', items: rows, itemIdentity: (row) => row.id, itemTitle: (row) => row.title, itemDescription: (row) => `${row.priorityLabel} · ${row.dueDate || 'No due date'}`, itemStatus: (row) => row.status, columns: [{ id: 'notStarted', label: 'Not started' }, { id: 'inProgress', label: 'In progress' }, { id: 'blocked', label: 'Blocked' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }], canRequestTransition: (row, target) => row.allowedTransitions.includes(target as TaskGridRow['status']) }; }
  gantt(): AipGanttContract<{ id: string; label: string }> { const schedule = this.page().schedule; return { ariaLabel: 'Project schedule', presentation: 'desktop', state: 'ready', tasks: schedule.tasks, taskIdentity: (task) => task.id, taskLabel: (task) => task.label, milestones: schedule.milestones, timezone: 'project timezone unavailable from API', readOnly: true }; }
}
