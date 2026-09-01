import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuditFindingDecisionPanelComponent } from './audit-finding-decision-panel.component';

const FINDING_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '66666666-6666-4666-8666-666666666666';
const DECISION_URL = `/api/admin/audit/findings/${FINDING_ID}/decision`;

const options = [
  { decision: 'NoIssue' as const, label: 'No issue', rationaleRequired: false },
  { decision: 'NeedsFix' as const, label: 'Needs fix', rationaleRequired: false },
  { decision: 'AcceptedRisk' as const, label: 'Accepted risk', rationaleRequired: true },
];

describe('AuditFindingDecisionPanelComponent', () => {
  let fixture: ComponentFixture<AuditFindingDecisionPanelComponent>;
  let component: AuditFindingDecisionPanelComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AuditFindingDecisionPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AuditFindingDecisionPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('findingId', FINDING_ID);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('keeps review incomplete until a structured decision is saved and uses server rationale policy', () => {
    http.expectOne(DECISION_URL).flush({
      findingId: FINDING_ID,
      reviewCompleted: false,
      canReview: true,
      currentDecision: null,
      history: [],
      options,
    });
    fixture.detectChanges();

    expect(component.state().status).toBe('ready');
    if (component.state().status !== 'ready') {
      throw new Error('Expected ready decision panel state.');
    }
    expect(component.state().response.reviewCompleted).toBe(false);
    expect(component.state().response.currentDecision).toBeNull();

    component.updateDecision('AcceptedRisk');
    component.save();
    expect(component.validationError()).toContain('requires a rationale');
    http.expectNone(DECISION_URL);

    component.updateRationale('Risk accepted under the approved exception.');
    component.save();
    const request = http.expectOne(DECISION_URL);
    expect(request.request.method).toBe('PUT');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual({
      decision: 'AcceptedRisk',
      rationale: 'Risk accepted under the approved exception.',
    });
    request.flush({
      findingId: FINDING_ID,
      reviewCompleted: true,
      canReview: true,
      currentDecision: {
        decisionId: '99999999-9999-4999-8999-000000000001',
        decision: 'AcceptedRisk',
        previousDecision: null,
        rationale: 'Risk accepted under the approved exception.',
        reviewerUserId: REVIEWER_ID,
        reviewerDisplayName: 'Authorized reviewer',
        timestamp: '2026-09-01T04:11:00Z',
      },
      history: [
        {
          decisionId: '99999999-9999-4999-8999-000000000001',
          decision: 'AcceptedRisk',
          previousDecision: null,
          rationale: 'Risk accepted under the approved exception.',
          reviewerUserId: REVIEWER_ID,
          reviewerDisplayName: 'Authorized reviewer',
          timestamp: '2026-09-01T04:11:00Z',
        },
      ],
      options,
    });
    fixture.detectChanges();

    const state = component.state();
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') {
      throw new Error('Expected ready decision panel state after save.');
    }
    expect(state.response.reviewCompleted).toBe(true);
    expect(state.response.currentDecision?.decision).toBe('AcceptedRisk');
    expect(state.response.currentDecision?.reviewerDisplayName).toBe('Authorized reviewer');
    expect(state.response.currentDecision?.rationale).toBe('Risk accepted under the approved exception.');
    expect(state.response.history.length).toBe(1);
  });

  it('does not issue a mutation when the server marks the reviewer read-only', () => {
    http.expectOne(DECISION_URL).flush({
      findingId: FINDING_ID,
      reviewCompleted: true,
      canReview: false,
      currentDecision: {
        decisionId: '99999999-9999-4999-8999-000000000001',
        decision: 'NoIssue',
        previousDecision: null,
        rationale: null,
        reviewerUserId: REVIEWER_ID,
        reviewerDisplayName: 'Authorized reviewer',
        timestamp: '2026-09-01T04:11:00Z',
      },
      history: [],
      options,
    });
    fixture.detectChanges();

    component.updateDecision('NeedsFix');
    component.updateRationale('Attempted unauthorized mutation.');
    component.save();

    http.expectNone(DECISION_URL);
    expect(component.saving()).toBe(false);
  });
});
