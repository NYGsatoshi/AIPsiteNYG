import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskExecutionResultComponent } from './task-execution-result.component';

const TASK_ID = 'task-464';

describe('TaskExecutionResultComponent run launcher', () => {
  let fixture: ComponentFixture<TaskExecutionResultComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskExecutionResultComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskExecutionResultComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('taskId', TASK_ID);
    fixture.componentRef.setInput('allowExecutionStart', true);
    fixture.componentRef.setInput('loadExistingResult', false);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('posts an empty command with a fresh Idempotency-Key and then loads the durable result', () => {
    http.expectNone(`/api/tasks/${TASK_ID}/execution-result`);

    const button = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="task-execution-start"]');
    expect(button).not.toBeNull();
    button?.click();

    const start = http.expectOne(`/api/tasks/${TASK_ID}/execution-runs`);
    expect(start.request.method).toBe('POST');
    expect(start.request.withCredentials).toBe(true);
    expect(start.request.body).toEqual({});
    expect(start.request.headers.get('Idempotency-Key')).toMatch(/^task-execution-ui-[A-Za-z0-9-]+$/);

    const serializedBody = JSON.stringify(start.request.body);
    for (const forbidden of ['candidateIds', 'fileIds', 'fsPath', 'materializedSources', 'evidence', 'sources']) {
      expect(serializedBody).not.toContain(forbidden);
    }

    start.flush({ id: 'run-464', status: 'Succeeded' });

    const result = http.expectOne(`/api/tasks/${TASK_ID}/execution-result`);
    expect(result.request.method).toBe('GET');
    expect(result.request.withCredentials).toBe(true);
    result.flush(succeededResult());
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-execution-start-feedback"]')?.textContent)
      .toContain('Execution completed');
    expect(native.querySelector('[data-testid="task-execution-result-status"]')?.textContent)
      .toContain('Succeeded');
    expect(native.querySelector('[data-testid="task-execution-report-body"]')?.textContent)
      .toContain('browser-smoke-task.txt');
  });

  it('redacts unauthorized execution failures instead of rendering backend details', () => {
    const button = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="task-execution-start"]');
    button?.click();

    http.expectOne(`/api/tasks/${TASK_ID}/execution-runs`).flush(
      { error: { message: '/srv/private/project/browser-smoke-task.txt' } },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Task execution is unavailable in the current session.');
    expect(text).not.toContain('/srv/private');
    expect(text).not.toContain('browser-smoke-task.txt');
  });
});

function succeededResult(): Record<string, unknown> {
  return {
    runId: 'run-464',
    status: 'Succeeded',
    failureCode: null,
    requestedAtUtc: '2026-08-31T00:00:00Z',
    queuedAtUtc: '2026-08-31T00:00:01Z',
    startedAtUtc: '2026-08-31T00:00:02Z',
    finishedAtUtc: '2026-08-31T00:00:03Z',
    report: {
      id: 'result-464',
      schemaVersion: 1,
      title: 'Project Files Analysis Report',
      bodyMarkdown: '# Project Files Analysis Report\n\n- browser-smoke-task.txt',
      contentSha256: 'b'.repeat(64),
      completedAtUtc: '2026-08-31T00:00:03Z',
    },
  };
}