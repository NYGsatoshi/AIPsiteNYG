import { expect, type Locator, type Page, test } from '@playwright/test';

const mobileProfileContract = {
  'chromium-mobile': {
    browserName: 'chromium',
    viewport: { width: 393, height: 727 },
  },
  'webkit-mobile': {
    browserName: 'webkit',
    viewport: { width: 390, height: 664 },
  },
  'narrow-320': {
    browserName: 'chromium',
    viewport: { width: 320, height: 800 },
  },
} as const;

const intentionalHorizontalScrollRegions = ['[data-testid="app-data-grid"]'] as const;

test.describe('COMPAT-03 mobile compatibility', () => {
  test('uses touch navigation and overlay controls without hover-only behavior', async ({
    browserName,
    page,
  }, testInfo) => {
    const profile = requireMobileProfile(testInfo.project.name);
    expect(browserName).toBe(profile.browserName);
    expect(page.viewportSize()).toEqual(profile.viewport);
    expect(testInfo.project.use.hasTouch).toBe(true);

    await page.goto('/app/workspaces');
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('mobile-header')).toBeVisible();

    const navigationToggle = page.getByTestId('mobile-nav-toggle');
    await expectMinimumTouchTarget(navigationToggle);
    await navigationToggle.tap();

    const mobileNavigation = page.getByTestId('mobile-navigation');
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'false');
    await expect(navigationToggle).toHaveAttribute('aria-expanded', 'true');

    const workspaceLink = mobileNavigation.locator('a[href="/app/workspaces"]').first();
    await expect(workspaceLink).toBeVisible();
    await workspaceLink.tap();
    await expect(mobileNavigation).toHaveAttribute('aria-hidden', 'true');
    await expect(navigationToggle).toHaveAttribute('aria-expanded', 'false');

    const panelToggle = page.getByTestId('right-panel-toggle');
    await expectMinimumTouchTarget(panelToggle);
    await panelToggle.tap();

    const panel = page.getByTestId('right-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'true');

    const panelClose = page.getByTestId('right-panel-close');
    await expectMinimumTouchTarget(panelClose);
    await panelClose.tap();
    await expect(panel).toBeHidden();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');

    await expectNoDocumentHorizontalOverflow(page);
  });

  test('keeps page overflow closed while an allowlisted data grid owns horizontal scrolling', async ({
    browserName,
    page,
  }, testInfo) => {
    const profile = requireMobileProfile(testInfo.project.name);
    expect(browserName).toBe(profile.browserName);

    await page.setViewportSize({ width: 900, height: 900 });
    await installWorkspaceMembersApi(page);
    await page.goto('/app/workspaces/static-workspace-1/members');

    await expect(page.getByTestId('workspace-members-page')).toBeVisible();
    await expect(page.locator('.workspace-members__desktop-grid')).toBeVisible();
    await expect(page.locator('.workspace-members__mobile-list')).toBeHidden();

    const allowlistedGrid = page.getByTestId('app-data-grid');
    await expect(allowlistedGrid).toBeVisible();
    await expect
      .poll(async () => (await findHorizontalScrollRegions(allowlistedGrid)).length)
      .toBeGreaterThan(0);

    const scrollEvidence = await scrollFirstHorizontalRegion(allowlistedGrid);
    expect(scrollEvidence).not.toBeNull();
    expect(scrollEvidence?.after ?? 0).toBeGreaterThan(scrollEvidence?.before ?? 0);
    expect(scrollEvidence?.scrollWidth ?? 0).toBeGreaterThan(scrollEvidence?.clientWidth ?? 0);

    await expectOnlyAllowlistedHorizontalScroll(page, intentionalHorizontalScrollRegions);
    await expectNoDocumentHorizontalOverflow(page);
  });
});

function requireMobileProfile(projectName: string) {
  const profile = mobileProfileContract[projectName as keyof typeof mobileProfileContract];
  if (!profile) {
    throw new Error(`Unexpected COMPAT-03 Playwright project: ${projectName}`);
  }
  return profile;
}

async function expectMinimumTouchTarget(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds, 'Touch target must have a rendered bounding box.').not.toBeNull();
  expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function installWorkspaceMembersApi(page: Page) {
  await page.route('**/api/workspaces/static-workspace-1/members', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([
        {
          userId: '59400000-0000-4000-8000-000000000001',
          displayName: 'Compatibility Member',
          role: 'Member',
          status: 'Active',
          joinedAt: '2026-09-06T00:00:00Z',
        },
      ]),
    });
  });
}

async function findHorizontalScrollRegions(root: Locator) {
  return root.evaluate((element) => {
    const candidates = [element as HTMLElement, ...element.querySelectorAll<HTMLElement>('*')];
    return candidates
      .filter((candidate) => {
        const overflowX = getComputedStyle(candidate).overflowX;
        return (
          candidate.clientWidth > 0 &&
          candidate.scrollWidth > candidate.clientWidth + 1 &&
          (overflowX === 'auto' || overflowX === 'scroll')
        );
      })
      .map((candidate) => ({
        className: candidate.className,
        clientWidth: candidate.clientWidth,
        scrollWidth: candidate.scrollWidth,
      }));
  });
}

async function scrollFirstHorizontalRegion(root: Locator) {
  return root.evaluate((element) => {
    const candidates = [element as HTMLElement, ...element.querySelectorAll<HTMLElement>('*')];
    const region = candidates.find((candidate) => {
      const overflowX = getComputedStyle(candidate).overflowX;
      return (
        candidate.clientWidth > 0 &&
        candidate.scrollWidth > candidate.clientWidth + 1 &&
        (overflowX === 'auto' || overflowX === 'scroll')
      );
    });
    if (!region) {
      return null;
    }

    const before = region.scrollLeft;
    region.scrollLeft = region.scrollWidth;
    return {
      before,
      after: region.scrollLeft,
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth,
    };
  });
}

async function expectOnlyAllowlistedHorizontalScroll(
  page: Page,
  allowlistedSelectors: readonly string[],
) {
  const unexpected = await page.evaluate(
    (selectors) =>
      Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => {
          const overflowX = getComputedStyle(element).overflowX;
          const scrollable =
            element.clientWidth > 0 &&
            element.scrollWidth > element.clientWidth + 1 &&
            (overflowX === 'auto' || overflowX === 'scroll');
          return scrollable && !selectors.some((selector) => element.closest(selector));
        })
        .map((element) => ({
          className: element.className,
          testId: element.dataset['testid'] ?? '',
        })),
    allowlistedSelectors,
  );

  expect(unexpected).toEqual([]);
}

async function expectNoDocumentHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));

  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth);
}
