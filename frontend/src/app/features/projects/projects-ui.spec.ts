import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { FrontendApiError } from '../../core/api/api-error.model';
import { AppDataGridActionEvent } from '../../shared/grid/app-data-grid/app-data-grid.types';
import { AIP_MY_TASKS_MOCK } from './my-tasks.facade';
import { AIP_PROJECTS_MOCK, ProjectsFacade } from './projects.facade';
import {
  PROJECTS_PRIMARY_PROJECT_ID,
  PROJECTS_PRIMARY_TASK_ID,
  PROJECTS_SCENARIOS,
  PROJECTS_UNAUTHORIZED_PROJECT_NAME,
  PROJECTS_UNAUTHORIZED_TASK_TITLE
} from './projects.mock';
import {
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectsScenario,
  TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
  TaskGridRow
} from './projects.types';
import { MyTasksPageComponent } from './my-tasks-page/my-tasks-page.component';
import { ProjectsOverviewPageComponent } from './projects-overview-page/projects-overview-page.component';
import { TaskDependenciesReadonlyComponent } from './task-dependencies-readonly/task-dependencies-readonly.component';
import { TaskDetailPageComponent } from './task-detail-page/task-detail-page.component';
import { TaskEditorComponent } from './task-editor/task-editor.component';
import { TaskTableComponent } from './task-table/task-table.component';

@Component({
  selector: 'app-task-table',
  standalone: true,
  template: `
    <section data-testid="stub-task-table">
      <p data-testid="stub-page-size">{{ defaultPageSize }}/{{ maximumPageSize }}</p>
      @for (row of rows; track row.id) {
        <article data-testid="task-row">
          <span>{{ row.title }}</span>
          <span>{{ row.project }}</span>
          @for (action of row.rowActions; track action.id) {
            <button
              type="button"
              [attr.data-testid]="'task-action-' + action.id"
              [attr.aria-disabled]="action.disabled"
              (click)="actionInvoked.emit({ actionId: action.id, row })"
            >
              {{ action.label }}
            </button>
          }
        </article>
      }
    </section>
  `
})
class StubTaskTableComponent {
  @Input() rows: readonly TaskGridRow[] = [];
  @Input() defaultPageSize = 0;
  @Input() maximumPageSize = 0;
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<TaskGridRow>>();
}

const angularCmpKey = '\u0275cmp';

const dependencyNames = (component: unknown): string[] => {
  const cmp = (component as Record<string, { dependencies?: unknown[] }>)[angularCmpKey];
  const dependencies = (cmp?.dependencies ?? []) as Array<{ name?: string; type?: { name?: string } }>;
  return dependencies.map((dependency) => dependency.type?.name ?? dependency.name ?? '');
};

const routeStub = {
  snapshot: {
    paramMap: convertToParamMap({
      projectId: PROJECTS_PRIMARY_PROJECT_ID,
      taskId: PROJECTS_PRIMARY_TASK_ID
    })
  }
};

const textContent = <T>(fixture: ComponentFixture<T>): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

const normalizedError = (localErrorId: string): FrontendApiError => ({
  code: 'Http500',
  message: 'Server failure',
  details: [],
  requestId: 'trace-visible',
  redactionApplied: true,
  httpStatus: 500,
  localErrorId
});

const query = <T extends HTMLElement, C = unknown>(fixture: ComponentFixture<C>, selector: string): T | null =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

const queryAll = <T extends HTMLElement, C = unknown>(fixture: ComponentFixture<C>, selector: string): T[] =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector));

const renderProjectsOverview = async (
  scenario: ProjectsScenario = PROJECTS_SCENARIOS.default
) => {
  await TestBed.configureTestingModule({
    imports: [ProjectsOverviewPageComponent],
    providers: [provideRouter([]), { provide: AIP_PROJECTS_MOCK, useValue: scenario }]
  })
    .overrideComponent(ProjectsOverviewPageComponent, {
      remove: { imports: [TaskTableComponent] },
      add: { imports: [StubTaskTableComponent] }
    })
    .compileComponents();

  const fixture = TestBed.createComponent(ProjectsOverviewPageComponent);
  fixture.detectChanges();
  return fixture;
};

const renderMyTasks = async (
  scenario: ProjectsScenario = PROJECTS_SCENARIOS.default
) => {
  await TestBed.configureTestingModule({
    imports: [MyTasksPageComponent],
    providers: [provideRouter([]), { provide: AIP_MY_TASKS_MOCK, useValue: scenario }]
  })
    .overrideComponent(MyTasksPageComponent, {
      remove: { imports: [TaskTableComponent] },
      add: { imports: [StubTaskTableComponent] }
    })
    .compileComponents();

  const fixture = TestBed.createComponent(MyTasksPageComponent);
  fixture.detectChanges();
  return fixture;
};

