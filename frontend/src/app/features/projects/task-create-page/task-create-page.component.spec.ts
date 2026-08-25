import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { TaskCreateOptions } from '../task-create.api';
import {
  EMPTY_TASK_CREATE_STATE,
  TaskCreateFacade,
  TaskCreateOptionsViewModel,
  TaskCreateViewModel,
} from '../task-create.facade';
import { TaskCreatePageComponent } from './task-create-page.component';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const milestoneId = '33333333-3333-4333-8333-333333333333';
const assigneeId = '44444444-4444-4444-8444-444444444444';

const options: TaskCreateOptions = {
  requestId: 'task-create-options-200',
  projectId,
  workspaceId,
  projectTitle: 'Evidence Project',
  canCreateTask: true,
  canManageProject: true,
  milestones: [{ id: milestoneId, title: 'Evidence milestone' }],
  assignees: [{ userId: assigneeId, displayName: 'Project member' }],
  projectScope: {
    policy: { webEnabled: false, projectFilesEnabled: true },
    version: 1,
    canSetTaskOverride: true,
  },
};

class TaskCreateFacadeStub {
  readonly options = signal<TaskCreateOptionsViewModel>({
    status: 'ready',
    projectId,
    data: options,
    requestId: options.requestId,
  });
  readonly createState = signal<TaskCreateViewModel>(EMPTY_TASK_CREATE_STATE);
  readonly load = vi.fn().mockResolvedValue(true);
  readonly release = vi.fn();
  readonly resetCreatePresentation = vi.fn();
  readonly createTask = vi.fn().mockResolvedValue(false);
  readonly retryOptions = vi.fn().mockResolvedValue(true);
  readonly retryCreatedTaskNavigation = vi.fn().mockResolvedValue(true);
}

describe('TaskCreatePageComponent', () => {
  let fixture: ComponentFixture<TaskCreatePageComponent>;
  let component: TaskCreatePageComponent;
  let facade: TaskCreateFacadeStub;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    facade = new TaskCreateFacadeStub();
    router = { navigate: vi.fn().mockResolvedValue(true) };
    params = new BehaviorSubject(convertToParamMap({ projectId }));
    await TestBed.configureTestingModule({
      imports: [TaskCreatePageComponent],
      providers: [
        { provide: TaskCreateFacade, useValue: facade },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TaskCreatePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('renders only server-authorized named choices and a Create-only source-scope form', () => {
    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';

    expect(facade.load).toHaveBeenCalledWith(projectId);
    expect(text).toContain('Evidence Project');
    expect(text).toContain('Evidence milestone');
    expect(text).toContain('Project member');
    expect(text).toContain('does not start a runtime or retrieve sources');
    expect(root.textContent).not.toContain(projectId);
    expect(root.textContent).not.toContain(workspaceId);
    expect(root.querySelector('[name="projectId"], [name="workspaceId"], [name="webUrl"], [name="provider"]')).toBeNull();
    expect([...root.querySelectorAll('button')].map((button) => button.textContent?.trim())).not.toContain('Start');
    expect(root.querySelector<HTMLInputElement>('#task-create-sourceScopeMode-inherit')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('#task-create-sourceScopeMode-override')).not.toBeNull();
    expect(root.querySelectorAll('#task-create-sourceScopeMode-inherit')).toHaveLength(1);
    expect(root.querySelectorAll('#task-create-sourceScopeMode-override')).toHaveLength(1);
  });

  it('keeps override controls server-manager-gated and makes an empty assignee authority explicit', async () => {
    facade.options.set({
      status: 'ready',
      projectId,
      data: {
        ...options,
        canManageProject: false,
        assignees: [],
        projectScope: { ...options.projectScope, canSetTaskOverride: false },
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="task-create-source-override"]')).toBeNull();
    expect(root.querySelector('[data-testid="task-create-scope-controls"]')).toBeNull();
    expect(root.querySelector('[data-testid="task-create-primary-assignee"]')).toBeNull();
    expect(root.textContent).toContain('created unassigned');
    expect(root.textContent).toContain('Only a Project manager can choose a Task-specific policy.');
  });

  it('focuses linked Milestone, reusable Brief, and source-scope errors on real controls', async () => {
    facade.createState.set({
      status: 'error',
      fieldErrors: [
        { field: 'milestoneId', message: 'Choose an available Milestone.' },
        { field: 'goal', message: 'Goal is too long.' },
        { field: 'sourceScopeMode', message: 'Task override is not allowed.' },
      ],
      message: 'Check the Task details.',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const summary = root.querySelector<HTMLElement>('[data-testid="task-create-error-summary"]');
    expect(summary).not.toBeNull();
    expect(summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-milestone"]')).not.toBeNull();
    expect(summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-goal"]')).not.toBeNull();
    expect(summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-sourceScopeMode"]')).not.toBeNull();

    summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-milestone"]')?.click();
    expect(document.activeElement).toBe(root.querySelector('#task-create-milestone'));
    summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-goal"]')?.click();
    expect(document.activeElement).toBe(root.querySelector('#task-create-goal'));
    summary?.querySelector<HTMLAnchorElement>('a[href="#task-create-sourceScopeMode"]')?.click();
    expect(document.activeElement).toBe(root.querySelector('#task-create-sourceScopeMode-inherit'));
  });

  it('keeps a tab-local unsent draft until explicit discard and never submits on Cancel', () => {
    component.form.controls.title.setValue('Local evidence task');
    // Programmatic FormControl writes are not user edits, so model the dirty
    // state that an actual keyboard entry produces before checking the draft UI.
    component.form.controls.title.markAsDirty();
    component.form.markAsDirty();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="task-create-unsent-draft"]')?.textContent).toContain(
      'This form exists only in this browser tab.',
    );
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Cancel')
      ?.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="task-create-discard-confirmation"]')).not.toBeNull();
    expect(facade.createTask).not.toHaveBeenCalled();
  });

  it('clears a no-longer-authorized hidden assignee choice after an options refresh', async () => {
    component.form.controls.primaryAssigneeUserId.setValue(assigneeId);
    facade.options.set({
      status: 'ready',
      projectId,
      data: { ...options, assignees: [] },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.form.controls.primaryAssigneeUserId.value).toBe('');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="task-create-options-changed"]')?.textContent,
    ).toContain('Primary assignee');
  });

  it('does not duplicate a submit while the authoritative create state is pending', () => {
    component.form.controls.title.setValue('Evidence review');
    facade.createState.set({ status: 'submitting', fieldErrors: [] });
    fixture.detectChanges();

    component.submit();
    component.submit();
    expect(facade.createTask).not.toHaveBeenCalled();
  });

  it('abandons committed navigation recovery before returning to the Project', () => {
    facade.createState.set({
      status: 'committedPendingNavigation',
      fieldErrors: [],
      requestId: 'task-create-201',
      createdTaskId: '55555555-5555-4555-8555-555555555555',
    });
    fixture.detectChanges();

    component.returnToProject();

    expect(facade.release).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/projects', projectId]);
  });

  it('hides the editable form when protected options are cleared or denied', async () => {
    facade.options.set({
      status: 'denied',
      projectId,
      message: 'Task creation is not available for this Project.',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="task-create-form"]')).toBeNull();
    expect(root.textContent).toContain('Task creation is not available for this Project.');
  });
});
