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
    http.verify();
    TestBed.resetTestingModule();
  });

  it('keeps citation presence separate from support verification and maps explicit support states', () => {
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
    }));
    expect(view.claims[1].supportLabel).toBe('Insufficient evidence');
  });

  it('fails closed for unknown wire classifications instead of rendering server text', () => {
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
            },
          ],
        },
      ],
    });

    const claim = facade.viewModel().claims[0];
    expect(claim.supportStatus).toBe('Unverified');
    expect(claim.reviewStatus).toBe('Unreviewed');
    expect(claim.evidence[0].sourceKind).toBe('Source');
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
