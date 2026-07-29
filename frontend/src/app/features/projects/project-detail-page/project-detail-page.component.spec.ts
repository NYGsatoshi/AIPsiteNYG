import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { mapProjectKanbanSnapshot } from '../project-kanban.models';
import { snapshotDto } from '../project-kanban.test-data';
import { ProjectDetailFacade, ProjectDetailViewModel, ProjectKanbanViewModel } from '../project-detail.facade';
import { ProjectDetailPageComponent } from './project-detail-page.component';

describe('ProjectDetailPageComponent canonical Kanban states', () => {
  it('renders WIP, hierarchy, blocked, priority, recent-Done, and narrow-layout meaning as text', async () => {
    const fixture = await render(kanbanView('ready'));
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
    const emptyFixture = await render({ ...kanbanView('empty'), snapshot: emptySnapshot });
    expect((emptyFixture.nativeElement as HTMLElement).textContent).toContain('No authorized Tasks match');
    emptyFixture.destroy();
    TestBed.resetTestingModule();

    const deniedFixture = await render({ ...kanbanView('permissionDenied'), snapshot: null });
    expect((deniedFixture.nativeElement as HTMLElement).textContent).toContain('Project Kanban is not available');
  });

  it('falls back to the maintained Project Task List when the presentation flag is disabled', async () => {
    const fixture = await render({ ...kanbanView('disabled'), snapshot: null, feedback: 'Project Kanban is disabled. The maintained Task List remains available.' });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('maintained Task List');
    expect((fixture.nativeElement as HTMLElement).querySelector('aip-kanban')).toBeNull();
  });
});

async function render(kanban: ProjectKanbanViewModel) {
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
    kanban,
    schedule: { milestones: [], tasks: [] },
    workload: [],
    members: []
  };
  const facade = {
    view: () => view,
    load: () => undefined,
    release: () => undefined,
    retryKanban: () => undefined,
    moveTask: () => undefined,
    updateKanbanConfig: () => undefined,
    setKanbanInteractionActive: () => undefined,
    setKanbanSwimlane: () => undefined,
    setIncludeOlderCompleted: () => undefined
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
  return fixture;
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
