import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RealtimeFacade } from '../../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../../core/realtime/realtime.models';
import { TaskExecutionScopeComponent } from './task-execution-scope.component';

const PROJECT_ID = 'project-357';
const TASK_ID = 'task-357';

interface ScopeOptions {
  readonly projectWebEnabled?: boolean;
  readonly projectFilesEnabled?: boolean;
  readonly projectVersion?: number;
  readonly projectCanManage?: boolean;
  readonly taskWebEnabled?: boolean;
  readonly taskFilesEnabled?: boolean;
  readonly taskOrigin?: 'ProjectDefault' | 'TaskOverride';
  readonly taskOverrideVersion?: number | null;
  readonly taskCanManage?: boolean;
  readonly latestRun?: Record<string, unknown> | null;
}

describe('TaskExecutionScopeComponent', () => {
  let fixture: ComponentFixture<TaskExecutionScopeComponent>;
  let component: TaskExecutionScopeComponent;
  let http: HttpTestingController;
  let protectedClearer: (() => void) | undefined;
  let realtimeEvents: Subject<DurableRealtimeEvent>;

  beforeEach(async () => {
    realtimeEvents = new Subject<DurableRealtimeEvent>();
    protectedClearer = undefined;
    await TestBed.configureTestingModule({
      imports: [TaskExecutionScopeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeFacade,
          useValue: {
            durableEvents$: realtimeEvents.asObservable(),
            registerProtectedStateClearer: (_owner: string, clearer: () => void) => {
              protectedClearer = clearer;
              return () => { protectedClearer = undefined; };
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskExecutionScopeComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('projectId', PROJECT_ID);
    fixture.componentRef.setInput('taskId', TASK_ID);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('renders only the authorized effective policy and the fail-closed runtime notice', () => {
    const requests = expectScopeReads(http);
    expect(requests.project.request.withCredentials).toBe(true);
    expect(requests.task.request.withCredentials).toBe(true);
    flushScope(requests);
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-execution-scope-origin"]')?.textContent).toContain('Project default');
    expect(native.querySelector('[data-testid="task-execution-scope-web"]')?.textContent).toContain('Disabled');
    expect(native.querySelector('[data-testid="task-execution-scope-files"]')?.textContent).toContain('Disabled');
    expect(native.querySelector('[data-testid="task-execution-scope-future-only"]')?.textContent).toContain('future run requests only');
    expect(native.querySelector('[data-testid="task-execution-runtime-unavailable"]')?.textContent).toContain('No execution runtime is configured');
    expect(native.querySelectorAll('button').length).toBe(0);
    expect(native.textContent).not.toContain('Start execution');
  });

  it('saves the Project default with the server version and refreshes the Task-effective projection', () => {
    flushScope(expectScopeReads(http), {
      projectCanManage: true,
      taskCanManage: true,
      projectVersion: 4,
    });
    fixture.detectChanges();

    component.projectWebEnabled.set(true);
    component.projectFilesEnabled.set(true);
    component.saveProjectDefault();

    const save = http.expectOne(`/api/projects/${PROJECT_ID}/execution-scope`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.withCredentials).toBe(true);
    expect(save.request.body).toEqual({ webEnabled: true, projectFilesEnabled: true, expectedVersion: 4 });
    save.flush({ policy: { webEnabled: true, projectFilesEnabled: true }, version: 5, canManage: true });

    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectFilesEnabled: true,
      projectVersion: 5,
      taskWebEnabled: true,
      taskFilesEnabled: true,
      projectCanManage: true,
      taskCanManage: true,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Project default source settings saved.');
    expect(component.scope()?.task.effectivePolicy).toEqual({ webEnabled: true, projectFilesEnabled: true });
  });

  it('renders a locked policy-only snapshot without offering a start control', () => {
    flushScope(expectScopeReads(http), {
      latestRun: {
        status: 'RuntimeUnavailable',
        snapshotScopeOrigin: 'TaskOverride',
        snapshotWebEnabled: true,
        snapshotProjectFilesEnabled: false,
      },
    });
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-execution-snapshot"]')?.textContent).toContain('Task override');
    expect(native.querySelector('[data-testid="task-execution-snapshot"]')?.textContent).toContain('Unavailable - no execution was started.');
    expect(native.textContent).not.toContain('Start execution');
  });

  it('saves a complete Task override instead of merging it with the Project default', () => {
    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectCanManage: true,
      taskCanManage: true,
      taskWebEnabled: true,
      taskFilesEnabled: false,
    });
    fixture.detectChanges();

    component.setTaskEditorMode('override');
    component.overrideWebEnabled.set(false);
    component.overrideProjectFilesEnabled.set(true);
    component.saveTaskScope();

    const save = http.expectOne(`/api/tasks/${TASK_ID}/execution-scope-override`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ webEnabled: false, projectFilesEnabled: true, expectedVersion: 0 });
    save.flush(taskScopeResponse({
      taskOrigin: 'TaskOverride',
      taskOverrideVersion: 1,
      taskWebEnabled: false,
      taskFilesEnabled: true,
      taskCanManage: true,
    }));

    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectCanManage: true,
      taskOrigin: 'TaskOverride',
      taskOverrideVersion: 1,
      taskWebEnabled: false,
      taskFilesEnabled: true,
      taskCanManage: true,
    });
    fixture.detectChanges();

    expect(component.scope()?.task.origin).toBe('TaskOverride');
    expect(component.scope()?.task.effectivePolicy).toEqual({ webEnabled: false, projectFilesEnabled: true });
  });

  it('clears an existing Task override using its own optimistic version', () => {
    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectCanManage: true,
      taskOrigin: 'TaskOverride',
      taskOverrideVersion: 7,
      taskWebEnabled: false,
      taskFilesEnabled: true,
      taskCanManage: true,
    });
    fixture.detectChanges();

    component.setTaskEditorMode('inherit');
    component.saveTaskScope();

    const clear = http.expectOne(`/api/tasks/${TASK_ID}/execution-scope-override`);
    expect(clear.request.method).toBe('DELETE');
    expect(clear.request.withCredentials).toBe(true);
    expect(clear.request.body).toEqual({ expectedVersion: 7 });
    clear.flush(taskScopeResponse({ taskOrigin: 'ProjectDefault', taskCanManage: true, taskWebEnabled: true }));

    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectCanManage: true,
      taskOrigin: 'ProjectDefault',
      taskCanManage: true,
      taskWebEnabled: true,
    });
    fixture.detectChanges();

    expect(component.scope()?.task.origin).toBe('ProjectDefault');
    expect(component.scope()?.task.taskOverridePolicy).toBeNull();
  });

  it('cancels and removes the protected projection synchronously when Realtime clears the scope', () => {
    flushScope(expectScopeReads(http), { projectCanManage: true, taskCanManage: true });
    fixture.detectChanges();
    expect(component.scope()).not.toBeNull();

    protectedClearer?.();
    fixture.detectChanges();

    expect(component.scope()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('unavailable in the current session');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="task-execution-scope-summary"]')).toBeNull();
  });

  it('redacts a failed response instead of rendering server-provided source details', () => {
    const requests = expectScopeReads(http);
    requests.task.flush(
      { error: { message: 'https://private.example/source content must not be shown' } },
      { status: 500, statusText: 'Server Error' },
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Source-scope settings could not be loaded. Try again.');
    expect(text).not.toContain('private.example');
    expect(text).not.toContain('source content must not be shown');
  });

  it('clears a previously authorized projection when an authoritative refresh is denied', () => {
    flushScope(expectScopeReads(http), { projectCanManage: true, taskCanManage: true });
    fixture.detectChanges();
    expect(component.scope()).not.toBeNull();

    realtimeEvents.next(realtimeEvent('Projects.TaskChanged.v1', TASK_ID));
    const refresh = expectScopeReads(http);
    refresh.task.flush(
      { error: { message: 'authorization details must not remain visible' } },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(component.scope()).toBeNull();
    expect(component.canManageAnything()).toBe(false);
    expect(native.querySelector('[data-testid="task-execution-scope-summary"]')).toBeNull();
    expect(native.textContent).toContain('unavailable in the current session');
    expect(native.textContent).not.toContain('authorization details');
  });

  it('refetches the authoritative projection for a matching Project or Task invalidation without reading event payload data', () => {
    flushScope(expectScopeReads(http), { projectCanManage: true, taskCanManage: true });
    fixture.detectChanges();

    realtimeEvents.next(realtimeEvent('Projects.ProjectChanged.v1', PROJECT_ID));
    expect(component.scope()).not.toBeNull();
    expect(component.activeRead()).toBe(true);
    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectCanManage: true,
      taskWebEnabled: true,
      taskCanManage: true,
    });
    fixture.detectChanges();
    expect(component.scope()?.task.effectivePolicy.webEnabled).toBe(true);

    realtimeEvents.next(realtimeEvent('Projects.TaskChanged.v1', TASK_ID));
    flushScope(expectScopeReads(http), {
      projectWebEnabled: true,
      projectFilesEnabled: true,
      projectCanManage: true,
      taskWebEnabled: true,
      taskFilesEnabled: true,
      taskCanManage: true,
    });
    fixture.detectChanges();
    expect(component.scope()?.task.effectivePolicy.projectFilesEnabled).toBe(true);
  });
});

