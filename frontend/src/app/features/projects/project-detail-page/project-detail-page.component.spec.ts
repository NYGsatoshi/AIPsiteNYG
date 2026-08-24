import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { mapProjectKanbanSnapshot } from '../project-kanban.models';
import { snapshotDto } from '../project-kanban.test-data';
import { mapProjectGanttSnapshot } from '../project-gantt.models';
import { ganttSnapshotDto, viewerGanttSnapshotDto } from '../project-detail-gantt.test-data';
import {
  ProjectDetailFacade,
  ProjectDetailViewModel,
  ProjectKanbanViewModel,
  ProjectScheduleViewModel
} from '../project-detail.facade';
import { ProjectDetailPageComponent } from './project-detail-page.component';

describe('ProjectDetailPageComponent canonical Kanban states', () => {
  it('renders WIP, hierarchy, blocked, priority, recent-Done, and narrow-layout meaning as text', async () => {
    const { fixture } = await render(kanbanView('ready'));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Done shows 30 recent days');
    expect(text).toContain('Todo exceeds its warning limit.');
    expect(text).toContain('Warning: WIP limit 1 exceeded.');
    expect(text).toContain('Parent summary task');
    expect(text).toContain('Derived progress: 50%');
    expect(text).toContain('Derived dates: 2026-07-01 to 2026-07-31');
    expect(text).toContain('1 of 2 child tasks complete');
    expect(text).toContain('No parent task');
    expect(text).toContain('Priority: Critical');
    expect(text).toContain('Blocked');
    expect(text).toContain('grouped vertical list');
    expect((fixture.nativeElement as HTMLElement).querySelector('ejs-kanban')).toBeNull();
  });

  it('renders an authorized empty board separately from permission denial', async () => {
    const emptySnapshot = { ...mapProjectKanbanSnapshot(snapshotDto()), cards: [] };
    const { fixture: emptyFixture } = await render({ ...kanbanView('empty'), snapshot: emptySnapshot });
    expect((emptyFixture.nativeElement as HTMLElement).textContent).toContain('No authorized Tasks match');
    emptyFixture.destroy();
    TestBed.resetTestingModule();

    const { fixture: deniedFixture } = await render({ ...kanbanView('permissionDenied'), snapshot: null });
    expect((deniedFixture.nativeElement as HTMLElement).textContent).toContain('Project Kanban is not available');
  });

  it('falls back to the maintained Project Task List when the presentation flag is disabled', async () => {
    const { fixture, facade } = await render(
      { ...kanbanView('disabled'), snapshot: null, feedback: 'Project Kanban is disabled. The maintained Task List remains available.' },
      scheduleView(),
      { taskListFeedback: 'The Task list could not be synchronized.' }
    );

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('maintained Task List');
    expect(host.querySelector('aip-kanban')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be synchronized');
    host.querySelector<HTMLButtonElement>('[data-testid="task-list-retry"]')?.click();
    expect(facade.retryTaskList).toHaveBeenCalledOnce();
  });

  it('surfaces a transient authoritative Task-list refresh failure and offers a retry', async () => {
    const { fixture, facade } = await render(
      kanbanView('ready'),
      scheduleView(),
      { taskListFeedback: 'The Task list could not be synchronized. Temporarily unavailable.' }
    );
    fixture.componentInstance.tab.set('list');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be synchronized');
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="task-list-retry"]');
    expect(retry).not.toBeNull();
    retry?.click();
    expect(facade.retryTaskList).toHaveBeenCalledOnce();
  });

  it('renders the canonical narrow Schedule projection with calendar, WorkItem, dependency, warning, and form actions', async () => {
    const { fixture } = await render(kanbanView('ready'));
    fixture.componentInstance.tab.set('schedule');
    fixture.componentInstance.schedulePresentation.set('narrow');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const text = host.textContent ?? '';
    expect(text).toContain('Workspace timezone: Asia/Tokyo');
    expect(text).toContain('Scheduled work');
    expect(text).toContain('Canonical schedule task');
    expect(text).toContain('Milestones');
    expect(text).toContain('Launch');
    expect(text).toContain('Unscheduled work');
    expect(text).toContain('Unscheduled task');
    expect(text).toContain('UNSCHEDULED');
    expect(text).toContain('Dependencies');
    expect(text).toContain('Remove FS dependency');
    expect(text).toContain('Edit dates');
    expect(text).toContain('Edit progress');
    expect(text).toContain('Add FS predecessor');
    expect(host.querySelector('ejs-gantt')).toBeNull();
  });

  it('uses backend permissions for read-only controls and the feature flag only for the maintained projection', async () => {
    const { fixture: viewerFixture } = await render(
      kanbanView('ready'),
      scheduleView({ snapshot: mapProjectGanttSnapshot(viewerGanttSnapshotDto()) })
    );
    viewerFixture.componentInstance.tab.set('schedule');
    viewerFixture.componentInstance.schedulePresentation.set('narrow');
    viewerFixture.detectChanges();
    const viewerHost = viewerFixture.nativeElement as HTMLElement;
    expect(viewerHost.textContent).toContain('Schedule is read-only for the current actor.');
    expect(buttonLabels(viewerHost)).not.toContain('Edit dates');
    expect(buttonLabels(viewerHost)).not.toContain('Add FS predecessor');
    viewerFixture.destroy();
    TestBed.resetTestingModule();

    const { fixture: fallbackFixture } = await render(
      kanbanView('ready'),
      scheduleView({ canonicalEnabled: false })
    );
    fallbackFixture.componentInstance.tab.set('schedule');
    fallbackFixture.componentInstance.schedulePresentation.set('narrow');
    fallbackFixture.detectChanges();
    const fallbackText = (fallbackFixture.nativeElement as HTMLElement).textContent ?? '';
    expect(fallbackText).toContain('Canonical Gantt presentation is disabled');
    expect(fallbackText).toContain('Canonical schedule task');
    expect(fallbackText).toContain('read-only because the current API does not provide an authorized versioned schedule-write contract');
  });

  it('forwards canonical edit intents and opens the existing Task Detail route', async () => {
    const { fixture, facade } = await render(kanbanView('ready'));
    fixture.componentInstance.tab.set('schedule');
    fixture.componentInstance.schedulePresentation.set('narrow');
    fixture.detectChanges();
    const gantt = fixture.debugElement.query(By.css('aip-gantt')).componentInstance;
    const intent = {
      kind: 'progress' as const,
      taskId: 'task-1',
      progressPercent: 40,
      expectedVersion: 3,
      source: 'form' as const
    };

    gantt.editRequested.emit(intent);
    expect(facade.applyGanttEdit).toHaveBeenCalledWith(intent);

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    gantt.itemActivated.emit(scheduleView().snapshot!.scheduledItems[0]);
    expect(navigate).toHaveBeenCalledWith(['/projects', 'project-1', 'tasks', 'task-1']);

    gantt.itemActivated.emit(scheduleView().snapshot!.milestones[0]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps preserved conflict intent actionable after authoritative refetch returns ready', async () => {
    const preservedIntent = {
      kind: 'progress' as const,
      taskId: 'task-1',
      progressPercent: 40,
      expectedVersion: 3,
      source: 'form' as const
    };
    const { fixture, facade } = await render(
      kanbanView('ready'),
      scheduleView({
        status: 'ready',
        feedback: 'Conflict reconciled from authoritative schedule data.',
        preservedIntent
      })
    );
    fixture.componentInstance.tab.set('schedule');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const retry = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry preserved edit'));
    const discard = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Discard preserved edit'));

    expect(retry).toBeDefined();
    expect(discard).toBeDefined();
    retry!.click();
    discard!.click();
    expect(facade.retryPreservedScheduleIntent).toHaveBeenCalledOnce();
    expect(facade.clearPreservedScheduleIntent).toHaveBeenCalledOnce();
  });
});

async function render(
  kanban: ProjectKanbanViewModel,
  schedule: ProjectScheduleViewModel = scheduleView(),
  overrides: Partial<ProjectDetailViewModel> = {}
) {
  const view: ProjectDetailViewModel = {
    status: 'ready',
    project: {
      id: 'project-1',
      name: 'Project',
      status: 'active',
      statusLabel: 'Active',
      startDate: '',
      dueDate: '',
      group: 'Group',
      canCreateTask: true,
      taskCounts: { total: 0, done: 0, blocked: 0 }
    },
    tasks: [],
    taskListFeedback: null,
    kanban,
    schedule,
    workload: [],
    members: [],
    ...overrides
  };
  const facade = {
    view: () => view,
    load: vi.fn(),
    release: vi.fn(),
    retryKanban: vi.fn(),
    retryTaskList: vi.fn(),
    retrySchedule: vi.fn(),
    retryPreservedScheduleIntent: vi.fn(),
    moveTask: vi.fn(),
    applyGanttEdit: vi.fn(),
    reportGanttAdapterFailure: vi.fn(),
    clearPreservedScheduleIntent: vi.fn(),
    updateKanbanConfig: vi.fn(),
    setKanbanInteractionActive: vi.fn(),
    setScheduleInteractionActive: vi.fn(),
    setKanbanSwimlane: vi.fn(),
    setIncludeOlderCompleted: vi.fn()
  };
  await TestBed.configureTestingModule({
    imports: [ProjectDetailPageComponent],
    providers: [
      provideRouter([]),
      { provide: ProjectDetailFacade, useValue: facade },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: 'project-1' }) } } }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectDetailPageComponent);
  fixture.detectChanges();
  return { fixture, facade };
}

function kanbanView(status: ProjectKanbanViewModel['status']): ProjectKanbanViewModel {
  return {
    status,
    snapshot: mapProjectKanbanSnapshot(snapshotDto()),
    busyTaskId: null,
    focusTaskId: null,
    feedback: null,
    realtimeDegraded: false,
    reconciliationQueued: false
  };
}

function scheduleView(overrides: Partial<ProjectScheduleViewModel> = {}): ProjectScheduleViewModel {
  return {
    status: 'ready',
    snapshot: mapProjectGanttSnapshot(ganttSnapshotDto()),
    canonicalEnabled: true,
    busyItemId: null,
    focusItemId: null,
    feedback: null,
    preservedIntent: null,
    realtimeDegraded: false,
    reconciliationQueued: false,
    ...overrides
  };
}

function buttonLabels(host: HTMLElement): readonly string[] {
  return [...host.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '');
}
