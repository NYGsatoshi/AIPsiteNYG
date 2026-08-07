import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import { RealtimeCatchUpContext, RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { AipKanbanMoveRequest } from '../../shared/ui/contracts/aip-complex-adapter.contracts';
import { ProjectKanbanCard } from './project-kanban.models';
import { snapshotDto } from './project-kanban.test-data';
import { ganttSnapshotDto, viewerGanttSnapshotDto } from './project-detail-gantt.test-data';
import { ProjectDetailFacade } from './project-detail.facade';
import { ProjectGanttItemDto, ProjectGanttSnapshotDto } from './projects.api';

describe('ProjectDetailFacade canonical Kanban', () => {
  let facade: ProjectDetailFacade;
  let http: HttpTestingController;
  let flags: FrontendFeatureFlagsService;
  let events: Subject<DurableRealtimeEvent>;
  let catchUp: ((context?: RealtimeCatchUpContext) => void) | undefined;
  let connectionState: WritableSignal<'Connected' | 'Degraded'>;

  beforeEach(() => {
    events = new Subject<DurableRealtimeEvent>();
    catchUp = undefined;
    connectionState = signal<'Connected' | 'Degraded'>('Connected');
    const realtime = {
      durableEvents$: events.asObservable(),
      connectionState,
      registerSubscription: () => () => undefined,
      registerCatchUp: (_owner: string, callback: (context: RealtimeCatchUpContext) => void) => {
        catchUp = (context = { deniedOwners: new Set<string>() }) => callback(context);
        return () => { catchUp = undefined; };
      }
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeFacade, useValue: realtime }
      ]
    });
    flags = TestBed.inject(FrontendFeatureFlagsService);
    facade = TestBed.inject(ProjectDetailFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    facade.release();
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the canonical snapshot independently from the legacy Task list', () => {
    flushLoad();

    expect(facade.view().kanban.status).toBe('ready');
    expect(facade.view().kanban.snapshot?.cards[0].summary).toBe('Canonical card');
    expect(facade.view().tasks).toEqual([]);
    expect(facade.view().schedule.status).toBe('ready');
    expect(facade.view().schedule.snapshot?.calendar.timeZone).toBe('Asia/Tokyo');
    expect(facade.view().schedule.snapshot?.unscheduledItems[0].taskId).toBe('task-3');
  });

  it('does not let a held initial snapshot overwrite newer realtime HTTP reconciliation', async () => {
    facade.load('project-1');
    http.expectOne('/api/projects/project-1').flush({
      id: 'project-1',
      title: 'Project',
      status: 1,
      startDate: null,
      endDate: null,
      uiPermissions: { canCreateTask: true }
    });
    const initialTasks = http.expectOne('/api/projects/project-1/tasks');
    const initialKanban = http.expectOne('/api/projects/project-1/kanban');
    const initialGantt = http.expectOne('/api/projects/project-1/gantt');
    const initialWorkload = http.expectOne('/api/projects/project-1/workload');
    const initialMembers = http.expectOne('/api/projects/project-1/members');

    events.next(realtimeEvent(4));
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      snapshotDto({ cards: [{ ...snapshotDto().cards![0], version: 4 }] })
    );
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 })
    );

    initialTasks.flush({ items: [] });
    initialKanban.flush(snapshotDto());
    initialWorkload.flush({ members: [] });
    initialMembers.flush([]);
    initialGantt.flush(ganttSnapshotDto());

    expect(facade.view().status).toBe('ready');
    expect(facade.view().kanban.snapshot?.cards[0].version).toBe(4);
    expect(facade.view().schedule.snapshot?.scheduledItems[0].version).toBe(4);
  });

  it('optimistically updates a schedule, accepts the flat command result, and refetches the authoritative snapshot', () => {
    flushLoad();

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });

    expect(facade.view().schedule.snapshot?.scheduledItems[0].plannedStartDate).toBe('2026-07-02');
    expect(facade.view().schedule.busyItemId).toBe('task-1');
    const update = http.expectOne('/api/tasks/task-1/schedule');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3
    });
    update.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });

    expect(facade.view().schedule.snapshot?.scheduledItems[0].version).toBe(4);
    expect(facade.view().schedule.focusItemId).toBe('task-1');
    const authoritative = withGanttTask(ganttSnapshotDto(), 'task-1', {
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      version: 4
    });
    http.expectOne('/api/projects/project-1/gantt').flush(authoritative);
    expect(facade.view().schedule.feedback).toContain('Schedule saved');
    expect(facade.view().schedule.busyItemId).toBeNull();
  });

  it('replaces resolved item warnings with the complete authoritative command warning set', () => {
    const initial = withGanttTask(ganttSnapshotDto(), 'task-1', {
      warnings: [{
        code: 'DEPENDENCY_VIOLATION',
        message: 'The predecessor currently finishes after this Task starts.',
        severity: 'Warning',
        targetType: 'Dependency',
        targetId: 'dependency-1',
        field: 'plannedStartDate',
        blocking: false
      }]
    });
    flushLoad(true, initial);

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectOne('/api/tasks/task-1/schedule').flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });

    expect(facade.view().schedule.snapshot?.scheduledItems[0].warnings).toEqual([]);
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', {
        plannedStartDate: '2026-07-02',
        plannedEndDate: '2026-07-11',
        version: 4
      })
    );
  });

  it('reconciles mixed Task and dependency command warnings before the authoritative refetch', () => {
    flushLoad();

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-06-29',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectOne('/api/tasks/task-1/schedule').flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-06-29',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: [{
        code: 'DEPENDENCY_VIOLATION',
        message: 'The predecessor finishes after the successor starts.',
        severity: 'Warning',
        targetType: 'Dependency',
        targetId: 'dependency-1',
        field: 'plannedStartDate',
        blocking: false
      }]
    });

    const optimistic = facade.view().schedule.snapshot!;
    expect(optimistic.dependencies[0].warnings[0].code).toBe('DEPENDENCY_VIOLATION');
    expect(optimistic.scheduledItems[0].warnings[0].code).toBe('DEPENDENCY_VIOLATION');
    expect(optimistic.warnings.some((warning) => warning.code === 'DEPENDENCY_VIOLATION')).toBe(true);

    const authoritative = withGanttTask(ganttSnapshotDto(), 'task-1', {
      plannedStartDate: '2026-06-29',
      plannedEndDate: '2026-07-11',
      version: 4
    });
    http.expectOne('/api/projects/project-1/gantt').flush(authoritative);
  });

  it('accepts an authoritative same-version response for a no-op progress command', () => {
    flushLoad();

    facade.applyGanttEdit({
      kind: 'progress',
      taskId: 'task-1',
      progressPercent: 25,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectOne('/api/tasks/task-1/progress').flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-01',
      plannedEndDate: '2026-07-10',
      milestoneDate: null,
      progressPercent: 25,
      version: 3,
      warnings: []
    });

    expect(facade.view().schedule.status).toBe('ready');
    expect(facade.view().schedule.error).toBeUndefined();
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());
  });

  it('rolls a validation failure back and preserves nested safe diagnostics', () => {
    flushLoad();
    const before = facade.view().schedule.snapshot;

    facade.applyGanttEdit({
      kind: 'progress',
      taskId: 'task-1',
      progressPercent: 40,
      expectedVersion: 3,
      source: 'form'
    });
    expect(facade.view().schedule.snapshot?.scheduledItems[0].progressPercent).toBe(40);
    http.expectOne('/api/tasks/task-1/progress').flush(
      {
        requestId: 'gantt-validation-1',
        error: {
          code: 'GANTT_INVALID_PROGRESS',
          message: 'Progress conflicts with the Stage.',
          target: 'progressPercent',
          details: [{
            code: 'STAGE_PROGRESS_CONFLICT',
            message: 'Progress conflicts with completion state.',
            target: 'progressPercent'
          }],
          redactionApplied: true
        }
      },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(facade.view().schedule.status).toBe('rollback');
    expect(facade.view().schedule.snapshot).toBe(before);
    expect(facade.view().schedule.error).toMatchObject({
      code: 'GANTT_INVALID_PROGRESS',
      requestId: 'gantt-validation-1',
      target: 'progressPercent',
      redactionApplied: true
    });
    expect(facade.view().schedule.error?.details[0].code).toBe('STAGE_PROGRESS_CONFLICT');
  });

  it('preserves a safe edit intent on conflict, refetches, and retries only on explicit user action', () => {
    flushLoad();
    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectOne('/api/tasks/task-1/schedule').flush(
      {
        requestId: 'gantt-conflict-1',
        error: { code: 'TASK_STALE_VERSION', message: 'Task changed.', target: 'expectedVersion', details: [], redactionApplied: true }
      },
      { status: 409, statusText: 'Conflict' }
    );

    expect(facade.view().schedule.status).toBe('conflict');
    expect(facade.view().schedule.preservedIntent).toMatchObject({
      kind: 'schedule',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      expectedVersion: 3
    });
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 5 })
    );
    expect(facade.view().schedule.preservedIntent).not.toBeNull();

    facade.retryPreservedScheduleIntent();
    const retry = http.expectOne('/api/tasks/task-1/schedule');
    expect(retry.request.body).toMatchObject({
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      expectedVersion: 5
    });
    retry.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      progressPercent: 25,
      version: 6,
      warnings: []
    });
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', {
        plannedStartDate: '2026-07-03',
        plannedEndDate: '2026-07-12',
        version: 6
      })
    );
    expect(facade.view().schedule.preservedIntent).toBeNull();
  });

  it('does not send schedule commands for a viewer even when called directly', () => {
    flushLoad(true, viewerGanttSnapshotDto());

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'pointer'
    });

    http.expectNone('/api/tasks/task-1/schedule');
    expect(facade.view().schedule.busyItemId).toBeNull();
  });

  it('adds and removes FS dependencies through the canonical PR02 routes and refetches after each mutation', () => {
    flushLoad();

    facade.applyGanttEdit({
      kind: 'addDependency',
      predecessorTaskId: 'task-3',
      successorTaskId: 'task-1',
      type: 'finishToStart',
      expectedVersion: 3,
      source: 'form'
    });
    const add = http.expectOne('/api/tasks/task-1/dependencies');
    expect(add.request.body).toEqual({
      predecessorTaskId: 'task-3',
      dependencyType: 'FinishToStart',
      expectedVersion: 3
    });
    expect(facade.view().schedule.snapshot?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyId: expect.stringMatching(/^local-pending:/),
          predecessorTaskId: 'task-3',
          successorTaskId: 'task-1',
          type: 'finishToStart',
          editable: false,
          version: 3
        })
      ])
    );
    add.flush({
      id: 'dependency-2',
      predecessorTaskId: 'task-3',
      successorTaskId: 'task-1',
      dependencyType: 'FinishToStart',
      createdAt: '2026-07-30T00:00:00Z',
      version: 4,
      editable: true,
      warnings: []
    });
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 })
    );

    const latest = withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 });
    facade.applyGanttEdit({
      kind: 'removeDependency',
      dependencyId: 'dependency-1',
      successorTaskId: 'task-1',
      expectedVersion: 4,
      source: 'form'
    });
    expect(facade.view().schedule.snapshot?.dependencies).toEqual([]);
    const remove = http.expectOne((request) =>
      request.url === '/api/tasks/task-1/dependencies/dependency-1' &&
      request.params.get('expectedVersion') === '4');
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ status: 'OK' });
    http.expectOne('/api/projects/project-1/gantt').flush({
      ...latest,
      dependencies: [],
      scheduledItems: latest.scheduledItems.map((item) =>
        item.taskId === 'task-1' ? { ...item, version: 5 } : item)
    });
    expect(facade.view().schedule.snapshot?.dependencies).toEqual([]);
  });

  it('rolls an optimistic dependency addition back when the authoritative command rejects it', () => {
    flushLoad();
    const before = facade.view().schedule.snapshot!;

    facade.applyGanttEdit({
      kind: 'addDependency',
      predecessorTaskId: 'task-3',
      successorTaskId: 'task-1',
      type: 'finishToStart',
      expectedVersion: 3,
      source: 'form'
    });

    expect(facade.view().schedule.snapshot?.dependencies).toHaveLength(before.dependencies.length + 1);
    http.expectOne('/api/tasks/task-1/dependencies').flush(
      {
        requestId: 'dependency-rejected-1',
        error: {
          code: 'TASK_DEPENDENCY_CYCLE',
          message: 'The dependency would create a cycle.',
          target: 'predecessorTaskId',
          details: [],
          redactionApplied: true
        }
      },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(facade.view().schedule.status).toBe('rollback');
    expect(facade.view().schedule.snapshot).toBe(before);
    expect(facade.view().schedule.error).toMatchObject({
      code: 'TASK_DEPENDENCY_CYCLE',
      requestId: 'dependency-rejected-1'
    });
  });

  it('allows an authorized dependency edge to target a derived parent Task', () => {
    const dto = ganttSnapshotDto();
    const parentPermissions = {
      ...dto.permissions,
      canEditSchedule: false,
      canEditProgress: false,
      canClearSchedule: false
    };
    const parentSnapshot: ProjectGanttSnapshotDto = {
      ...dto,
      scheduledItems: dto.scheduledItems.map((item) =>
        item.taskId === 'task-1'
          ? {
              ...item,
              progressIsDerived: true,
              scheduleEditPermissions: parentPermissions,
              warnings: [{
                code: 'PARENT_DERIVED',
                message: 'Dates and progress are derived from child Tasks.',
                severity: 'Info',
                targetType: 'Task',
                targetId: 'task-1',
                field: null,
                blocking: false
              }]
            }
          : { ...item, parentTaskId: 'task-1' })
    };
    flushLoad(true, parentSnapshot);

    facade.applyGanttEdit({
      kind: 'addDependency',
      predecessorTaskId: 'task-3',
      successorTaskId: 'task-1',
      type: 'finishToStart',
      expectedVersion: 3,
      source: 'form'
    });

    http.expectOne('/api/tasks/task-1/dependencies').flush({
      id: 'dependency-parent',
      predecessorTaskId: 'task-3',
      successorTaskId: 'task-1',
      dependencyType: 'FinishToStart',
      createdAt: '2026-07-30T00:00:00Z',
      version: 4,
      editable: true,
      warnings: []
    });
    http.expectOne('/api/projects/project-1/gantt').flush(parentSnapshot);
  });

  it('keeps the HTTP schedule usable in degraded realtime mode', () => {
    flushLoad();
    connectionState.set('Degraded');

    expect(facade.view().schedule.status).toBe('degraded');
    expect(facade.view().schedule.snapshot?.scheduledItems[0].taskId).toBe('task-1');
    facade.retrySchedule();
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());
    expect(facade.view().schedule.snapshot).not.toBeNull();
  });

  it('ignores stale realtime hints and coalesces duplicate authoritative refetches', async () => {
    flushLoad();

    events.next(realtimeEvent(3));
    await Promise.resolve();
    http.expectNone((request) => request.url === '/api/projects/project-1/kanban');
    http.expectNone('/api/projects/project-1/gantt');

    events.next(realtimeEvent(4));
    events.next({ ...realtimeEvent(4), eventId: 'duplicate-event-4' });
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      snapshotDto({ cards: [{ ...snapshotDto().cards![0], version: 4 }] })
    );
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 })
    );
  });

  it('coalesces invalidations arriving during an HTTP snapshot into one follow-up refetch', async () => {
    flushLoad();
    facade.retrySchedule();
    const firstSchedule = http.expectOne('/api/projects/project-1/gantt');

    events.next(realtimeEvent(4));
    events.next({ ...realtimeEvent(5), eventId: 'event-5' });
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      snapshotDto({ cards: [{ ...snapshotDto().cards![0], version: 5 }] })
    );
    http.expectNone('/api/projects/project-1/gantt');

    firstSchedule.flush(withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 }));
    await Promise.resolve();
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 5 })
    );
    http.expectNone('/api/projects/project-1/gantt');
    expect(facade.view().schedule.snapshot?.scheduledItems[0].version).toBe(5);
  });

  it('queues schedule invalidation while a schedule form is active and refetches after it closes', async () => {
    flushLoad();
    facade.setScheduleInteractionActive(true);

    events.next(realtimeEvent(4));
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectNone('/api/projects/project-1/gantt');
    expect(facade.view().schedule.reconciliationQueued).toBe(true);

    facade.setScheduleInteractionActive(false);
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', { version: 4 })
    );
    expect(facade.view().schedule.reconciliationQueued).toBe(false);
  });

  it('applies an optimistic move and then replaces it with the authoritative HTTP response', () => {
    flushLoad();
    const intent = moveIntent(facade.view().kanban.snapshot!.cards[0], 'stage-done');

    facade.moveTask(intent);

    expect(facade.view().kanban.snapshot?.cards[0].workflowStageId).toBe('stage-done');
    expect(facade.view().kanban.busyTaskId).toBe('task-1');
    const request = http.expectOne('/api/tasks/task-1/kanban-move');
    expect(request.request.body).toMatchObject({
      targetWorkflowStageId: 'stage-done',
      expectedTaskVersion: 3,
      expectedBoardVersion: 7
    });
    const authoritative = snapshotDto({
      board: { ...snapshotDto().board!, version: 8 },
      cards: [{ ...snapshotDto().cards![0], workflowStageId: 'stage-done', boardOrder: 2000, version: 4 }]
    });
    request.flush({
      snapshot: authoritative,
      focusTaskId: 'task-1',
      warnings: [{
        code: 'KANBAN_WIP_LIMIT_EXCEEDED',
        message: 'Done exceeds its warning-only WIP limit.',
        workflowStageId: 'stage-done',
        currentCount: 2,
        limit: 1
      }]
    });

    expect(facade.view().kanban.snapshot?.boardVersion).toBe(8);
    expect(facade.view().kanban.snapshot?.cards[0].version).toBe(4);
    expect(facade.view().kanban.feedback).toBe('Move saved. Done exceeds its warning-only WIP limit.');
    expect(facade.view().kanban.focusTaskId).toBe('task-1');
  });

  it('refetches the selected query-only presentation after an authoritative move response uses board defaults', () => {
    flushLoad();
    facade.setIncludeOlderCompleted(true);
    http.expectOne((request) =>
      request.url === '/api/projects/project-1/kanban' &&
      request.params.get('swimlane') === '4' &&
      request.params.get('includeOlderCompleted') === 'true')
      .flush(snapshotDto({
        board: { ...snapshotDto().board!, selectedSwimlane: 4, includesOlderCompleted: true }
      }));

    facade.moveTask(moveIntent(facade.view().kanban.snapshot!.cards[0], 'stage-done'));
    http.expectOne('/api/tasks/task-1/kanban-move').flush({
      snapshot: snapshotDto({
        board: {
          ...snapshotDto().board!,
          version: 8,
          selectedSwimlane: 0,
          includesOlderCompleted: false
        },
        cards: [{ ...snapshotDto().cards![0], workflowStageId: 'stage-done', version: 4 }]
      }),
      focusTaskId: 'task-1',
      warnings: []
    });

    const presentationRefresh = http.expectOne((request) =>
      request.url === '/api/projects/project-1/kanban' &&
      request.params.get('swimlane') === '4' &&
      request.params.get('includeOlderCompleted') === 'true');
    presentationRefresh.flush(snapshotDto({
      board: {
        ...snapshotDto().board!,
        version: 8,
        selectedSwimlane: 4,
        includesOlderCompleted: true
      },
      cards: [{ ...snapshotDto().cards![0], workflowStageId: 'stage-done', version: 4 }]
    }));

    expect(facade.view().kanban.snapshot?.selectedSwimlane).toBe('parentTask');
    expect(facade.view().kanban.snapshot?.includesOlderCompleted).toBe(true);
    expect(facade.view().kanban.feedback).toBe('Move saved.');
    expect(facade.view().kanban.focusTaskId).toBe('task-1');
  });

  it('rolls a denied move back without hiding the still-authorized board', () => {
    flushLoad();
    const before = facade.view().kanban.snapshot;

    facade.moveTask(moveIntent(before!.cards[0], 'stage-done'));
    http.expectOne('/api/tasks/task-1/kanban-move').flush(
      { error: { code: 'TASK_REVIEW_REQUIRED', message: 'Review is required.' } },
      { status: 422, statusText: 'Unprocessable Entity' });

    expect(facade.view().kanban.status).toBe('rollback');
    expect(facade.view().kanban.snapshot).toBe(before);
    expect(facade.view().kanban.feedback).toContain('rolled back');
    expect(facade.view().kanban.focusTaskId).toBe('task-1');
  });

  it('rolls back a stale move and refetches the authoritative board', () => {
    flushLoad();
    const before = facade.view().kanban.snapshot!;

    facade.moveTask(moveIntent(before.cards[0], 'stage-done'));
    http.expectOne('/api/tasks/task-1/kanban-move').flush(
      { error: { code: 'KANBAN_STALE_BOARD', message: 'Refetch.' } },
      { status: 409, statusText: 'Conflict' });
    const refresh = http.expectOne((request) => request.url === '/api/projects/project-1/kanban');
    refresh.flush(snapshotDto({ board: { ...snapshotDto().board!, version: 9 } }));

    expect(facade.view().kanban.status).toBe('ready');
    expect(facade.view().kanban.snapshot?.boardVersion).toBe(9);
    expect(facade.view().kanban.feedback).toContain('Conflict resolved');
  });

  it('queues invalidation during an active menu and reconciles only after it closes', async () => {
    flushLoad();
    facade.setKanbanInteractionActive(true);

    events.next(realtimeEvent(4));

    http.expectNone((request) => request.url === '/api/projects/project-1/kanban');
    expect(facade.view().kanban.reconciliationQueued).toBe(true);
    facade.setKanbanInteractionActive(false);
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());
    expect(facade.view().kanban.reconciliationQueued).toBe(false);
  });

  it('uses the centralized reauthorized reconnect catch-up to refetch authoritative HTTP state', () => {
    flushLoad();

    catchUp!();
    flushAuthorizedProjectProjections();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban')
      .flush(snapshotDto({ board: { ...snapshotDto().board!, version: 8 } }));
    http.expectOne('/api/projects/project-1/gantt')
      .flush({ ...ganttSnapshotDto(), projectVersion: 12 });

    expect(facade.view().kanban.snapshot?.boardVersion).toBe(8);
    expect(facade.view().kanban.feedback).toContain('synchronized from authoritative HTTP');
    expect(facade.view().schedule.snapshot?.projectVersion).toBe(12);
  });

  it('clears protected projections before HTTP refetch when reconnect reauthorization is denied', () => {
    flushLoad(true, ganttSnapshotDto(), true);

    catchUp!({ deniedOwners: new Set(['project-detail']) });

    expect(facade.view().project).toBeUndefined();
    expect(facade.view().tasks).toEqual([]);
    expect(facade.view().workload).toEqual([]);
    expect(facade.view().members).toEqual([]);
    expect(facade.view().kanban.snapshot).toBeNull();
    expect(facade.view().schedule.snapshot).toBeNull();
    expect(facade.view().schedule.feedback).toContain('denied during reconnect');
    http.expectOne('/api/projects/project-1').flush(
      { error: { code: 'PROJECT_NOT_FOUND', message: 'Not found.' } },
      { status: 400, statusText: 'Bad Request' }
    );
    expect(facade.view().status).toBe('permissionDenied');
    expect(facade.view().message).toBe(
      'Project access was denied during reconnect. Protected Project data was cleared.'
    );
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' }
    );
    http.expectOne('/api/projects/project-1/gantt').flush(
      { error: { code: 'GANTT_PROJECT_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' }
    );
    expect(facade.view().kanban.snapshot).toBeNull();
    expect(facade.view().schedule.snapshot).toBeNull();
  });

  it('defers reconnect catch-up while a move menu is active', () => {
    flushLoad();
    facade.setKanbanInteractionActive(true);

    catchUp!();

    flushAuthorizedProjectProjections();
    http.expectNone((request) => request.url === '/api/projects/project-1/kanban');
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());
    expect(facade.view().kanban.reconciliationQueued).toBe(true);
    facade.setKanbanInteractionActive(false);
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    expect(facade.view().kanban.reconciliationQueued).toBe(false);
  });

  it('sends manager configuration as a versioned vendor-neutral intent and accepts the authoritative result', () => {
    flushLoad();
    const snapshot = facade.view().kanban.snapshot!;

    facade.updateKanbanConfig('priority', [...snapshot.columns].reverse());

    const request = http.expectOne('/api/projects/project-1/kanban/config');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({
      expectedBoardVersion: 7,
      defaultSwimlane: 3,
      columns: [
        { workflowStageId: 'stage-done', displayOrder: 0 },
        { workflowStageId: 'stage-todo', displayOrder: 1 }
      ]
    });
    request.flush({
      snapshot: snapshotDto({ board: { ...snapshotDto().board!, version: 8, defaultSwimlane: 3, selectedSwimlane: 3 } }),
      focusTaskId: null,
      warnings: []
    });
    expect(facade.view().kanban.snapshot?.defaultSwimlane).toBe('priority');
    expect(facade.view().kanban.feedback).toBe('Board configuration saved.');
  });

  it('clears protected state before revalidating an authorization invalidation', async () => {
    flushLoad(true, ganttSnapshotDto(), true);
    facade.setScheduleInteractionActive(true);

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });

    expect(facade.view().project).toBeUndefined();
    expect(facade.view().tasks).toEqual([]);
    expect(facade.view().workload).toEqual([]);
    expect(facade.view().members).toEqual([]);
    expect(facade.view().kanban.snapshot).toBeNull();
    expect(facade.view().schedule.snapshot).toBeNull();
    await Promise.resolve();
    flushDeniedProjectProjection();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    http.expectOne('/api/projects/project-1/gantt').flush(
      { error: { code: 'GANTT_WORK_ITEM_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    expect(facade.view().kanban.status).toBe('notFound');
    expect(facade.view().schedule.snapshot).toBeNull();
  });

  it('does not restore an in-flight schedule response after authorization is revoked', async () => {
    flushLoad();
    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    const command = http.expectOne('/api/tasks/task-1/schedule');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().schedule.snapshot).toBeNull();
    command.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });

    await Promise.resolve();
    flushDeniedProjectProjection();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' }
    );
    http.expectOne('/api/projects/project-1/gantt').flush(
      { error: { code: 'GANTT_WORK_ITEM_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' }
    );
    expect(facade.view().schedule.snapshot).toBeNull();
    expect(facade.view().schedule.status).toBe('error');
  });

  it('does not let an old command response release a new post-reauthorization command', async () => {
    flushLoad();
    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    const oldCommand = http.expectOne('/api/tasks/task-1/schedule');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    await Promise.resolve();
    flushAuthorizedProjectProjections();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    const currentCommand = http.expectOne('/api/tasks/task-1/schedule');

    oldCommand.flush(
      {
        requestId: 'old-command-conflict',
        error: {
          code: 'TASK_STALE_VERSION',
          message: 'Task changed.',
          target: 'expectedVersion',
          details: [],
          redactionApplied: true
        }
      },
      { status: 409, statusText: 'Conflict' }
    );

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-04',
      plannedEndDate: '2026-07-13',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectNone('/api/tasks/task-1/schedule');

    currentCommand.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', {
        plannedStartDate: '2026-07-03',
        plannedEndDate: '2026-07-12',
        version: 4
      })
    );
    expect(facade.view().schedule.snapshot?.scheduledItems[0].version).toBe(4);
  });

  it('does not let a command from an earlier same-Project load release the current command', () => {
    flushLoad();
    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    const oldCommand = http.expectOne('/api/tasks/task-1/schedule');

    facade.release();
    flushLoad();
    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    const currentCommand = http.expectOne('/api/tasks/task-1/schedule');

    oldCommand.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });
    expect(facade.view().schedule.snapshot?.scheduledItems[0].plannedStartDate).toBe('2026-07-03');

    facade.applyGanttEdit({
      kind: 'schedule',
      taskId: 'task-1',
      plannedStartDate: '2026-07-04',
      plannedEndDate: '2026-07-13',
      milestoneDate: null,
      expectedVersion: 3,
      source: 'form'
    });
    http.expectNone('/api/tasks/task-1/schedule');

    currentCommand.flush({
      taskId: 'task-1',
      kind: 'Task',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-12',
      milestoneDate: null,
      progressPercent: 25,
      version: 4,
      warnings: []
    });
    http.expectOne('/api/projects/project-1/gantt').flush(
      withGanttTask(ganttSnapshotDto(), 'task-1', {
        plannedStartDate: '2026-07-03',
        plannedEndDate: '2026-07-12',
        version: 4
      })
    );
    expect(facade.view().schedule.snapshot?.scheduledItems[0].version).toBe(4);
  });

  it('discards an older authoritative Gantt GET after authorization revalidation denies access', async () => {
    flushLoad();
    facade.retrySchedule();
    const staleAuthorizedRefresh = http.expectOne('/api/projects/project-1/gantt');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().schedule.snapshot).toBeNull();

    await Promise.resolve();
    flushDeniedProjectProjection();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    http.expectOne('/api/projects/project-1/gantt').flush(
      { error: { code: 'GANTT_PROJECT_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    expect(facade.view().schedule.snapshot).toBeNull();

    staleAuthorizedRefresh.flush(ganttSnapshotDto());
    expect(facade.view().schedule.snapshot).toBeNull();
    expect(facade.view().schedule.status).toBe('error');
    http.expectNone('/api/projects/project-1/gantt');
  });

  it('accepts current read-only Gantt state after authorization changes while discarding an older editable GET', async () => {
    flushLoad();
    facade.retrySchedule();
    const staleEditableRefresh = http.expectOne('/api/projects/project-1/gantt');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().schedule.snapshot).toBeNull();

    await Promise.resolve();
    flushAuthorizedProjectProjections();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush(viewerGanttSnapshotDto());
    expect(facade.view().schedule.snapshot?.permissions.canEditSchedule).toBe(false);
    expect(facade.view().schedule.snapshot?.scheduledItems[0].scheduleEditPermissions.canEditSchedule).toBe(false);

    staleEditableRefresh.flush(ganttSnapshotDto());
    expect(facade.view().schedule.snapshot?.permissions.canEditSchedule).toBe(false);
    expect(facade.view().schedule.snapshot?.scheduledItems[0].scheduleEditPermissions.canEditSchedule).toBe(false);
    http.expectNone('/api/projects/project-1/gantt');
  });

  it('does not reapply in-flight command responses after authorization is revoked', async () => {
    flushLoad();
    facade.moveTask(moveIntent(facade.view().kanban.snapshot!.cards[0], 'stage-done'));
    const move = http.expectOne('/api/tasks/task-1/kanban-move');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().kanban.snapshot).toBeNull();
    expect(facade.view().schedule.snapshot).toBeNull();

    move.flush({
      snapshot: snapshotDto({
        board: { ...snapshotDto().board!, version: 8 },
        cards: [{ ...snapshotDto().cards![0], workflowStageId: 'stage-done', version: 4 }]
      }),
      focusTaskId: 'task-1',
      warnings: []
    });

    await Promise.resolve();
    flushDeniedProjectProjection();
    const revalidation = http.expectOne((request) => request.url === '/api/projects/project-1/kanban');
    const scheduleRevalidation = http.expectOne('/api/projects/project-1/gantt');
    expect(facade.view().kanban.snapshot).toBeNull();
    revalidation.flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    scheduleRevalidation.flush(
      { error: { code: 'GANTT_WORK_ITEM_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    expect(facade.view().kanban.status).toBe('notFound');
    expect(facade.view().kanban.snapshot).toBeNull();
  });

  it('restarts an initial Project load after authorization changes and discards the old response', async () => {
    facade.load('project-1');
    http.expectOne('/api/projects/project-1').flush({
      id: 'project-1',
      title: 'Project',
      status: 1,
      startDate: null,
      endDate: null,
      uiPermissions: { canCreateTask: true }
    });

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().kanban.snapshot).toBeNull();
    await Promise.resolve();
    http.expectOne('/api/projects/project-1').flush(
      { error: { code: 'PROJECT_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });

    http.expectOne('/api/projects/project-1/tasks').flush({ items: [] });
    http.expectOne('/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush(ganttSnapshotDto());
    http.expectOne('/api/projects/project-1/workload').flush({ members: [] });
    http.expectOne('/api/projects/project-1/members').flush([]);

    expect(facade.view().status).toBe('error');
    expect(facade.view().kanban.snapshot).toBeNull();
  });

  it('uses the maintained List and does not request Kanban when the presentation flag is disabled', () => {
    flags.setForTesting({ 'tasks.kanbanV1': false });
    flushLoad(false);

    expect(facade.view().kanban.status).toBe('disabled');
    http.expectNone('/api/projects/project-1/kanban');
  });

  it('uses tasks.ganttV1 only as a presentation switch over the same canonical snapshot', () => {
    flags.setForTesting({ 'tasks.ganttV1': false });
    flushLoad();

    expect(facade.view().schedule.canonicalEnabled).toBe(false);
    expect(facade.view().schedule.snapshot?.scheduledItems[0].taskId).toBe('task-1');
    expect(facade.view().schedule.feedback).toContain('maintained read-only schedule list');
  });

  function flushLoad(
    includeKanban = true,
    gantt = ganttSnapshotDto(),
    includeProtectedRows = false
  ): void {
    facade.load('project-1');
    http.expectOne('/api/projects/project-1').flush({
      id: 'project-1',
      title: 'Project',
      status: 1,
      startDate: null,
      endDate: null,
      uiPermissions: { canCreateTask: true }
    });
    http.expectOne('/api/projects/project-1/tasks').flush({
      items: includeProtectedRows
        ? [{
            id: 'task-protected',
            projectId: 'project-1',
            title: 'Protected Task',
            status: 0,
            priority: 1,
            progressPercent: 10,
            version: 1
          }]
        : []
    });
    if (includeKanban) http.expectOne('/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush(gantt);
    http.expectOne('/api/projects/project-1/workload').flush({
      members: includeProtectedRows
        ? [{
            userId: 'member-protected',
            displayName: 'Protected Workload Member',
            projectRole: 'Member',
            assignedTaskCount: 1,
            overdueTaskCount: 0,
            estimatedHours: 2,
            actualHours: 1
          }]
        : []
    });
    http.expectOne('/api/projects/project-1/members').flush(
      includeProtectedRows
        ? [{ userId: 'member-protected', displayName: 'Protected Member', role: 'Member' }]
        : []
    );
  }

  function flushDeniedProjectProjection(): void {
    http.expectOne('/api/projects/project-1').flush(
      { error: { code: 'PROJECT_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' }
    );
  }

  function flushAuthorizedProjectProjections(): void {
    http.expectOne('/api/projects/project-1').flush({
      id: 'project-1',
      title: 'Project',
      status: 1,
      startDate: null,
      endDate: null,
      uiPermissions: { canCreateTask: false }
    });
    http.expectOne('/api/projects/project-1/tasks').flush({ items: [] });
    http.expectOne('/api/projects/project-1/workload').flush({ members: [] });
    http.expectOne('/api/projects/project-1/members').flush([]);
  }
});

function moveIntent(card: ProjectKanbanCard, stage: string): AipKanbanMoveRequest<ProjectKanbanCard> {
  return { item: card, targetStatus: stage, targetBeforeItemId: null, targetAfterItemId: null, reason: null, source: 'keyboard' };
}

function realtimeEvent(version: number): DurableRealtimeEvent {
  return {
    eventId: `event-${version}`,
    eventType: 'Projects.TaskChanged.v1',
    payloadSchemaVersion: 1,
    occurredAt: '2026-07-29T00:00:00Z',
    tenantId: 'tenant-1',
    aggregateType: 'Task',
    aggregateId: 'task-1',
    aggregateVersion: version,
    actor: { actorType: 'User', actorId: 'user-2' },
    correlationId: null,
    causationId: null,
    payload: { projectId: 'project-1', taskId: 'task-1', taskVersion: version, requiresRefetch: true }
  };
}

function withGanttTask(
  dto: ProjectGanttSnapshotDto,
  taskId: string,
  overrides: Partial<ProjectGanttItemDto>
): ProjectGanttSnapshotDto {
  const update = (item: ProjectGanttItemDto) =>
    item.taskId === taskId ? { ...item, ...overrides } : item;
  return {
    ...dto,
    scheduledItems: dto.scheduledItems.map(update),
    unscheduledItems: dto.unscheduledItems.map(update),
    milestones: dto.milestones.map(update)
  };
}
