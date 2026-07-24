import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { FilesFacade } from '../../files/files.facade';
import { ProjectsFacade } from '../projects.facade';
import { TaskDetailPageComponent } from './task-detail-page.component';

describe('TaskDetailPageComponent local edit state', () => {
  let fixture: ComponentFixture<TaskDetailPageComponent>;
  let component: TaskDetailPageComponent;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const setDetailEditing = vi.fn();
  const reloadTaskAfterConflict = vi.fn();

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ projectId: 'project-a', taskId: 'task-a' }));
    const sections = { detail: { status: 'idle' }, subtasks: { status: 'idle' }, checklist: { status: 'idle' }, comments: { status: 'idle' }, labels: { status: 'idle' }, watch: { status: 'idle' }, files: { status: 'idle' } } as const;
    await TestBed.configureTestingModule({
      imports: [TaskDetailPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: ProjectsFacade, useValue: {
          getTaskDetail: () => ({ status: 'empty', detailState: 'ready', detailSectionState: sections.detail, dependencies: [], capabilities: [], transitionNote: { owner: 'backendAuthoritativeDuringApiWiring', message: '' } }),
          getTaskMutationState: () => ({ status: 'idle' }), getDetailSectionState: (section: keyof typeof sections) => sections[section],
          setDetailEditing, ensureTaskDetail: vi.fn(), releaseTaskDetail: vi.fn(), clearTaskMutationState: vi.fn(), reloadTaskAfterConflict
        } },
        { provide: FilesFacade, useValue: { pickerStateForTask: signal({ status: 'idle', workspaceId: null, files: [], page: 1, pageSize: 20, totalCount: 0, hasMore: false }), clearPickerFiles: vi.fn(), cancelAttachmentDownloads: vi.fn(), loadPickerFilesForWorkspace: vi.fn(), loadMorePickerFiles: vi.fn(), retryPickerFiles: vi.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TaskDetailPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    setDetailEditing.mockClear();
  });

  it('notifies the facade while a comment has an unsaved value', () => {
    component.commentBody.set('Draft comment');
    fixture.detectChanges();
    expect(setDetailEditing).toHaveBeenLastCalledWith(true);
  });

  it('clears local drafts and editing state when the task route changes', () => {
    component.commentBody.set('Draft comment');
    fixture.detectChanges();
    params.next(convertToParamMap({ projectId: 'project-a', taskId: 'task-b' }));
    fixture.detectChanges();
    expect(component.commentBody()).toBe('');
    expect(setDetailEditing).toHaveBeenLastCalledWith(false);
  });

  it('treats an empty edited comment and an important-only edit as dirty, then resets it on cancel', () => {
    component.editComment({ id: 'comment-1', body: 'Original', isImportant: false });
    expect(component.detailEditing()).toBe(false);
    component.editingCommentBody.set('');
    expect(component.detailEditing()).toBe(true);
    component.editingCommentBody.set('Original');
    component.editingCommentImportant.set(true);
    expect(component.detailEditing()).toBe(true);
    component.editingCommentImportant.set(false);
    expect(component.detailEditing()).toBe(false);
    component.cancelEditComment();
    expect(component.detailEditing()).toBe(false);
  });

  it('resets original comment state when the task route changes', () => {
    component.editComment({ id: 'comment-1', body: 'Original', isImportant: false });
    component.editingCommentBody.set('Changed');
    expect(component.detailEditing()).toBe(true);
    params.next(convertToParamMap({ projectId: 'project-a', taskId: 'task-b' }));
    fixture.detectChanges();
    expect(component.editingCommentId()).toBeNull();
    expect(component.detailEditing()).toBe(false);
  });

  it('delegates an explicit conflict reload without changing ordinary cancel behavior', () => {
    component.reloadTaskAfterConflict();
    expect(reloadTaskAfterConflict).toHaveBeenCalledWith('task-a');
  });

  it('notifies the facade that editing ended on destroy', () => {
    component.commentBody.set('Draft comment');
    fixture.detectChanges();
    fixture.destroy();
    expect(setDetailEditing).toHaveBeenLastCalledWith(false);
  });
});
