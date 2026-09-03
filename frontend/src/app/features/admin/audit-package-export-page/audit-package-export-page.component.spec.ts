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

    expect(component.job()?.state).toBe('Completed');
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
