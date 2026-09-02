import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const versionId = '11111111-1111-4111-8111-111111111111';
const findingId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const eventId = '55555555-5555-4555-8555-555555555555';
const ownerId = '66666666-6666-4666-8666-666666666666';

type ReviewDecision = 'NoIssue' | 'NeedsFix' | 'AcceptedRisk';
type WorkflowStatus = 'Open' | 'InReview' | 'WaitingFix' | 'ReadyForReReview' | 'Done';

test.describe('Audit findings triage', () => {
  test('keeps Decision, workflow, and triage separate while tracking accountable follow-up', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    let status = 'Open';
    let workflowStatus: WorkflowStatus = 'Open';
    let ownerUserId: string | null = null;
    let ownerDisplayName: string | null = null;
    let dueDate: string | null = null;
    let resolutionReason: string | null = null;
    let triagePatchCount = 0;
    let workflowPatchCount = 0;
    let mentionPostCount = 0;
    let decisionPutCount = 0;
    let currentDecision: ReviewDecision | null = null;
    let currentDecisionRationale: string | null = null;
    const history: Array<{
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      changedAt: string;
    }> = [];
    const workflowHistory: Array<{
      fromWorkflowStatus: WorkflowStatus;
      toWorkflowStatus: WorkflowStatus;
      fromOwnerUserId: string | null;
      fromOwnerDisplayName: string | null;
      toOwnerUserId: string | null;
      toOwnerDisplayName: string | null;
      fromDueDate: string | null;
      toDueDate: string | null;
      changedAt: string;
    }> = [];
    const decisionHistory: Array<{
      decisionId: string;
      decision: ReviewDecision;
      previousDecision: ReviewDecision | null;
      rationale: string | null;
      reviewerUserId: string;
      reviewerDisplayName: string;
      timestamp: string;
    }> = [];

    const decisionResponse = () => ({
      findingId,
      reviewCompleted: currentDecision !== null,
      canReview: true,
      currentDecision: decisionHistory[0] ?? null,
      history: decisionHistory,
      options: [
        { decision: 'NoIssue', label: 'No issue', rationaleRequired: false },
        { decision: 'NeedsFix', label: 'Needs fix', rationaleRequired: false },
        { decision: 'AcceptedRisk', label: 'Accepted risk', rationaleRequired: true },
      ],
    });

    await page.route('**/api/admin/audit/findings**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isDecisionEndpoint = pathname.endsWith(`/api/admin/audit/findings/${findingId}/decision`);
      const isWorkflowEndpoint = pathname.endsWith(`/api/admin/audit/findings/${findingId}/workflow`);
      const isMentionEndpoint = pathname.endsWith(`/api/admin/audit/findings/${findingId}/mentions`);
      const isTriageEndpoint = pathname.endsWith(`/api/admin/audit/findings/${findingId}/triage`);

      if (isDecisionEndpoint && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(decisionResponse()),
        });
        return;
      }

      if (isDecisionEndpoint && request.method() === 'PUT') {
        const body = request.postDataJSON() as {
          decision: ReviewDecision;
          rationale: string | null;
        };
        if (body.decision === 'AcceptedRisk' && !body.rationale?.trim()) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
          return;
        }

        decisionPutCount += 1;
        const previousDecision = currentDecision;
        currentDecision = body.decision;
        currentDecisionRationale = body.rationale?.trim() || null;
        decisionHistory.unshift({
          decisionId: `99999999-9999-4999-8999-${String(decisionPutCount).padStart(12, '0')}`,
          decision: currentDecision,
          previousDecision,
          rationale: currentDecisionRationale,
          reviewerUserId: ownerId,
          reviewerDisplayName: 'Authorized reviewer',
          timestamp: `2026-09-01T04:${10 + decisionPutCount}:00Z`,
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(decisionResponse()),
        });
        return;
      }

      if (isWorkflowEndpoint && request.method() === 'PATCH') {
        const body = request.postDataJSON() as {
          workflowStatus: WorkflowStatus;
          ownerUserId: string | null;
          assignOwner: boolean;
          dueDate: string | null;
          setDueDate: boolean;
        };
        workflowPatchCount += 1;
        const previousWorkflowStatus = workflowStatus;
        const previousOwnerUserId = ownerUserId;
        const previousOwnerDisplayName = ownerDisplayName;
        const previousDueDate = dueDate;
        workflowStatus = body.workflowStatus;
        if (body.assignOwner) {
          ownerUserId = body.ownerUserId;
          ownerDisplayName = body.ownerUserId === ownerId ? 'Authorized reviewer' : null;
        }
        if (body.setDueDate) {
          dueDate = body.dueDate;
        }
        workflowHistory.unshift({
          fromWorkflowStatus: previousWorkflowStatus,
          toWorkflowStatus: workflowStatus,
          fromOwnerUserId: previousOwnerUserId,
          fromOwnerDisplayName: previousOwnerDisplayName,
          toOwnerUserId: ownerUserId,
          toOwnerDisplayName: ownerDisplayName,
          fromDueDate: previousDueDate,
          toDueDate: dueDate,
          changedAt: `2026-09-02T05:${10 + workflowPatchCount}:00Z`,
        });
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      if (isMentionEndpoint && request.method() === 'POST') {
        const body = request.postDataJSON() as {
          userId: string;
          requestId: string;
        };
        expect(body.userId).toBe(ownerId);
        expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        mentionPostCount += 1;
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      if (isTriageEndpoint && request.method() === 'PATCH') {
        triagePatchCount += 1;
        const body = request.postDataJSON() as {
          status: string;
          reason: string | null;
        };
        history.unshift({
          fromStatus: status,
          toStatus: body.status,
          reason: body.status === status ? null : body.reason,
          changedAt: `2026-09-01T03:${20 + triagePatchCount}:00Z`,
        });
        if (body.status !== status) {
          status = body.status;
          resolutionReason = body.reason;
        }
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          artifactVersionId: versionId,
          artifactVersionNumber: 7,
          artifactTitle: 'Policy review report',
          canReview: true,
          eligibleOwners: [
            { userId: ownerId, displayName: 'Authorized reviewer' },
          ],
          findings: [
            {
              findingId,
              claimId,
              claimOrdinal: 3,
              claimText: 'A high-impact policy claim requires review.',
              severity: 'Critical',
              confidencePercent: 64,
              detectorKey: 'policy.conflict',
              policyVersion: 'policy-2026.09',
              status,
              workflowStatus,
              ownerUserId,
              ownerDisplayName,
              dueDate,
              isOverdue: dueDate === '2026-09-01' && workflowStatus !== 'Done',
              resolutionReason,
              createdAt: '2026-09-01T02:00:00Z',
              updatedAt: workflowPatchCount > 0 || triagePatchCount > 0 ? '2026-09-02T05:11:00Z' : null,
              relatedEvidenceId: evidenceId,
              relatedEventId: eventId,
              history,
              workflowHistory,
            },
            {
              findingId: '77777777-7777-4777-8777-777777777777',
              claimId: '88888888-8888-4888-8888-888888888888',
              claimOrdinal: 1,
              claimText: 'A resolved finding should appear after unresolved work.',
              severity: 'Critical',
              confidencePercent: 99,
              detectorKey: 'policy.resolved',
              policyVersion: 'policy-2026.09',
              status: 'Resolved',
              workflowStatus: 'Done',
              ownerUserId: null,
              ownerDisplayName: null,
              dueDate: '2026-08-30',
              isOverdue: false,
              resolutionReason: null,
              createdAt: '2026-09-01T01:00:00Z',
              updatedAt: null,
              relatedEvidenceId: null,
              relatedEventId: null,
              history: [],
              workflowHistory: [],
            },
          ],
        }),
      });
    });

    await page.goto(`/app/admin/audit/findings?artifactVersion=${versionId}`);

    await expect(page.getByTestId('audit-findings-page')).toBeVisible();
    const queueCards = page.getByTestId('audit-finding-queue').locator('.finding-card');
    await expect(queueCards.first()).toContainText('Claim #3');
    await expect(queueCards.first()).toContainText('Critical severity');
    await expect(queueCards.first()).toContainText('64% confidence');
    await expect(queueCards.first()).toContainText('Workflow: Open');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Detector confidence');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('policy.conflict');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('policy-2026.09');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Unassigned');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('No due date');

    const decisionPanel = page.getByTestId('audit-finding-decision-panel');
    await expect(decisionPanel).toBeVisible();
    await expect(decisionPanel).toContainText('Decision required');
    await expect(decisionPanel).toContainText('No structured decision exists');
    await expect(decisionPanel).toContainText('Comments alone do not mark this review complete');
    expect(decisionPutCount).toBe(0);
    await expect(page.getByTestId('audit-finding-detail').locator('.finding-detail__status')).toHaveText('Open');

    await page.getByTestId('audit-finding-decision-select').selectOption('AcceptedRisk');
    await page.getByTestId('audit-finding-decision-save').click();
    await expect(decisionPanel.getByRole('alert')).toContainText('requires a rationale');
    expect(decisionPutCount).toBe(0);

    await page.getByTestId('audit-finding-decision-rationale').fill('Risk accepted under policy exception.');
    await page.getByTestId('audit-finding-decision-save').click();
    await expect.poll(() => decisionPutCount).toBe(1);
    await expect(decisionPanel).toContainText('Review complete');
    const current = page.getByTestId('audit-finding-current-decision');
    await expect(current).toContainText('Accepted risk');
    await expect(current).toContainText('Authorized reviewer');
    await expect(current).toContainText('Risk accepted under policy exception.');
    await expect(page.getByTestId('audit-finding-detail').locator('.finding-detail__status')).toHaveText('Open');
    await expect(page.getByTestId('audit-finding-workflow-status')).toHaveValue('Open');

    await page.getByTestId('audit-finding-owner').selectOption(ownerId);
    await page.getByTestId('audit-finding-workflow-status').selectOption('InReview');
    await page.getByTestId('audit-finding-due-date').fill('2026-09-01');
    await page.getByTestId('audit-finding-save-owner').click();
    await expect.poll(() => workflowPatchCount).toBe(1);
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Authorized reviewer');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('In Review');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('2026-09-01');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Overdue');
    const workflowHistoryPanel = page.getByTestId('audit-finding-workflow-history');
    await expect(workflowHistoryPanel).toContainText('Open → In Review');
    await expect(workflowHistoryPanel).toContainText('Unassigned → Authorized reviewer');
    await expect(workflowHistoryPanel).toContainText('No due date → 2026-09-01');
    await expect(current).toContainText('Accepted risk');
    await expect(page.getByTestId('audit-finding-detail').locator('.finding-detail__status')).toHaveText('Open');

    await page.getByTestId('audit-finding-mention-reviewer').click();
    await expect.poll(() => mentionPostCount).toBe(1);
    await expect(page.getByTestId('audit-finding-mutation-notice')).toHaveText('Reviewer mention sent.');
    await expect(page.getByTestId('audit-finding-workflow-status')).toHaveValue('InReview');
    await expect(current).toContainText('Accepted risk');

    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect(page.getByRole('alert')).toContainText('A reason is required');
    expect(triagePatchCount).toBe(0);

    await page.getByTestId('audit-finding-reason').fill('Detector matched a quoted example.');
    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect.poll(() => triagePatchCount).toBe(1);
    await expect(page.getByTestId('audit-finding-detail')).toContainText('False Positive');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Open → False Positive');
    await expect(page.getByTestId('audit-finding-workflow-status')).toHaveValue('InReview');
    await expect(current).toContainText('Accepted risk');

    const claimLink = page.getByTestId('audit-finding-claim-link');
    await expect(claimLink).toHaveAttribute(
      'href',
      `/app/admin/audit/claims-evidence?artifactVersion=${versionId}&claim=${claimId}&evidence=${evidenceId}`,
    );
    await expect(page.getByTestId('audit-finding-event-link')).toHaveAttribute(
      'href',
      `/app/admin/audit?event=${eventId}`,
    );

    await page.getByTestId('audit-findings-my-reviews').check();
    await expect.poll(() => new URL(page.url()).searchParams.get('myReviews')).toBe('true');
    await page.getByTestId('audit-findings-overdue').check();
    await expect.poll(() => new URL(page.url()).searchParams.get('overdue')).toBe('true');
    await page.getByTestId('audit-findings-unassigned').check();
    await expect.poll(() => new URL(page.url()).searchParams.get('unassigned')).toBe('true');
    await page.getByTestId('audit-findings-open-only').check();
    await expect.poll(() => new URL(page.url()).searchParams.get('openOnly')).toBe('true');

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
    await expectNoAccessibilityViolations(page);
  });
});