describe('Projects and tasks mock UI', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('route pages do not directly use AgGridAngular', () => {
    const routePageDependencies = [
      ...dependencyNames(ProjectsOverviewPageComponent),
      ...dependencyNames(MyTasksPageComponent),
      ...dependencyNames(TaskDetailPageComponent)
    ];

    expect(routePageDependencies).not.toContain('AgGridAngular');
  });

  it('keeps ag-grid-enterprise absent from feature component dependencies', () => {
    const enterprisePackageName = 'ag-grid' + '-enterprise';
    const featureDependencies = [
      ...dependencyNames(ProjectsOverviewPageComponent),
      ...dependencyNames(MyTasksPageComponent),
      ...dependencyNames(TaskDetailPageComponent),
      ...dependencyNames(TaskTableComponent)
    ].join(' ');

    expect(featureDependencies).not.toContain(enterprisePackageName);
    expect(dependencyNames(TaskTableComponent).some((name) => name.includes('AppDataGridComponent'))).toBe(true);
  });

  it('renders projects and task rows with bounded page size', async () => {
    const fixture = await renderProjectsOverview();

    expect(query(fixture, '[data-testid="project-summary-card"]')).not.toBeNull();
    expect(queryAll(fixture, '[data-testid="task-row"]').length).toBeGreaterThan(0);
    expect(query(fixture, '[data-testid="stub-page-size"]')?.textContent).toContain('50/100');
  });

  it('renders Project load failures as retryable errors instead of empty states', async () => {
    const fixture = await renderProjectsOverview({
      ...PROJECTS_SCENARIOS.default,
      status: 'error',
      projects: [],
      tasks: [],
      message: 'Projects could not be loaded. Try again.',
      error: normalizedError('local-projects-error')
    } satisfies ProjectsScenario);

    expect(query(fixture, '[data-testid="projects-load-error"]')).not.toBeNull();
    expect(query(fixture, '[data-testid="projects-retry"]')).not.toBeNull();
    expect(textContent(fixture)).not.toContain('No projects');
  });

  it('renders My Tasks failures as retryable errors instead of empty states', async () => {
    const fixture = await renderMyTasks({
      ...PROJECTS_SCENARIOS.default,
      myTasksStatus: 'error',
      myTasks: [],
      myTasksMessage: 'My Tasks could not be loaded. Try again.',
      myTasksError: normalizedError('local-my-tasks-error')
    } satisfies ProjectsScenario);

    expect(query(fixture, '[data-testid="my-tasks-load-error"]')).not.toBeNull();
    expect(query(fixture, '[data-testid="my-tasks-retry"]')).not.toBeNull();
    expect(textContent(fixture)).not.toContain('No tasks');
  });

  it('does not render unauthorized project or task names in denied state', async () => {
    const fixture = await renderProjectsOverview(PROJECTS_SCENARIOS.permissionDenied);
    const text = textContent(fixture);

    expect(text).not.toContain(PROJECTS_UNAUTHORIZED_PROJECT_NAME);
    expect(text).not.toContain(PROJECTS_UNAUTHORIZED_TASK_TITLE);
  });

  it('limits maximum page size to 100', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: AIP_PROJECTS_MOCK, useValue: PROJECTS_SCENARIOS.manyRowsBoundedPage }]
    });
    const facade = TestBed.inject(ProjectsFacade);

    expect(facade.getMyTasks().pageSize.maximumPageSize).toBe(PROJECTS_MAXIMUM_PAGE_SIZE);
    expect(PROJECTS_MAXIMUM_PAGE_SIZE).toBe(100);
  });

  it('mobile layout does not expose hidden task actions', async () => {
    const fixture = await renderMyTasks(PROJECTS_SCENARIOS.mobile);

    expect(query(fixture, '[data-testid="task-action-openDetail"]')).not.toBeNull();
    expect(query(fixture, '[data-testid="task-action-assign"]')).toBeNull();
    expect(query(fixture, '[data-testid="task-action-changeStatus"]')).toBeNull();
  });
});

