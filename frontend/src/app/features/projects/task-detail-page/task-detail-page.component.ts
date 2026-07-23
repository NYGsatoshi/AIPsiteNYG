import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

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
import { FilesFacade } from '../../files/files.facade';

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
  private readonly files = inject(FilesFacade);
  private routeSubscription: Subscription | null = null;
  private readonly projectId = signal<string | undefined>(undefined);
  private readonly taskId = signal<string | undefined>(undefined);

  readonly page = computed(() =>
    this.facade.getTaskDetail(
      this.projectId(),
      this.taskId()
    )
  );
  readonly mutationState = computed(() => this.facade.getTaskMutationState());
  readonly checklistText = signal('');
  readonly commentBody = signal('');
  readonly commentImportant = signal(false);
  readonly editingCommentId = signal<string | null>(null);
  readonly editingCommentBody = signal('');
  readonly editingCommentImportant = signal(false);
  readonly selectedLabelId = signal('');
  readonly newLabelName = signal('');
  readonly subtaskTitle = signal('');

  constructor() {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const projectId = params.get('projectId') ?? undefined;
      const taskId = params.get('taskId') ?? undefined;
      this.projectId.set(projectId);
      this.taskId.set(taskId);
      this.facade.ensureTaskDetail(projectId, taskId);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
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

  retry(): void { const taskId = this.taskId(); if (taskId) this.facade.retryTaskDetail(taskId); }
  createSubtask(): void { const vm = this.page(); if (vm.task && vm.detail?.permissions.canCreateSubtask) { this.facade.createSubtask(vm.task.id, this.subtaskTitle(), () => this.subtaskTitle.set('')); } }
  createChecklist(): void { const vm = this.page(); const text = this.checklistText().trim(); if (vm.task && text && vm.detail?.permissions.canCreateChecklistItem) { this.facade.createChecklist(vm.task.id, text, () => this.checklistText.set('')); } }
  toggleChecklist(item: { id: string; text: string; isCompleted: boolean; version: string }): void { const vm = this.page(); if (vm.task) this.facade.updateChecklist(vm.task.id, item.id, item.text, !item.isCompleted, item.version); }
  deleteChecklist(item: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteChecklist(vm.task.id, item.id, item.version); }
  moveChecklist(itemId: string, direction: -1 | 1): void { const vm = this.page(); if (!vm.task || !vm.detail) return; const ids = vm.detail.checklist.map(item => item.id); const from = ids.indexOf(itemId); const to = from + direction; if (from < 0 || to < 0 || to >= ids.length) return; [ids[from], ids[to]] = [ids[to], ids[from]]; this.facade.reorderChecklist(vm.task.id, ids, vm.detail.taskVersion); }
  postComment(): void { const vm = this.page(); const body = this.commentBody().trim(); if (vm.task && body && vm.detail?.permissions.canCreateComment) { this.facade.createComment(vm.task.id, body, this.commentImportant(), () => { this.commentBody.set(''); this.commentImportant.set(false); }); } }
  editComment(comment: { id: string; body: string | null; isImportant: boolean }): void { if (comment.body !== null) { this.editingCommentId.set(comment.id); this.editingCommentBody.set(comment.body); this.editingCommentImportant.set(comment.isImportant); } }
  cancelEditComment(): void { this.editingCommentId.set(null); this.editingCommentBody.set(''); this.editingCommentImportant.set(false); }
  saveComment(comment: { id: string; version: string }): void { const vm = this.page(); const body = this.editingCommentBody().trim(); if (vm.task && body) this.facade.updateComment(vm.task.id, comment.id, body, this.editingCommentImportant(), comment.version, () => this.cancelEditComment()); }
  toggleImportant(comment: { id: string; body: string | null; isImportant: boolean; version: string }): void { const vm = this.page(); if (vm.task && comment.body !== null) this.facade.updateComment(vm.task.id, comment.id, comment.body, !comment.isImportant, comment.version); }
  deleteComment(comment: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteComment(vm.task.id, comment.id, comment.version); }
  toggleWatch(): void { const vm = this.page(); if (vm.task && vm.detail?.permissions.canChangeWatch) this.facade.setWatch(vm.task.id, !vm.detail.watchState.isWatching, vm.detail.watchState.version); }
  removeLabel(labelId: string): void { const vm = this.page(); if (vm.task) this.facade.removeLabel(vm.task.id, labelId); }
  applyLabel(): void { const vm = this.page(); const labelId = this.selectedLabelId(); if (vm.task && labelId && vm.detail?.permissions.canApplyLabels) { this.facade.applyLabel(vm.task.id, labelId); this.selectedLabelId.set(''); } }
  refreshLabelDefinitions(): void { const vm = this.page(); if (vm.task) this.facade.loadProjectLabelDefinitions(vm.task.projectId); }
  createLabel(): void { const vm = this.page(); if (vm.task && vm.detail?.permissions.canManageLabelDefinitions) { this.facade.createProjectLabel(vm.task.id, vm.task.projectId, this.newLabelName()); this.newLabelName.set(''); } }
  setLabelArchived(label: { id: string; version: string }, archived: boolean): void { const vm = this.page(); if (vm.task) this.facade.setProjectLabelArchived(vm.task.id, vm.task.projectId, label.id, label.version, archived); }
  checklistCompletedCount(): number { return this.page().detail?.checklist.filter((item) => item.isCompleted).length ?? 0; }
  isAppliedLabel(): boolean { const detail = this.page().detail; return !!detail?.labels.some((label) => label.id === this.selectedLabelId()); }
  removeFile(associationId: string): void { const vm = this.page(); if (vm.task && vm.detail) this.facade.removeFile(vm.task.id, associationId, vm.detail.taskVersion); }
  downloadFile(fileObjectId: string): void { this.files.downloadFile(fileObjectId); }
}
