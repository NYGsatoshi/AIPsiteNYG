import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { AipKanbanMoveRequest } from '../../shared/ui/contracts/aip-complex-adapter.contracts';
import { ProjectKanbanCard } from './project-kanban.models';
import { snapshotDto } from './project-kanban.test-data';
import { ProjectDetailFacade } from './project-detail.facade';

describe('ProjectDetailFacade canonical Kanban', () => {
  let facade: ProjectDetailFacade;
  let http: HttpTestingController;
  let flags: FrontendFeatureFlagsService;
  let events: Subject<DurableRealtimeEvent>;
  let catchUp: (() => void) | undefined;

  beforeEach(() => {
    events = new Subject<DurableRealtimeEvent>();
    catchUp = undefined;
    const realtime = {
      durableEvents$: events.asObservable(),
      connectionState: signal<'Connected' | 'Degraded'>('Connected'),
      registerSubscription: () => () => undefined,
      registerCatchUp: (_owner: string, callback: () => void) => {
        catchUp = callback;
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

  it('queues invalidation during an active menu and reconciles only after it closes', () => {
    flushLoad();
    facade.setKanbanInteractionActive(true);

    events.next(realtimeEvent(4));

    http.expectNone((request) => request.url === '/api/projects/project-1/kanban');
    expect(facade.view().kanban.reconciliationQueued).toBe(true);
    facade.setKanbanInteractionActive(false);
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(snapshotDto());
    expect(facade.view().kanban.reconciliationQueued).toBe(false);
  });

  it('uses the centralized reauthorized reconnect catch-up to refetch authoritative HTTP state', () => {
    flushLoad();

    catchUp!();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban')
      .flush(snapshotDto({ board: { ...snapshotDto().board!, version: 8 } }));

    expect(facade.view().kanban.snapshot?.boardVersion).toBe(8);
    expect(facade.view().kanban.feedback).toContain('synchronized from authoritative HTTP');
  });

  it('defers reconnect catch-up while a move menu is active', () => {
    flushLoad();
    facade.setKanbanInteractionActive(true);

    catchUp!();

    http.expectNone((request) => request.url === '/api/projects/project-1/kanban');
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
    flushLoad();

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });

    expect(facade.view().kanban.snapshot).toBeNull();
    await Promise.resolve();
    http.expectOne((request) => request.url === '/api/projects/project-1/kanban').flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
      { status: 404, statusText: 'Not Found' });
    expect(facade.view().kanban.status).toBe('notFound');
  });

  it('does not reapply an in-flight move response after authorization is revoked', () => {
    flushLoad();
    facade.moveTask(moveIntent(facade.view().kanban.snapshot!.cards[0], 'stage-done'));
    const move = http.expectOne('/api/tasks/task-1/kanban-move');

    events.next({ ...realtimeEvent(8), eventType: 'Security.AuthorizationStateChanged.v1', payload: {} });
    expect(facade.view().kanban.snapshot).toBeNull();

    move.flush({
      snapshot: snapshotDto({
        board: { ...snapshotDto().board!, version: 8 },
        cards: [{ ...snapshotDto().cards![0], workflowStageId: 'stage-done', version: 4 }]
      }),
      focusTaskId: 'task-1',
      warnings: []
    });

    const revalidation = http.expectOne((request) => request.url === '/api/projects/project-1/kanban');
    expect(facade.view().kanban.snapshot).toBeNull();
    revalidation.flush(
      { error: { code: 'KANBAN_NOT_FOUND', message: 'Not found.' } },
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
    http.expectOne('/api/projects/project-1/gantt').flush({ milestones: [], tasks: [] });
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

  function flushLoad(includeKanban = true): void {
    facade.load('project-1');
    http.expectOne('/api/projects/project-1').flush({
      id: 'project-1',
      title: 'Project',
      status: 1,
      startDate: null,
      endDate: null,
      uiPermissions: { canCreateTask: true }
    });
    http.expectOne('/api/projects/project-1/tasks').flush({ items: [] });
    if (includeKanban) http.expectOne('/api/projects/project-1/kanban').flush(snapshotDto());
    http.expectOne('/api/projects/project-1/gantt').flush({ milestones: [], tasks: [] });
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