describe('TaskEditorComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  const renderEditor = async (
    scenario: ProjectsScenario = PROJECTS_SCENARIOS.default
  ) => {
    await TestBed.configureTestingModule({
      imports: [TaskEditorComponent],
      providers: [{ provide: AIP_PROJECTS_MOCK, useValue: scenario }]
    }).compileComponents();

    const facade = TestBed.inject(ProjectsFacade);
    const detail = facade.getTaskDetail(PROJECTS_PRIMARY_PROJECT_ID, PROJECTS_PRIMARY_TASK_ID);
    const fixture = TestBed.createComponent(TaskEditorComponent);
    fixture.componentRef.setInput('task', detail.editorTask);
    fixture.componentRef.setInput('capabilities', detail.capabilities);
    fixture.componentRef.setInput('state', detail.detailState);
    fixture.componentRef.setInput('transitionNote', detail.transitionNote);
    fixture.componentRef.setInput('mutationState', { status: 'idle' });
    fixture.detectChanges();
    return fixture;
  };

  it('progressPercent rejects below 0, above 100, and non-integer values', async () => {
    const fixture = await renderEditor();
    const control = fixture.componentInstance.form.controls.progressPercent;

    control.setValue(-1);
    expect(control.valid).toBe(false);

    control.setValue(101);
    expect(control.valid).toBe(false);

    control.setValue(10.5);
    expect(control.valid).toBe(false);

    control.setValue(85);
    expect(control.valid).toBe(true);
  });

  it('makes milestone read-only without capability', async () => {
    const fixture = await renderEditor(PROJECTS_SCENARIOS.milestoneReadOnly);

    expect(query<HTMLInputElement>(fixture, '[data-testid="task-milestone-input"]')?.readOnly).toBe(true);
  });

  it('renders existing task detail in editable backend fields', async () => {
    const fixture = await renderEditor();

    expect(query(fixture, '[data-testid="task-editor-readonly-note"]')).toBeNull();
    expect(query<HTMLInputElement>(fixture, '[data-testid="task-title-input"]')?.value).toContain('Prepare sample kickoff');
    expect(query<HTMLInputElement>(fixture, '[data-testid="task-title-input"]')?.readOnly).toBe(false);
    expect(query<HTMLTextAreaElement>(fixture, '[data-testid="task-description-input"]')?.readOnly).toBe(false);
    expect(query<HTMLButtonElement>(fixture, '[data-testid="task-save-button"]')?.disabled).toBe(false);
  });

  it('preserves user input when a save failure is shown', async () => {
    const fixture = await renderEditor();
    const title = query<HTMLInputElement>(fixture, '[data-testid="task-title-input"]');
    title!.value = 'Changed but not persisted';
    title!.dispatchEvent(new Event('input'));
    fixture.componentRef.setInput('mutationState', { status: 'failure', message: 'Backend rejected save.' });
    fixture.detectChanges();

    expect(query(fixture, '[data-testid="task-save-error"]')).not.toBeNull();
    expect(query(fixture, '[data-testid="task-save-success"]')).toBeNull();
    expect(query<HTMLInputElement>(fixture, '[data-testid="task-title-input"]')?.value).toBe('Changed but not persisted');
  });

  it('disables unsupported status transitions from allowedTransitions', async () => {
    const fixture = await renderEditor();
    const unsupported = query<HTMLOptionElement>(fixture, 'option[value="notStarted"]');
    const supported = query<HTMLOptionElement>(fixture, 'option[value="review"]');

    expect(unsupported?.disabled).toBe(true);
    expect(supported?.disabled).toBe(false);
  });

  it('keeps status transitions backend-authoritative by design', async () => {
    const fixture = await renderEditor();

    expect(TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE.owner).toBe('backendAuthoritativeDuringApiWiring');
    expect(textContent(fixture)).toContain('live API remains authoritative');
  });

  it('disables status control when backend permissions do not allow transitions', async () => {
    const fixture = await renderEditor(PROJECTS_SCENARIOS.milestoneReadOnly);
    const task = {
      ...PROJECTS_SCENARIOS.default.tasks[0],
      allowedTransitions: [],
      capabilities: PROJECTS_SCENARIOS.default.tasks[0].capabilities.filter(
        (capability) => capability !== 'changeTaskStatus'
      )
    };

    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('capabilities', task.capabilities);
    fixture.detectChanges();

    expect(query(fixture, '[data-testid="task-status-disabled-note"]')).not.toBeNull();
    expect(query<HTMLSelectElement>(fixture, '[data-testid="task-status-select"]')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows recoverable invalid transition and row version conflict states', async () => {
    const invalidTransition = await renderEditor(PROJECTS_SCENARIOS.invalidStateTransition);
    expect(query(invalidTransition, '[data-testid="invalid-state-transition"]')).not.toBeNull();

    TestBed.resetTestingModule();

    const rowConflict = await renderEditor(PROJECTS_SCENARIOS.rowVersionConflict);
    expect(query(rowConflict, '[data-testid="row-version-conflict"]')).not.toBeNull();
  });
});

describe('TaskDependenciesReadonlyComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders dependencies as display-only content', async () => {
    await TestBed.configureTestingModule({
      imports: [TaskDependenciesReadonlyComponent],
      providers: [{ provide: AIP_PROJECTS_MOCK, useValue: PROJECTS_SCENARIOS.dependenciesDisplayOnly }]
    }).compileComponents();

    const facade = TestBed.inject(ProjectsFacade);
    const fixture = TestBed.createComponent(TaskDependenciesReadonlyComponent);
    fixture.componentRef.setInput(
      'dependencies',
      facade.getTaskDetail(PROJECTS_PRIMARY_PROJECT_ID, PROJECTS_PRIMARY_TASK_ID).dependencies
    );
    fixture.detectChanges();

    expect(query(fixture, '[data-testid="dependencies-display-only-note"]')).not.toBeNull();
    expect(query(fixture, '[draggable="true"]')).toBeNull();
    expect(query(fixture, 'input')).toBeNull();
  });
});
