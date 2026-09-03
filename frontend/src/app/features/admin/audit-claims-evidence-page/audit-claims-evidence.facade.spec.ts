import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuditClaimsEvidenceFacade } from './audit-claims-evidence.facade';

describe('AuditClaimsEvidenceFacade', () => {
  let facade: AuditClaimsEvidenceFacade;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    facade = TestBed.inject(AuditClaimsEvidenceFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('keeps citation presence separate from support verification and maps authorized source provenance', () => {
    facade.load('11111111-1111-4111-8111-111111111111');

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/admin/audit/claims-evidence' &&
      candidate.params.get('artifactVersionId') === '11111111-1111-4111-8111-111111111111');
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      artifactId: 'artifact-1',
      artifactVersionId: '11111111-1111-4111-8111-111111111111',
      artifactVersionNumber: 3,
      artifactTitle: 'Research report',
      claims: [
        {
          claimId: 'claim-1',
          ordinal: 1,
          text: 'A claim with a citation that is contradicted.',
          citationPresent: true,
          supportStatus: 'Contradicted',
          reviewStatus: 'Reviewed',
          evidence: [
            {
              evidenceId: 'evidence-1',
              ordinal: 1,
              sourceKind: 'WebSnapshot',
              sourceReference: 'https://example.invalid/source',
              sourceTitle: 'Example source',
              passage: 'The authorized source passage.',
              location: 'Section 2',
              sourceEventAuditId: '22222222-2222-4222-8222-222222222222',
              sourceId: 'src_0123456789abcdef01234567',
              sourcePublisher: 'Example Publisher',
              sourceType: 'Research report',
              sourceClassification: 'Primary',
              publishedAt: '2026-08-01T00:00:00Z',
              retrievedAt: '2026-08-10T12:00:00Z',
              contentHash: 'sha256:abc123',
              sourceVersion: 'v3',
              verificationStatus: 'Verified',
            },
          ],
        },
        {
          claimId: 'claim-2',
          ordinal: 2,
          text: 'A claim with insufficient evidence.',
          citationPresent: true,
          supportStatus: 'Insufficient',
          reviewStatus: 'Unreviewed',
          evidence: [],
        },
        {
          claimId: 'claim-3',
          ordinal: 3,
          text: 'A claim whose evidence does not support it.',
          citationPresent: false,
          supportStatus: 'Unsupported',
          reviewStatus: 'Reviewed',
          evidence: [],
        },
      ],
    });

    const view = facade.viewModel();
    expect(view.status).toBe('ready');
    expect(view.claims[0]).toEqual(expect.objectContaining({
      citationPresent: true,
      supportStatus: 'Contradicted',
      supportLabel: 'Contradiction',
      reviewStatus: 'Reviewed',
    }));
    expect(view.claims[0].evidence[0]).toEqual(expect.objectContaining({
      sourceTitle: 'Example source',
      passage: 'The authorized source passage.',
      sourceEventAuditId: '22222222-2222-4222-8222-222222222222',
      sourceId: 'src_0123456789abcdef01234567',
      sourcePublisher: 'Example Publisher',
      sourceType: 'Research report',
      sourceClassification: 'Primary',
      publishedAt: '2026-08-01T00:00:00Z',
      retrievedAt: '2026-08-10T12:00:00Z',
      contentHash: 'sha256:abc123',
      sourceVersion: 'v3',
      verificationStatus: 'Verified',
    }));
    expect(view.claims[1].supportLabel).toBe('Insufficient evidence');
    expect(view.claims[2]).toEqual(expect.objectContaining({
      citationPresent: false,
      supportStatus: 'Unsupported',
      supportLabel: 'Unsupported',
    }));
  });

  it('loads Warning and Error totals from separate server-authorized Audit queries', () => {
    facade.loadActionSummary();

    const requests = http.match((candidate) => candidate.url === '/api/admin/audit-grid');
    expect(requests).toHaveLength(2);
    const warning = requests.find((request) => request.request.params.get('severity') === 'warning');
    const error = requests.find((request) => request.request.params.get('result') === 'failed');
    expect(warning).toBeDefined();
    expect(error).toBeDefined();
    expect(warning?.request.params.get('page')).toBe('1');
    expect(warning?.request.params.get('pageSize')).toBe('1');
    expect(error?.request.params.get('page')).toBe('1');
    expect(error?.request.params.get('pageSize')).toBe('1');
    expect(warning?.request.withCredentials).toBe(true);
    expect(error?.request.withCredentials).toBe(true);

    warning?.flush({ items: [], page: 1, pageSize: 1, totalCount: 7 });
    error?.flush({ items: [], page: 1, pageSize: 1, totalCount: 3 });

    expect(facade.actionSummary()).toEqual({
      status: 'ready',
      warningCount: 7,
      errorCount: 3,
    });
  });

  it('fails closed instead of rendering guessed zeroes for malformed summary counts', () => {
    facade.loadActionSummary();
    const requests = http.match((candidate) => candidate.url === '/api/admin/audit-grid');
    requests.find((request) => request.request.params.has('severity'))?.flush({ totalCount: 'hidden' });
    requests.find((request) => request.request.params.has('result'))?.flush({ totalCount: 2 });

    expect(facade.actionSummary()).toEqual(expect.objectContaining({
      status: 'error',
      warningCount: null,
      errorCount: null,
    }));
    expect(JSON.stringify(facade.actionSummary())).not.toContain('hidden');
  });

  it('maps summary permission denial without exposing the response body', () => {
    facade.loadActionSummary();
    const requests = http.match((candidate) => candidate.url === '/api/admin/audit-grid');
    requests[0].flush(
      { error: 'protected count detail' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(facade.actionSummary().status).toBe('permissionDenied');
    expect(JSON.stringify(facade.actionSummary())).not.toContain('protected count detail');
  });

  it('fails closed for unknown wire classifications and provenance values instead of rendering server text', () => {
    facade.load('11111111-1111-4111-8111-111111111111');
    http.expectOne((candidate) => candidate.url === '/api/admin/audit/claims-evidence').flush({
      artifactId: 'artifact-1',
      artifactVersionId: '11111111-1111-4111-8111-111111111111',
      artifactVersionNumber: 1,
      artifactTitle: 'Report',
      claims: [
        {
          claimId: 'claim-1',
          ordinal: 1,
          text: 'Claim',
          citationPresent: false,
          supportStatus: 'server-secret-status',
          reviewStatus: 'server-secret-review',
          evidence: [
            {
              evidenceId: 'evidence-1',
              ordinal: 1,
              sourceKind: 'server-secret-kind',
              sourceReference: 'opaque',
              sourceTitle: null,
              passage: 'Passage',
              location: null,
              sourceEventAuditId: null,
              sourceId: 'server-secret-source-id',
              sourcePublisher: 42,
              sourceType: false,
              sourceClassification: 'server-secret-classification',
              publishedAt: 'server-secret-published',
              retrievedAt: {},
              contentHash: [],
              sourceVersion: 9,
              verificationStatus: 'server-secret-verification',
            },
          ],
        },
      ],
    });

    const claim = facade.viewModel().claims[0];
    expect(claim.supportStatus).toBe('Unverified');
    expect(claim.reviewStatus).toBe('Unreviewed');
    expect(claim.evidence[0]).toEqual(expect.objectContaining({
      sourceKind: 'Source',
      sourceId: null,
      sourcePublisher: null,
      sourceType: null,
      sourceClassification: 'Unknown',
      publishedAt: null,
      retrievedAt: null,
      contentHash: null,
      sourceVersion: null,
      verificationStatus: 'Unverified',
    }));
    expect(JSON.stringify(facade.viewModel())).not.toContain('server-secret');
  });

  it.each([
    [403, 'permissionDenied'],
    [404, 'notFound'],
    [500, 'error'],
  ] as const)('maps HTTP %s without surfacing server error bodies', (status, expectedStatus) => {
    facade.load('11111111-1111-4111-8111-111111111111');
    http.expectOne((candidate) => candidate.url === '/api/admin/audit/claims-evidence').flush(
      { error: 'protected backend detail' },
      { status, statusText: 'Failure' },
    );

    expect(facade.viewModel().status).toBe(expectedStatus);
    expect(JSON.stringify(facade.viewModel())).not.toContain('protected backend detail');
  });
});
