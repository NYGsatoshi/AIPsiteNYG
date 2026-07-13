import { Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AppDataGridActionEvent } from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { ProjectSummaryPanelComponent } from '../project-summary-panel/project-summary-panel.component';
import { CreateTaskFormRequest, ProjectSummaryViewModel, TaskGridRow, TaskPriority } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-projects-overview-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    AppEmptyStateComponent,
    AppErrorBannerComponent,
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
  readonly createMutationState = computed(() => this.facade.getTaskCreateMutationState());
  actionMessage = '';
  readonly createForm = new FormGroup({
    projectId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    priority: new FormControl<TaskPriority>('medium', { nonNullable: true }),
    startDate: new FormControl('', { nonNullable: true }),
    dueDate: new FormControl('', { nonNullable: true })
  });

  readonly priorities: readonly { value: TaskPriority; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
  ];

  handleTaskAction(event: AppDataGridActionEvent<TaskGridRow>): void {
    if (event.actionId === 'openDetail') {
      void this.router.navigate(['/projects', event.row.projectId, 'tasks', event.row.id]);
      return;
    }

    this.actionMessage = `${event.actionId}:${event.row.id}`;
  }

  canCreateInAnyProject(projects: readonly ProjectSummaryViewModel[]): boolean {
    return projects.some((project) => project.canCreateTask);
  }

  submitCreateTask(): void {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid || this.createMutationState().status === 'submitting') {
      return;
    }

    const request: CreateTaskFormRequest = this.createForm.getRawValue();
    this.facade.createTask(request);
  }

  clearCreateState(): void {
    this.facade.clearTaskCreateMutationState();
  }

  retry(): void {
    this.facade.retryProjects();
  }
}
