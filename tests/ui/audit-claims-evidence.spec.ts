import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './a11y';

const versionId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';

test.describe('Audit Claims & Evidence workspace', () => {
  test('drills actionable counts into visible filters without horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.route('**/api/admin/audit/claims-evidence**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          artifactVersionId: versionId,
          artifactVersionNumber: 4,
          artifactTitle: 'Audited research report',
          claims: [
            {
              claimId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              ordinal: 1,
              text: 'The first audited claim.',
              citationPresent: true,
              supportStatus: 'Contradicted',
              reviewStatus: 'Reviewed',
              evidence: [
                {
                  evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  ordinal: 1,
                  sourceKind: 'WebSnapshot',
                  sourceReference: 'https://example.invalid/research/source/with/a/long/reference',
                  sourceTitle: 'Authorized source',
                  passage: 'This bounded passage is visible next to the selected claim and contradicts it.',
                  location: 'Section 2, paragraph 3',
                  sourceEventAuditId: eventId
                }
              ]
            },
            {
              claimId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              ordinal: 2,
              text: 'The second audited claim.',
              citationPresent: true,
              supportStatus: 'Insufficient',
              reviewStatus: 'Unreviewed',
              evidence: []
            },
            {
              claimId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              ordinal: 3,
              text: 'The support for this claim has not been verified.',
              citationPresent: true,
              supportStatus: 'Unverified',
              reviewStatus: 'Unreviewed',
              evidence: []
            }
          ]
        })
      });
    });
    await page.route('**/api/admin/audit-grid**', async (route) => {
      const url = new URL(route.request().url());
      const isSummaryCount = url.searchParams.get('pageSize') === '1';
      if (isSummaryCount) {
        const totalCount = url.searchParams.get('severity') === 'warning' ? 4 : 2;
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ items: [], page: 1, pageSize: 1, totalCount })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          items: [
            {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              createdAt: '2026-08-31T00:00:00Z',
              action: 'ArtifactReviewed',
              actorDisplayName: 'Authorized reviewer',
              targetType: 'ArtifactVersion',
              workspaceLabel: 'Audit workspace',
              severity: 'warning',
              result: 'success',
              summary: 'A warning event that remains reviewable.',
              requestId: null
            }
          ],
          page: 1,
          pageSize: 100,
          totalCount: 1
        })
      });
    });

    await page.goto(`/app/admin/audit/claims-evidence?artifactVersion=${versionId}`);

    await expect(page.getByTestId('audit-claims-evidence-page')).toBeVisible();
    await expect(page.getByTestId('audit-action-summary')).toContainText('Actionable checks');
    await expect(page.getByTestId('audit-summary-unverified')).toContainText('1');
    await expect(page.getByTestId('audit-summary-warning')).toContainText('4');
    await expect(page.getByTestId('audit-summary-error')).toContainText('2');
    await expect(page.getByTestId('audit-claim-matrix')).toContainText('Citation present');
    await expect(page.getByTestId('audit-claim-matrix')).toContainText('Contradiction');
    await expect(page.getByTestId('audit-claim-comparison')).toContainText('The first audited claim.');
    await expect(page.getByTestId('audit-claim-comparison')).toContainText(
      'This bounded passage is visible next to the selected claim and contradicts it.'
    );
    await expect(page.getByRole('link', { name: 'Related audit event' })).toHaveAttribute(
      'href',
      `/app/admin/audit?event=${eventId}`
    );

    const secondClaim = page.getByTestId('audit-claim-dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    await secondClaim.focus();
    await page.keyboard.press('Enter');
    await expect(secondClaim).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('audit-claim-comparison')).toContainText('Insufficient evidence');
    await expect(page.getByTestId('audit-claim-comparison')).toContainText(
      'No authorized evidence passage is available for this claim.'
    );

    await page.getByTestId('audit-summary-unverified').click();
    await expect(page).toHaveURL(new RegExp(`artifactVersion=${versionId}.*support=Unverified|support=Unverified.*artifactVersion=${versionId}`));
    await expect(page.getByTestId('filter-chip')).toContainText('Support: Not verified');
    await expect(page.getByTestId('audit-claim-matrix')).toContainText(
      'The support for this claim has not been verified.'
    );
    await expect(page.getByTestId('audit-claim-matrix')).not.toContainText('The first audited claim.');

    await page.getByRole('button', { name: 'Remove filter Support: Not verified' }).click();
    await expect(page.getByTestId('audit-claim-matrix')).toContainText('The first audited claim.');

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(horizontalOverflow).toBe(false);
    await expectNoAccessibilityViolations(page);

    await page.getByTestId('audit-summary-warning').click();
    await expect(page).toHaveURL(/\/app\/admin\/audit\?severity=warning$/);
    await expect(page.getByTestId('filter-chip')).toContainText('Severity: Warning');
  });
});
