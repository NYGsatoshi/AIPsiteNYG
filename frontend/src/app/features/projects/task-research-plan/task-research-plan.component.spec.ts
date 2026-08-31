import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskResearchPlanComponent } from './task-research-plan.component';

const TASK_ID = 'task-364';

describe('TaskResearchPlanComponent', () => {
  let fixture: ComponentFixture<TaskResearchPlanComponent>;
  let component: TaskResearchPlanComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskResearchPlanComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    fixture = TestBed.createComponent(TaskResearchPlanComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('taskId', TASK_ID);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('loads ordered steps and saves explicit keyboard-accessible reordering as one revision', () => {
    flushPlan(http, planResponse());
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-research-plan-revision"]')?.textContent).toContain('revision 3');
    expect((native.querySelector('input') as HTMLInputElement | null)?.value).toBe('Collect evidence');
    expect(native.querySelector('[aria-label="Move Step 2 up"]')).not.toBeNull();

    component.moveStep(1, -1);
    component.addStep();
    component.updateText(2, 'title', 'Publish review');
    component.updateStatus(2, 'Ready');
    component.save();

    const save = http.expectOne(`/api/tasks/${TASK_ID}/research-plan`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.withCredentials).toBe(true);
    expect(save.request.body).toEqual({
      expectedVersion: 7,
      steps: [
        { title: 'Review findings', objective: 'Review source facts.', scopeSummary: 'Task scope', status: 'Ready' },
        { title: 'Collect evidence', objective: 'Gather approved sources.', scopeSummary: 'Project files', status: 'Planned' },
        { title: 'Publish review', objective: '', scopeSummary: '', status: 'Ready' }
      ]
    });
    save.flush(planResponse({ version: 8, number: 4, steps: [
      { id: 'step-3', position: 1, title: 'Review findings', objective: 'Review source facts.', scopeSummary: 'Task scope', status: 'Ready' },
      { id: 'step-1', position: 2, title: 'Collect evidence', objective: 'Gather approved sources.', scopeSummary: 'Project files', status: 'Planned' },
      { id: 'step-4', position: 3, title: 'Publish review', objective: '', scopeSummary: '', status: 'Ready' }
    ] }));
    fixture.detectChanges();

    expect(component.dirty()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Research Plan revision 4 saved.');
  });

  it('shows a persisted plan to a viewer without mutation controls', () => {
    flushPlan(http, planResponse({ canManage: false }));
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.textContent).toContain('Current saved revision 3');
    expect(native.querySelector('input')).toBeNull();
    expect(native.querySelector('textarea')).toBeNull();
    expect(native.textContent).not.toContain('Save Research Plan');
  });

  it('reloads the authoritative revision after a stale save conflict', () => {
    flushPlan(http, planResponse());
    component.addStep();
    component.updateText(2, 'title', 'Conflicted');
    component.save();

    http.expectOne(`/api/tasks/${TASK_ID}/research-plan`).flush({
      error: { code: 'RESEARCH_PLAN_STALE_VERSION', message: 'Changed elsewhere.' }
    }, { status: 409, statusText: 'Conflict' });
    flushPlan(http, planResponse({ version: 8, number: 4 }));
    fixture.detectChanges();

    expect(component.plan()?.version).toBe(8);
    expect(component.dirty()).toBe(false);
  });
});

function flushPlan(http: HttpTestingController, response: Record<string, unknown>): void {
  const request = http.expectOne(`/api/tasks/${TASK_ID}/research-plan`);
  expect(request.request.withCredentials).toBe(true);
  request.flush(response);
}

function planResponse(overrides: { readonly version?: number; readonly number?: number; readonly canManage?: boolean; readonly steps?: readonly Record<string, unknown>[] } = {}): Record<string, unknown> {
  return {
    planId: 'plan-364',
    version: overrides.version ?? 7,
    canManage: overrides.canManage ?? true,
    currentRevision: {
      id: 'revision-3',
      number: overrides.number ?? 3,
      createdAtUtc: '2026-08-30T09:00:00Z',
      createdByUserId: 'user-364',
      steps: overrides.steps ?? [
        { id: 'step-1', position: 1, title: 'Collect evidence', objective: 'Gather approved sources.', scopeSummary: 'Project files', status: 'Planned' },
        { id: 'step-2', position: 2, title: 'Review findings', objective: 'Review source facts.', scopeSummary: 'Task scope', status: 'Ready' }
      ]
    }
  };
}
