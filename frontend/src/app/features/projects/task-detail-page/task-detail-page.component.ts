import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { AppMentionInputComponent } from '../../../shared/mention-input/app-mention-input.component';

@Component({
  selector: 'app-task-detail-page',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    AppEmptyStateComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    TaskDependenciesReadonlyComponent,
    TaskEditorComponent,
    TaskProgressFieldComponent,
    TaskStatusBadgeComponent,
    AppMentionInputComponent
  ],
  templateUrl: './task-detail-page.component.html',
  styleUrl: './task-detail-page.component.scss'
})
export class TaskDetailPageComponent implements OnDestroy {
  private readonly facade = inject(ProjectsFacade);
  private readonly route = inject(ActivatedRoute);

  readonly page = computed(() =>
    this.facade.getTaskDetail(
      this.route.snapshot.paramMap.get('projectId') ?? undefined,
      this.route.snapshot.paramMap.get('taskId') ?? undefined
    )
  );
  readonly mutationState = computed(() => this.facade.getTaskMutationState());
  readonly checklistText = signal('');
  readonly commentBody = signal('');
  readonly commentImportant = signal(false);
  readonly attachmentId = signal('');

  constructor() {
    this.facade.ensureTaskDetail(
      this.route.snapshot.paramMap.get('projectId') ?? undefined,
      this.route.snapshot.paramMap.get('taskId') ?? undefined
    );
  }

  ngOnDestroy(): void {
    this.facade.releaseTaskDetail();
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

  retry(): void { const taskId = this.route.snapshot.paramMap.get('taskId'); if (taskId) this.facade.retryTaskDetail(taskId); }
  createChecklist(): void { const vm = this.page(); const text = this.checklistText().trim(); if (vm.task && text && vm.detail?.permissions.canCreateChecklistItem) { this.facade.createChecklist(vm.task.id, text); this.checklistText.set(''); } }
  toggleChecklist(item: { id: string; text: string; isCompleted: boolean; version: string }): void { const vm = this.page(); if (vm.task) this.facade.updateChecklist(vm.task.id, item.id, item.text, !item.isCompleted, item.version); }
  deleteChecklist(item: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteChecklist(vm.task.id, item.id, item.version); }
  moveChecklist(itemId: string, direction: -1 | 1): void { const vm = this.page(); if (!vm.task || !vm.detail) return; const ids = vm.detail.checklist.map(item => item.id); const from = ids.indexOf(itemId); const to = from + direction; if (from < 0 || to < 0 || to >= ids.length) return; [ids[from], ids[to]] = [ids[to], ids[from]]; this.facade.reorderChecklist(vm.task.id, ids, vm.detail.taskVersion); }
  postComment(): void { const vm = this.page(); const body = this.commentBody().trim(); if (vm.task && body && vm.detail?.permissions.canCreateComment) { this.facade.createComment(vm.task.id, body, this.commentImportant()); this.commentBody.set(''); this.commentImportant.set(false); } }
  toggleImportant(comment: { id: string; body: string | null; isImportant: boolean; version: string }): void { const vm = this.page(); if (vm.task && comment.body !== null) this.facade.updateComment(vm.task.id, comment.id, comment.body, !comment.isImportant, comment.version); }
  deleteComment(comment: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteComment(vm.task.id, comment.id, comment.version); }
  toggleWatch(): void { const vm = this.page(); if (vm.task && vm.detail?.permissions.canChangeWatch) this.facade.setWatch(vm.task.id, !vm.detail.watchState.isWatching, vm.detail.watchState.version); }
  removeLabel(labelId: string): void { const vm = this.page(); if (vm.task) this.facade.removeLabel(vm.task.id, labelId); }
  associateFile(): void { const vm = this.page(); const attachmentId = this.attachmentId().trim(); if (vm.task && attachmentId && vm.detail?.permissions.canAssociateFiles) { this.facade.associateFile(vm.task.id, attachmentId, vm.detail.taskVersion); this.attachmentId.set(''); } }
  removeFile(associationId: string): void { const vm = this.page(); if (vm.task && vm.detail) this.facade.removeFile(vm.task.id, associationId, vm.detail.taskVersion); }
  requestFileGrant(fileObjectId: string): void { const vm = this.page(); if (vm.task) this.facade.requestFileGrant(vm.task.id, fileObjectId); }
}
