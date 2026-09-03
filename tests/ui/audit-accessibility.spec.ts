import { expect, type Locator, type Page, test } from '@playwright/test';

import { expectNoAccessibilityViolations } from './a11y';

const versionId = '11111111-1111-4111-8111-111111111111';
const findingId = '22222222-2222-4222-8222-222222222222';
const reviewerId = '33333333-3333-4333-8333-333333333333';

type ReviewDecision = 'NoIssue' | 'NeedsFix' | 'AcceptedRisk';

async function tabTo(page: Page, target: Locator, maximumTabs = 80): Promise<void> {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }

  throw new Error(`Target was not reachable within ${maximumTabs} Tab presses.`);
}

async function expectVisibleKeyboardFocus(target: Locator): Promise<void> {
  const outline = await target.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      style: styles.outlineStyle,
      width: Number.parseFloat(styles.outlineWidth),
    };
  });

  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
}

async function expectMinimumTargetSize(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
}

test.describe('Audit WCAG 2.2 AA regression', () => {
  test('completes a structured review with keyboard-only controls and accessible async status', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    let decisionPutCount = 0;
    let currentDecision: ReviewDecision | null = null;
    let currentRationale: string | null = null;

    const decisionResponse = () => ({
      findingId,
      reviewCompleted: currentDecision !== null,
      canReview: true,
      currentDecision: currentDecision
        ? {
            decisionId: '44444444-4444-4444-8444-444444444444',
            decision: currentDecision,
            previousDecision: null,
            rationale: currentRationale,
            reviewerUserId: reviewerId,
            reviewerDisplayName: 'Authorized reviewer',
            timestamp: '2026-09-03T08:00:00Z',
          }
        : null,
      history: currentDecision
        ? [
            {
              decisionId: '44444444-4444-4444-8444-444444444444',
              decision: currentDecision,
              previousDecision: null,
              rationale: currentRationale,
              reviewerUserId: reviewerId,
              reviewerDisplayName: 'Authorized reviewer',
              timestamp: '2026-09-03T08:00:00Z',
            },
          ]
        : [],
      options: [
        { decision: 'NoIssue', label: 'No issue', rationaleRequired: false },
        { decision: 'NeedsFix', label: 'Needs fix', rationaleRequired: false },
        { decision: 'AcceptedRisk', label: 'Accepted risk', rationaleRequired: true },
      ],
    });

    await page.route('**/api/admin/audit/findings**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const decisionPath = `/api/admin/audit/findings/${findingId}/decision`;

      if (pathname.endsWith(decisionPath) && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(decisionResponse()),
        });
        return;
      }

      if (pathname.endsWith(decisionPath) && request.method() === 'PUT') {
        const body = request.postDataJSON() as {
          decision: ReviewDecision;
          rationale: string | null;
        };
        expect(body.decision).toBe('AcceptedRisk');
        expect(body.rationale).toBe('Risk accepted after keyboard review.');

        await new Promise((resolve) => setTimeout(resolve, 120));
        decisionPutCount += 1;
        currentDecision = body.decision;
        currentRationale = body.rationale;

        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(decisionResponse()),
        });
        return;
      }

      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            artifactVersionId: versionId,
            artifactVersionNumber: 8,
            artifactTitle: 'Accessibility audit report',
            canReview: true,
            eligibleOwners: [],
            findings: [
              {
                findingId,
                claimId: '55555555-5555-4555-8555-555555555555',
                claimOrdinal: 1,
                claimText: 'The selected audit finding requires a structured review.',
                severity: 'Critical',
                confidencePercent: 91,
                detectorKey: 'accessibility.review',
                policyVersion: 'wcag-2.2-aa',
                status: 'Open',
                workflowStatus: 'Open',
                ownerUserId: null,
                ownerDisplayName: null,
                dueDate: null,
                isOverdue: false,
                resolutionReason: null,
                createdAt: '2026-09-03T07:30:00Z',
                updatedAt: null,
                relatedEvidenceId: null,
                relatedEventId: null,
                history: [],
                workflowHistory: [],
              },
            ],
          }),
        });
        return;
      }

      await route.fulfill({ status: 405, body: '' });
    });

    await page.goto(`/app/admin/audit/findings?artifactVersion=${versionId}`);

    const panel = page.getByTestId('audit-finding-decision-panel');
    const decisionSelect = page.getByTestId('audit-finding-decision-select');
    const rationale = page.getByTestId('audit-finding-decision-rationale');
    const save = page.getByTestId('audit-finding-decision-save');
    const status = page.getByTestId('audit-finding-decision-status');

    await expect(panel).toBeVisible();
    await expect(status).toHaveText('No structured decision is recorded yet.');
    await expect(decisionSelect).toHaveValue('NoIssue');
    await expect(decisionSelect).toHaveAttribute('aria-describedby', 'finding-review-decision-help');

    await tabTo(page, decisionSelect);
    await expect(decisionSelect).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(decisionSelect).toHaveValue('AcceptedRisk');

    await page.keyboard.press('Tab');
    await expect(rationale).toBeFocused();
    await expectVisibleKeyboardFocus(rationale);
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(panel.getByRole('alert')).toContainText('Accepted risk requires a rationale.');
    expect(decisionPutCount).toBe(0);
    await expect(save).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(rationale).toBeFocused();
    await page.keyboard.type('Risk accepted after keyboard review.');
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveText('Saving structured decision.');
    await expect.poll(() => decisionPutCount).toBe(1);
    await expect(status).toHaveText('Structured decision saved. Review complete.');
    await expect(panel).not.toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeFocused();
    await expect(page.getByTestId('audit-finding-current-decision')).toContainText('Accepted risk');
    await expect(page.getByTestId('audit-finding-current-decision')).toContainText('Authorized reviewer');

    await expectMinimumTargetSize(decisionSelect);
    await expectMinimumTargetSize(rationale);
    await expectMinimumTargetSize(save);

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);

    await expectNoAccessibilityViolations(page, '[data-testid="audit-findings-page"]');
  });
});
