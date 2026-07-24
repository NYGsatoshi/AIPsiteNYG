import { Component, computed, effect, inject, OnDestroy, Signal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { TaskDetailSection, TaskDetailSectionState, TaskEditorSaveRequest } from '../projects.types';
import { TaskDependenciesReadonlyComponent } from '../task-dependencies-readonly/task-dependencies-readonly.component';
import { TaskEditorComponent } from '../task-editor/task-editor.component';
import { TaskProgressFieldComponent } from '../task-progress-field/task-progress-field.component';
import { TaskStatusBadgeComponent } from '../task-status-badge/task-status-badge.component';
import { AppMentionInputComponent } from '../../../shared/mention-input/app-mention-input.component';
import { FilesFacade } from '../../files/files.facade';
import { AttachmentPickerDialogComponent } from '../../files/attachment-picker-dialog/attachment-picker-dialog.component';

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
    AppMentionInputComponent,
    AttachmentPickerDialogComponent
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
  private readonly sectionStateSignals: Record<TaskDetailSection, Signal<TaskDetailSectionState>> = {
    detail: computed(() => this.facade.getDetailSectionState('detail')),
    subtasks: computed(() => this.facade.getDetailSectionState('subtasks')),
    checklist: computed(() => this.facade.getDetailSectionState('checklist')),
    comments: computed(() => this.facade.getDetailSectionState('comments')),
    labels: computed(() => this.facade.getDetailSectionState('labels')),
    watch: computed(() => this.facade.getDetailSectionState('watch')),
    files: computed(() => this.facade.getDetailSectionState('files'))
  };
  readonly sectionState = (section: TaskDetailSection) => this.sectionStateSignals[section];
  readonly filePicker = this.files.pickerFiles;
  readonly checklistText = signal('');
  readonly commentBody = signal('');
  readonly commentImportant = signal(false);
  readonly editingCommentId = signal<string | null>(null);
  readonly editingCommentBody = signal('');
  readonly editingCommentImportant = signal(false);
  readonly editingChecklistId = signal<string | null>(null);
  readonly editingChecklistText = signal('');
  readonly selectedLabelId = signal('');
  readonly newLabelName = signal('');
  readonly editingLabelId = signal<string | null>(null);
  readonly editingLabelName = signal('');
  readonly editingLabelDescription = signal('');
  readonly editingLabelSortKey = signal('');
  readonly selectedAttachmentId = signal('');
  readonly fileDownloadMessage = signal('');
  readonly subtaskTitle = signal('');
  private lastRouteKey: string | null = null;

  constructor() {
    effect(() => {
      const workspaceId = this.page().detail?.workspaceId;
      if (workspaceId) this.files.loadPickerFilesForWorkspace(workspaceId);
      else this.files.clearPickerFiles();
    });
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const projectId = params.get('projectId') ?? undefined;
      const taskId = params.get('taskId') ?? undefined;
      const routeKey = `${projectId ?? ''}/${taskId ?? ''}`;
      if (this.lastRouteKey !== null && this.lastRouteKey !== routeKey) this.resetLocalTaskDraftState();
      this.lastRouteKey = routeKey;
      this.projectId.set(projectId);
      this.taskId.set(taskId);
      this.facade.ensureTaskDetail(projectId, taskId);
    });
  }

  ngOnDestroy(): void {
    this.resetLocalTaskDraftState();
    this.files.cancelAttachmentDownloads();
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
  retrySection(section: TaskDetailSection): void { const taskId = this.taskId(); if (taskId) this.facade.retrySection(taskId, section); }
  loadMore(section: 'subtasks' | 'comments' | 'files'): void { const taskId = this.taskId(); if (!taskId) return; if (section === 'subtasks') this.facade.loadMoreSubtasks(taskId); else if (section === 'comments') this.facade.loadMoreComments(taskId); else this.facade.loadMoreFiles(taskId); }
  createSubtask(): void { const vm = this.page(); const title = this.subtaskTitle().trim(); if (vm.task && vm.detail?.permissions.canCreateSubtask && title.length <= 500) { this.facade.createSubtask(vm.task.id, title, () => this.subtaskTitle.set('')); } }
  createChecklist(): void { const vm = this.page(); const text = this.checklistText().trim(); if (vm.task && text && text.length <= 1000 && vm.detail?.permissions.canCreateChecklistItem) { this.facade.createChecklist(vm.task.id, text, () => this.checklistText.set('')); } }
  toggleChecklist(item: { id: string; text: string; isCompleted: boolean; version: string }): void { const vm = this.page(); if (vm.task) this.facade.updateChecklist(vm.task.id, item.id, item.text, !item.isCompleted, item.version); }
  editChecklist(item: { id: string; text: string }): void { this.editingChecklistId.set(item.id); this.editingChecklistText.set(item.text); }
  cancelEditChecklist(): void { this.editingChecklistId.set(null); this.editingChecklistText.set(''); }
  saveChecklist(item: { id: string; isCompleted: boolean; version: string }): void { const vm = this.page(); const text = this.editingChecklistText().trim(); if (vm.task && text) this.facade.updateChecklist(vm.task.id, item.id, text, item.isCompleted, item.version, () => this.cancelEditChecklist()); }
  deleteChecklist(item: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteChecklist(vm.task.id, item.id, item.version); }
  moveChecklist(itemId: string, direction: -1 | 1): void { const vm = this.page(); if (!vm.task || !vm.detail) return; const ids = vm.detail.checklist.map(item => item.id); const from = ids.indexOf(itemId); const to = from + direction; if (from < 0 || to < 0 || to >= ids.length) return; [ids[from], ids[to]] = [ids[to], ids[from]]; this.facade.reorderChecklist(vm.task.id, ids, vm.detail.taskVersion); }
  postComment(): void { const vm = this.page(); const body = this.commentBody().trim(); if (vm.task && body && body.length <= 12000 && vm.detail?.permissions.canCreateComment) { this.facade.createComment(vm.task.id, body, this.commentImportant(), () => { this.commentBody.set(''); this.commentImportant.set(false); }); } }
  editComment(comment: { id: string; body: string | null; isImportant: boolean }): void { if (comment.body !== null) { this.editingCommentId.set(comment.id); this.editingCommentBody.set(comment.body); this.editingCommentImportant.set(comment.isImportant); } }
  cancelEditComment(): void { this.editingCommentId.set(null); this.editingCommentBody.set(''); this.editingCommentImportant.set(false); }
  saveComment(comment: { id: string; version: string }): void { const vm = this.page(); const body = this.editingCommentBody().trim(); if (vm.task && body) this.facade.updateComment(vm.task.id, comment.id, body, this.editingCommentImportant(), comment.version, () => this.cancelEditComment()); }
  toggleImportant(comment: { id: string; body: string | null; isImportant: boolean; version: string }): void { const vm = this.page(); if (vm.task && comment.body !== null) this.facade.updateComment(vm.task.id, comment.id, comment.body, !comment.isImportant, comment.version); }
  deleteComment(comment: { id: string; version: string }): void { const vm = this.page(); if (vm.task) this.facade.deleteComment(vm.task.id, comment.id, comment.version); }
  toggleWatch(): void { const vm = this.page(); if (vm.task && vm.detail?.permissions.canChangeWatch) this.facade.setWatch(vm.task.id, !vm.detail.watchState.isWatching, vm.detail.watchState.version); }
  removeLabel(labelId: string): void { const vm = this.page(); if (vm.task) this.facade.removeLabel(vm.task.id, labelId); }
  applyLabel(): void { const vm = this.page(); const labelId = this.selectedLabelId(); if (vm.task && labelId && vm.detail?.permissions.canApplyLabels) this.facade.applyLabel(vm.task.id, labelId, () => this.selectedLabelId.set('')); }
  refreshLabelDefinitions(): void { const vm = this.page(); if (vm.task) this.facade.loadProjectLabelDefinitions(vm.task.projectId, true); }
  createLabel(): void { const vm = this.page(); if (vm.task && this.newLabelName().trim().length <= 200 && vm.detail?.permissions.canManageLabelDefinitions) this.facade.createProjectLabel(vm.task.id, vm.task.projectId, this.newLabelName(), () => this.newLabelName.set('')); }
  editLabel(label: { id: string; name: string; description: string | null; sortKey: string }): void { this.editingLabelId.set(label.id); this.editingLabelName.set(label.name); this.editingLabelDescription.set(label.description ?? ''); this.editingLabelSortKey.set(label.sortKey); }
  cancelEditLabel(): void { this.editingLabelId.set(null); this.editingLabelName.set(''); this.editingLabelDescription.set(''); this.editingLabelSortKey.set(''); }
  saveLabel(label: { id: string; version: string }): void { const vm = this.page(); const sortKey = Number(this.editingLabelSortKey()); if (vm.task && this.editingLabelName().trim() && this.editingLabelName().trim().length <= 200 && this.editingLabelDescription().length <= 2000 && Number.isSafeInteger(sortKey) && sortKey >= 0) this.facade.updateProjectLabel(vm.task.id, vm.task.projectId, label.id, this.editingLabelName(), this.editingLabelDescription(), this.editingLabelSortKey(), label.version, () => this.cancelEditLabel()); }
  setLabelArchived(label: { id: string; version: string }, archived: boolean): void { const vm = this.page(); if (vm.task) this.facade.setProjectLabelArchived(vm.task.id, vm.task.projectId, label.id, label.version, archived); }
  checklistCompletedCount(): number { return this.page().detail?.checklist.filter((item) => item.isCompleted).length ?? 0; }
  isAppliedLabel(): boolean { const detail = this.page().detail; return !!detail?.labels.some((label) => label.id === this.selectedLabelId()); }
  removeFile(associationId: string): void { const vm = this.page(); if (vm.task && vm.detail) this.facade.removeFile(vm.task.id, associationId, vm.detail.taskVersion); }
  setSelectedAttachment(id: string | null): void { this.selectedAttachmentId.set(id ?? ''); }
  associateSelectedFile(): void { const vm = this.page(); const attachmentId = this.selectedAttachmentId(); if (vm.task && vm.detail && attachmentId) this.facade.associateFile(vm.task.id, attachmentId, vm.detail.taskVersion, () => this.selectedAttachmentId.set('')); }
  downloadFile(attachmentId: string, fileName: string): void { const taskId = this.taskId(); const projectId = this.projectId(); if (!taskId) return; this.files.downloadAttachment(attachmentId, fileName, { isCurrent: () => this.taskId() === taskId && this.projectId() === projectId, onState: (_, message) => this.fileDownloadMessage.set(message), onPermissionDenied: () => this.facade.retryTaskDetail(taskId) }); }

  private resetLocalTaskDraftState(): void {
    this.subtaskTitle.set(''); this.checklistText.set(''); this.editingChecklistId.set(null); this.editingChecklistText.set('');
    this.commentBody.set(''); this.commentImportant.set(false); this.editingCommentId.set(null); this.editingCommentBody.set(''); this.editingCommentImportant.set(false);
    this.selectedLabelId.set(''); this.newLabelName.set(''); this.cancelEditLabel(); this.selectedAttachmentId.set(''); this.fileDownloadMessage.set('');
    this.files.cancelAttachmentDownloads(); this.files.clearPickerFiles(); this.facade.setDetailEditing(false);
  }
}