function expectScopeReads(http: HttpTestingController): { project: TestRequest; task: TestRequest } {
  return {
    project: http.expectOne(`/api/projects/${PROJECT_ID}/execution-scope`),
    task: http.expectOne(`/api/tasks/${TASK_ID}/execution-scope`),
  };
}

function flushScope(
  requests: { project: TestRequest; task: TestRequest },
  options: ScopeOptions = {},
): void {
  requests.project.flush(projectScopeResponse(options));
  requests.task.flush(taskScopeResponse(options));
}

function projectScopeResponse(options: ScopeOptions): Record<string, unknown> {
  return {
    policy: {
      webEnabled: options.projectWebEnabled ?? false,
      projectFilesEnabled: options.projectFilesEnabled ?? false,
    },
    version: options.projectVersion ?? 1,
    canManage: options.projectCanManage ?? false,
  };
}

function taskScopeResponse(options: ScopeOptions): Record<string, unknown> {
  const origin = options.taskOrigin ?? 'ProjectDefault';
  const effectivePolicy = {
    webEnabled: options.taskWebEnabled ?? options.projectWebEnabled ?? false,
    projectFilesEnabled: options.taskFilesEnabled ?? options.projectFilesEnabled ?? false,
  };
  const hasOverride = origin === 'TaskOverride';
  return {
    effectivePolicy,
    origin,
    projectDefaultVersion: options.projectVersion ?? 1,
    taskOverrideVersion: hasOverride ? options.taskOverrideVersion ?? 1 : null,
    taskOverridePolicy: hasOverride ? effectivePolicy : null,
    canManage: options.taskCanManage ?? false,
    latestRun: options.latestRun ?? null,
    changesApplyTo: 'FutureRunsOnly',
  };
}

function realtimeEvent(
  eventType: DurableRealtimeEvent['eventType'],
  aggregateId: string,
): DurableRealtimeEvent {
  return {
    eventId: `event-${aggregateId}`,
    eventType,
    payloadSchemaVersion: 1,
    occurredAt: '2026-08-25T00:00:00.000Z',
    tenantId: 'tenant-357',
    aggregateType: eventType === 'Projects.ProjectChanged.v1' ? 'Project' : 'TaskItem',
    aggregateId,
    aggregateVersion: 2,
    actor: { actorType: 'User', actorId: 'actor-357' },
    correlationId: null,
    causationId: null,
    payload: { ignored: 'payload is never read by this component' },
  };
}
