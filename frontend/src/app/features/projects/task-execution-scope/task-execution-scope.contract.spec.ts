import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskExecutionScopeComponent } from './task-execution-scope.component';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';

describe('TaskExecutionScopeComponent canonical source-scope presentation', () => {
  let fixture: ComponentFixture<TaskExecutionScopeComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskExecutionScopeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskExecutionScopeComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('projectId', PROJECT_ID);
    fixture.componentRef.setInput('taskId', TASK_ID);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('keeps the effective next-run scope visible and distinguishes Allow, Exclude, Restrict, and Prioritize', () => {
    http.expectOne(`/api/projects/${PROJECT_ID}/execution-scope`).flush({
      policy: { webEnabled: false, projectFilesEnabled: false },
      version: 6,
      canManage: true,
    });
    http.expectOne(`/api/tasks/${TASK_ID}/execution-scope`).flush({
      effectivePolicy: { webEnabled: true, projectFilesEnabled: false },
      origin: 'TaskOverride',
      projectDefaultVersion: 6,
      taskOverrideVersion: 3,
      taskOverridePolicy: { webEnabled: true, projectFilesEnabled: false },
      canManage: true,
      latestRun: {
        id: '33333333-3333-3333-3333-333333333333',
        status: 'RuntimeUnavailable',
        failureCode: 'TASK_EXECUTION_RUNTIME_UNAVAILABLE',
        requestedAtUtc: '2026-08-29T00:00:00Z',
        finishedAtUtc: '2026-08-29T00:00:01Z',
        snapshotSchemaVersion: 1,
        snapshotScopeOrigin: 'ProjectDefault',
        snapshotProjectScopeVersion: 5,
        snapshotTaskOverrideVersion: null,
        snapshotWebEnabled: false,
        snapshotProjectFilesEnabled: true,
      },
      changesApplyTo: 'nextRun',
    });
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-execution-scope-origin"]')?.textContent).toContain('Task override');
    expect(native.querySelector('[data-testid="task-execution-scope-web"]')?.textContent).toContain('Allow');
    expect(native.querySelector('[data-testid="task-execution-scope-files"]')?.textContent).toContain('Exclude');

    const terms = native.querySelector('[data-testid="task-execution-scope-terms"]')?.textContent ?? '';
    expect(terms).toContain('Allow');
    expect(terms).toContain('The source kind is eligible under the active scope.');
    expect(terms).toContain('Restrict');
    expect(terms).toContain('Only explicitly named members');
    expect(terms).toContain('Prioritize');
    expect(terms).toContain('preferred while the broader allowed source remains eligible');
    expect(native.querySelector('[data-testid="task-execution-scope-rule-limit"]')?.textContent).toContain('not configured by the current source-scope contract');

    expect(native.querySelector('[data-testid="task-execution-scope-sites"]')?.textContent).toContain('Not available');
    expect(native.querySelector('[data-testid="task-execution-scope-apps"]')?.textContent).toContain('Not available');
    expect(native.querySelector('[data-testid="task-execution-scope-future-only"]')?.textContent).toContain('current next-run policy');
    expect(native.querySelector('[data-testid="task-execution-runtime-unavailable"]')?.textContent).toContain('Execution provider: None');
    expect(native.querySelector('.task-execution-scope__editor-link')?.getAttribute('href')).toBe('#task-execution-scope-editor');

    const snapshot = native.querySelector('[data-testid="task-execution-snapshot"]')?.textContent ?? '';
    expect(snapshot).toContain('Project default');
    expect(snapshot).toContain('Web at request');
    expect(snapshot).toContain('Exclude');
    expect(snapshot).toContain('Project files at request');
    expect(snapshot).toContain('Allow');
    expect(snapshot).toContain('Unavailable - no execution was started.');
  });

  it('uses only generic unsupported capability labels and exposes no source inventory', () => {
    http.expectOne(`/api/projects/${PROJECT_ID}/execution-scope`).flush({
      policy: { webEnabled: false, projectFilesEnabled: false },
      version: 0,
      canManage: false,
    });
    http.expectOne(`/api/tasks/${TASK_ID}/execution-scope`).flush({
      effectivePolicy: { webEnabled: false, projectFilesEnabled: false },
      origin: 'ProjectDefault',
      projectDefaultVersion: 0,
      taskOverrideVersion: null,
      taskOverridePolicy: null,
      canManage: false,
      latestRun: null,
      changesApplyTo: 'nextRun',
    });
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    const text = native.textContent ?? '';
    expect(text).toContain('Specific sites');
    expect(text).toContain('Connected apps');
    expect(text).not.toContain('private.example');
    expect(text).not.toContain('file-123');
    expect(text).not.toContain('3 sources');
    expect(native.querySelector('.task-execution-scope__editor-link')).toBeNull();
  });
});
