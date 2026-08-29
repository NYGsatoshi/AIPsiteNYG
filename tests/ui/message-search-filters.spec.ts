import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { expectNoAccessibilityViolations } from './a11y';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const unreadMentionId = '22222222-2222-4222-8222-222222222222';
const unreadOnlyId = '33333333-3333-4333-8333-333333333333';
const mentionOnlyId = '44444444-4444-4444-8444-444444444444';
const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const conversations = [
  {
    id: unreadMentionId,
    workspaceId,
    type: 'DirectMessage',
    title: 'Unread mention',
    lastMessage: { body: 'Budget preview' },
    unreadCount: 2,
    hasMention: true,
    createdAt: '2026-08-29T01:00:00Z'
  },
  {
    id: unreadOnlyId,
    workspaceId,
    type: 'ProjectChannel',
    title: 'Unread only',
    lastMessage: { body: 'Unread preview' },
    unreadCount: 1,
    hasMention: false,
    createdAt: '2026-08-29T00:30:00Z'
  },
  {
    id: mentionOnlyId,
    workspaceId,
    type: 'ProjectChannel',
    title: 'Mention only',
    lastMessage: { body: 'Mention preview' },
    unreadCount: 0,
    hasMention: true,
    createdAt: '2026-08-29T00:00:00Z'
  }
];

test.describe('Issue #359 Message search and quick filters', () => {
  test.beforeEach(async ({ page }) => {
    await installMessagingDiscoveryApi(page);
  });

  test('keeps search and removable filters keyboard-accessible at 320px without accessibility violations', async ({
    page
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    await page.setViewportSize({ width: 320, height: 800 });

    const searchRequests: URL[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/search') {
        searchRequests.push(new URL(request.url()));
      }
    });

    await page.goto('/app/messages');

    const surface = page.getByTestId('message-search-filters');
    const drawerToggle = page.getByTestId('message-filter-drawer-toggle');
    const searchInput = page.getByTestId('message-search-input');
    await expect(surface).toBeVisible();
    await expect(drawerToggle).toBeVisible();
    await expect(searchInput).toBeHidden();
    await expect(page.getByTestId('conversation-list-item')).toHaveCount(3);

    await drawerToggle.focus();
    await drawerToggle.press('Enter');
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput).toBeFocused();

    const unreadFilter = page.getByTestId('message-filter-unread');
    await unreadFilter.focus();
    await unreadFilter.press('Enter');
    await expect(unreadFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('message-active-unread-chip')).toBeVisible();
    await expect(page.getByTestId('conversation-list-item')).toHaveCount(2);

    await searchInput.fill('budget');
    await searchInput.press('Enter');
    await expect(page.getByTestId('message-search-result')).toHaveCount(1);
    await expect(page.getByTestId('message-search-result')).toContainText('Budget decision is ready');
    await expect(page.getByTestId('message-search-result')).toHaveAttribute('href', `/app/dm/${unreadMentionId}`);
    await expect(page.getByTestId('message-active-search-chip')).toContainText('budget');
    expect(searchRequests).toHaveLength(1);
    expect(searchRequests[0].searchParams.get('q')).toBe('budget');
    expect(searchRequests[0].searchParams.get('type')).toBe('Message');
    expect(searchRequests[0].searchParams.get('pageSize')).toBe('50');

    const removeUnread = page.getByTestId('message-active-unread-chip').getByRole('button');
    await removeUnread.focus();
    await removeUnread.press('Enter');
    await expect(page.getByTestId('conversation-list-item')).toHaveCount(3);
    await expect(page.getByTestId('message-active-unread-chip')).toHaveCount(0);
    await expect(unreadFilter).toBeFocused();

    await searchInput.focus();
    await searchInput.press('Escape');
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawerToggle).toBeFocused();
    await expect(page.getByTestId('message-active-search-chip')).toBeVisible();

    await drawerToggle.press('Enter');
    await searchInput.fill('missing');
    await searchInput.press('Enter');
    await expect(page.getByTestId('message-search-empty')).toContainText('Change the search or clear');

    const changeSearch = page.getByTestId('message-search-change');
    await changeSearch.focus();
    await changeSearch.press('Enter');
    await expect(searchInput).toHaveValue('');
    await expect(searchInput).toBeFocused();
    await expect(page.getByTestId('message-search-empty')).toHaveCount(0);
    await expect(surface).not.toContainText('Has file');

    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="message-search-filters"]');
  });

  test('keeps search and quick filters expanded on desktop', async ({ page }, testInfo) => {
    skipUnlessDesktop(testInfo);
    await page.goto('/app/messages');

    await expect(page.getByTestId('message-search-input')).toBeVisible();
    await expect(page.getByTestId('message-filter-unread')).toBeVisible();
    await expect(page.getByTestId('message-filter-mentions')).toBeVisible();
    await expect(page.getByTestId('message-filter-drawer-toggle')).toBeHidden();
  });
});

function skipUnlessMobile(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    'Issue #359 uses the 320px mobile drawer as its representative responsive acceptance flow.'
  );
}

function skipUnlessDesktop(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'This check covers the always-expanded desktop controls.');
}

async function installMessagingDiscoveryApi(page: Page): Promise<void> {
  await page.route('**/api/conversations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/conversations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: conversations })
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/search**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q');
    const items =
      query === 'budget'
        ? [
            {
              type: 'Message',
              id: messageId,
              title: 'Unread mention',
              snippet: 'Budget decision is ready',
              route: `/conversations/${unreadMentionId}`,
              workspaceId,
              authorDisplayName: 'Authorized author',
              createdAt: '2026-08-29T01:15:00Z'
            }
          ]
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query,
        page: 1,
        pageSize: 50,
        totalCount: items.length,
        items
      })
    });
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    app: (() => {
      const host = document.getElementById('app-shell-main-content');
      return host ? host.scrollWidth - host.clientWidth : 0;
    })()
  }));

  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.app).toBeLessThanOrEqual(1);
}
