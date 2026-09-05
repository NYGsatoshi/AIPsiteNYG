/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-use-before-define, @typescript-eslint/prefer-readonly-parameter-types, func-style, max-lines-per-function, max-statements, one-var, sort-imports, sort-keys */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuditPackageExportPageComponent } from './audit-package-export-page.component';

describe('AuditPackageExportPageComponent', () => {
  let fixture: ComponentFixture<AuditPackageExportPageComponent>;
  let component: AuditPackageExportPageComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AuditPackageExportPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AuditPackageExportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  it('requires explicit scope confirmation before queueing an export', () => {
    component.loadState.set('ready');
    component.preview.set({
      artifactId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      artifactVersionNumber: 7,
      artifactTitle: 'Audit report',
      scopeLabel: 'Artifact version 7 (full authorized Audit scope; no additional filters)',
      canExport: true,
      sensitiveMetadataIncluded: false,
      sections: [
        { key: 'audit-report', label: 'Audit report', itemCount: 1 },
        { key: 'claim-evidence', label: 'Claim / Evidence table', itemCount: 8 },
      ],
    });
    fixture.detectChanges();

    const exportButton = findButton('Create Audit package');
    expect(exportButton.disabled).toBe(true);

    component.setConfirmed(true);
    fixture.detectChanges();
    expect(findButton('Create Audit package').disabled).toBe(false);

    component.queueExport();
    expect(component.accessibilityStatus()).toContain('Queuing Audit package export');
    const request = httpMock.expectOne('/api/admin/audit/package-exports');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
    });
    request.flush({
      jobId: '99999999-8888-4777-8666-555555555555',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      fileName: 'audit-aaaaaaaa-bbbb.zip',
      state: 'Completed',
      progressPercent: 100,
      errorCode: null,
      createdAt: '2026-09-03T09:00:00Z',
      completedAt: '2026-09-03T09:00:02Z',
    });
    fixture.detectChanges();

    expect(component.job()?.state).toBe('Completed');
    expect(component.jobLastUpdatedAt()).not.toBeNull();
    expect(component.accessibilityStatus()).toContain('completed');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="audit-export-status"]')?.textContent)
      .toContain('Download is ready');
  });

  it('shows a safe failure reason and retry action for failed jobs', () => {
    component.job.set({
      jobId: '99999999-8888-4777-8666-555555555555',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      fileName: 'audit-package.zip',
      state: 'Failed',
      progressPercent: 100,
      errorCode: 'WorkerInterrupted',
      createdAt: '2026-09-03T09:00:00Z',
      completedAt: '2026-09-03T09:10:00Z',
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Processing was interrupted before completion.');
    expect(findButton('Retry safely')).toBeTruthy();
    expect(component.accessibilityStatus()).toContain('Processing was interrupted before completion.');
  });

  it('keeps the last known export state and exposes a recovery path when status refresh fails', () => {
    component.loadState.set('ready');
    component.job.set({
      jobId: '99999999-8888-4777-8666-555555555555',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      fileName: 'audit-package.zip',
      state: 'Processing',
      progressPercent: 62,
      errorCode: null,
      createdAt: '2026-09-03T09:00:00Z',
      completedAt: null,
    });
    component.jobLastUpdatedAt.set('2026-09-03T09:04:00Z');
    fixture.detectChanges();

    component.refreshJob();
    expect(component.accessibilityStatus()).toContain('Refreshing Audit package export status');
    const request = httpMock.expectOne(
      '/api/admin/audit/package-exports/99999999-8888-4777-8666-555555555555',
    );
    request.flush(
      { stackTrace: 'SECRET_INTERNAL_STACK', exception: 'DatabaseTimeoutException' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(component.job()?.state).toBe('Processing');
    expect(component.jobStatusStale()).toBe(true);
    expect(text).toContain('Export status may be out of date.');
    expect(text).toContain('The last known Processing state is still shown.');
    expect(text).not.toContain('SECRET_INTERNAL_STACK');
    expect(text).not.toContain('DatabaseTimeoutException');
    expect(component.accessibilityStatus()).toContain('Export status refresh failed');
    expect(findButton('Refresh status')).toBeTruthy();
  });

  it('clears stale state after a successful status refresh', () => {
    component.loadState.set('ready');
    component.job.set({
      jobId: '99999999-8888-4777-8666-555555555555',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      fileName: 'audit-package.zip',
      state: 'Processing',
      progressPercent: 62,
      errorCode: null,
      createdAt: '2026-09-03T09:00:00Z',
      completedAt: null,
    });
    component.jobStatusStale.set(true);
    component.jobLastUpdatedAt.set('2026-09-03T09:04:00Z');

    component.refreshJob();
    const request = httpMock.expectOne(
      '/api/admin/audit/package-exports/99999999-8888-4777-8666-555555555555',
    );
    request.flush({
      jobId: '99999999-8888-4777-8666-555555555555',
      artifactVersionId: '11111111-2222-4333-8444-555555555555',
      fileName: 'audit-package.zip',
      state: 'Completed',
      progressPercent: 100,
      errorCode: null,
      createdAt: '2026-09-03T09:00:00Z',
      completedAt: '2026-09-03T09:06:00Z',
    });
    fixture.detectChanges();

    expect(component.jobStatusStale()).toBe(false);
    expect(component.job()?.state).toBe('Completed');
    expect(component.accessibilityStatus()).toContain('Download is ready');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="audit-export-stale-state"]'))
      .toBeNull();
  });

  function findButton(label: string): HTMLButtonElement {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const button = buttons.find((candidate) => candidate.textContent?.trim().includes(label));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${label}`);
    }
    return button;
  }
});