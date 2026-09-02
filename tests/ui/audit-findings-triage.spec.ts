import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const versionId = '11111111-1111-4111-8111-111111111111';
const findingId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const eventId = '55555555-5555-4555-8555-555555555555';
const ownerId = '66666666-6666-4666-8666-666666666666';

type ReviewDecision = 'NoIssue' | 'NeedsFix' | 'AcceptedRisk';

test.describe('Audit findings triage', () => {
  test('records a structured review decision independently from triage and exposes authorized history', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    let status = 'Open';
    let ownerUserId: string | null = null;
    let ownerDisplayName: string | null = null;
    let resolutionReason: string | null = null;
    let patchCount = 0;
    let decisionPutCount = 0;
    let currentDecision: ReviewDecision | null = null;
    let currentDecisionRationale: string | null = null;
    const history: Array<{
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
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

      if (request.method() === 'PATCH') {
        patchCount += 1;
        const body = request.postDataJSON() as {
          status: string;
          reason: string | null;
          ownerUserId: string | null;
          assignOwner: boolean;
        };
        history.unshift({
          fromStatus: status,
          toStatus: body.status,
          reason: body.status === status ? null : body.reason,
          changedAt: `2026-09-01T03:${20 + patchCount}:00Z`,
        });
        if (body.status !== status) {
          status = body.status;
          resolutionReason = body.reason;
        }
        if (body.assignOwner) {
          ownerUserId = body.ownerUserId;
          ownerDisplayName = body.ownerUserId === ownerId ? 'Authorized reviewer' : null;
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
              ownerUserId,
              ownerDisplayName,
              resolutionReason,
              createdAt: '2026-09-01T02:00:00Z',
              updatedAt: ownerDisplayName ? '2026-09-01T03:21:00Z' : null,
              relatedEvidenceId: evidenceId,
              relatedEventId: eventId,
              history,
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
              ownerUserId: null,
              ownerDisplayName: null,
              resolutionReason: null,
              createdAt: '2026-09-01T01:00:00Z',
              updatedAt: null,
              relatedEvidenceId: null,
              relatedEventId: null,
              history: [],
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
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Detector confidence');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('policy.conflict');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('policy-2026.09');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Unassigned');

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
    await expect(current).toContainText('Previous state');
    await expect(current).toContainText('None');
    await expect(page.getByTestId('audit-finding-decision-history')).toContainText('None → Accepted risk');
    await expect(page.getByTestId('audit-finding-detail').locator('.finding-detail__status')).toHaveText('Open');

    await page.getByTestId('audit-finding-decision-select').selectOption('NeedsFix');
    await page.getByTestId('audit-finding-decision-rationale').fill('Source must be corrected before release.');
    await page.getByTestId('audit-finding-decision-save').click();
    await expect.poll(() => decisionPutCount).toBe(2);
    await expect(current).toContainText('Needs fix');
    await expect(current).toContainText('Accepted risk');
    await expect(current).toContainText('Source must be corrected before release.');
    await expect(page.getByTestId('audit-finding-decision-history')).toContainText('Accepted risk → Needs fix');

    const claimLink = page.getByTestId('audit-finding-claim-link');
    await expect(claimLink).toHaveAttribute(
      'href',
      `/app/admin/audit/claims-evidence?artifactVersion=${versionId}&claim=${claimId}&evidence=${evidenceId}`,
    );
    await expect(page.getByTestId('audit-finding-event-link')).toHaveAttribute(
      'href',
      `/app/admin/audit?event=${eventId}`,
    );

    await page.getByTestId('audit-finding-owner').selectOption(ownerId);
    await page.getByTestId('audit-finding-save-owner').click();
    await expect.poll(() => patchCount).toBe(1);
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Authorized reviewer');

    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect(page.getByRole('alert')).toContainText('A reason is required');
    expect(patchCount).toBe(1);

    await page.getByTestId('audit-finding-reason').fill('Detector matched a quoted example.');
    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect.poll(() => patchCount).toBe(2);
    await expect(page.getByTestId('audit-finding-detail')).toContainText('False Positive');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Authorized reviewer');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Detector matched a quoted example.');
    await expect(page.getByTestId('audit-finding-detail')).toContainText('Open → False Positive');

    await page.getByTestId('audit-findings-open-only').check();
    await expect.poll(() => new URL(page.url()).searchParams.get('openOnly')).toBe('true');

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
    await expectNoAccessibilityViolations(page);
  });
});
