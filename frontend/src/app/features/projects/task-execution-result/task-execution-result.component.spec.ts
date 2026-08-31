import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TaskExecutionResultComponent } from './task-execution-result.component';

const TASK_ID = 'task-463';

describe('TaskExecutionResultComponent', () => {
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
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('loads and renders the durable server report without interpreting Markdown as HTML', () => {
    const request = http.expectOne(`/api/tasks/${TASK_ID}/execution-result`);
    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(succeededResult('# Report\n\n<img src=x onerror=alert(1)>'));
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="task-execution-result-status"]')?.textContent).toContain('Succeeded');
    expect(native.querySelector('[data-testid="task-execution-report-body"]')?.textContent).toContain('<img src=x');
    expect(native.querySelector('[data-testid="task-execution-report"] img')).toBeNull();
    expect(native.textContent).toContain('Report SHA-256');
  });

  it('polls non-terminal state and stops after a terminal response', () => {
    vi.useFakeTimers();

    http.expectOne(`/api/tasks/${TASK_ID}/execution-result`).flush({
      runId: 'run-463',
      status: 'Running',
      failureCode: null,
      requestedAtUtc: '2026-08-30T22:00:00Z',
      queuedAtUtc: '2026-08-30T22:00:01Z',
      startedAtUtc: '2026-08-30T22:00:02Z',
      finishedAtUtc: null,
      report: null,
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Authorized Project files are being analyzed.');

    vi.advanceTimersByTime(1500);
    http.expectOne(`/api/tasks/${TASK_ID}/execution-result`).flush(succeededResult('# Complete'));
    fixture.detectChanges();
    vi.advanceTimersByTime(5000);

    http.expectNone(`/api/tasks/${TASK_ID}/execution-result`);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('durable execution report is ready');
  });

  it('uses a redacted empty state for unauthorized or missing results', () => {
    http.expectOne(`/api/tasks/${TASK_ID}/execution-result`).flush(
      { error: { message: 'secret/path/report.md' } },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No authorized execution result is available.');
    expect(text).not.toContain('secret/path');
  });

  it('rejects a succeeded projection that has no durable report', () => {
    http.expectOne(`/api/tasks/${TASK_ID}/execution-result`).flush({
      ...succeededResult('# Missing'),
      report: null,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('execution result response was invalid');
  });
});

function succeededResult(bodyMarkdown: string): Record<string, unknown> {
  return {
    runId: 'run-463',
    status: 'Succeeded',
    failureCode: null,
    requestedAtUtc: '2026-08-30T22:00:00Z',
    queuedAtUtc: '2026-08-30T22:00:01Z',
    startedAtUtc: '2026-08-30T22:00:02Z',
    finishedAtUtc: '2026-08-30T22:00:03Z',
    report: {
      id: 'result-463',
      schemaVersion: 1,
      title: 'Project Files Analysis Report',
      bodyMarkdown,
      contentSha256: 'a'.repeat(64),
      completedAtUtc: '2026-08-30T22:00:03Z',
    },
  };
}
