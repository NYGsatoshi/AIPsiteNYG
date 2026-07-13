import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { TaskEditorSaveRequest } from '../projects.types';
import { TaskDependenciesReadonlyComponent } from '../task-dependencies-readonly/task-dependencies-readonly.component';
import { TaskEditorComponent } from '../task-editor/task-editor.component';
import { TaskProgressFieldComponent } from '../task-progress-field/task-progress-field.component';
import { TaskStatusBadgeComponent } from '../task-status-badge/task-status-badge.component';

@Component({
  selector: 'app-task-detail-page',
  standalone: true,
  imports: [
    RouterLink,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    TaskDependenciesReadonlyComponent,
    TaskEditorComponent,
    TaskProgressFieldComponent,
    TaskStatusBadgeComponent
  ],
  templateUrl: './task-detail-page.component.html',
  styleUrl: './task-detail-page.component.scss'
})
export class TaskDetailPageComponent {
  private readonly facade = inject(ProjectsFacade);
  private readonly route = inject(ActivatedRoute);

  readonly page = computed(() =>
    this.facade.getTaskDetail(
      this.route.snapshot.paramMap.get('projectId') ?? undefined,
      this.route.snapshot.paramMap.get('taskId') ?? undefined
    )
  );
  readonly mutationState = computed(() => this.facade.getTaskMutationState());

  constructor() {
    this.facade.ensureTaskDetail(
      this.route.snapshot.paramMap.get('projectId') ?? undefined,
      this.route.snapshot.paramMap.get('taskId') ?? undefined
    );
  }

  saveTask(request: TaskEditorSaveRequest): void {
    const vm = this.page();
    if (!vm.task) {
      return;
    }

    this.facade.saveTask(vm.task.id, vm.task.projectId, request);
  }

  resetMutationState(): void {
    this.facade.clearTaskMutationState();
  }
}
