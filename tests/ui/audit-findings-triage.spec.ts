import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const versionId = '11111111-1111-4111-8111-111111111111';
const findingId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const eventId = '55555555-5555-4555-8555-555555555555';

test.describe('Audit findings triage', () => {
  test('prioritizes unresolved risk, requires reasons, records ownership, and exposes trace links', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    let status = 'Open';
    let ownerDisplayName: string | null = null;
    let resolutionReason: string | null = null;
    let patchCount = 0;
    const history: Array<{
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      changedAt: string;
    }> = [];

    await page.route('**/api/admin/audit/findings**', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchCount += 1;
        const body = route.request().postDataJSON() as {
          status: string;
          reason: string | null;
          takeOwnership: boolean;
        };
        history.unshift({
          fromStatus: status,
          toStatus: body.status,
          reason: body.reason,
          changedAt: '2026-09-01T03:20:00Z',
        });
        status = body.status;
        resolutionReason = body.reason;
        if (body.takeOwnership) {
          ownerDisplayName = 'Authorized reviewer';
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
              ownerUserId: ownerDisplayName ? '66666666-6666-4666-8666-666666666666' : null,
              ownerDisplayName,
              resolutionReason,
              createdAt: '2026-09-01T02:00:00Z',
              updatedAt: ownerDisplayName ? '2026-09-01T03:20:00Z' : null,
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

    const claimLink = page.getByTestId('audit-finding-claim-link');
    await expect(claimLink).toHaveAttribute(
      'href',
      `/app/admin/audit/claims-evidence?artifactVersion=${versionId}&claim=${claimId}&evidence=${evidenceId}`,
    );
    await expect(page.getByTestId('audit-finding-event-link')).toHaveAttribute(
      'href',
      `/app/admin/audit?event=${eventId}`,
    );

    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect(page.getByRole('alert')).toContainText('A reason is required');
    expect(patchCount).toBe(0);

    await page.getByTestId('audit-finding-reason').fill('Detector matched a quoted example.');
    await page.getByTestId('audit-finding-status-FalsePositive').click();
    await expect.poll(() => patchCount).toBe(1);
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
