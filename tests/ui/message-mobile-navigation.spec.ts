import { expect, test, type Page, type TestInfo } from '@playwright/test';

const workspaceId = 'static-workspace-1';
const currentUserId = 'mock-user-a';

const conversations = Array.from({ length: 30 }, (_, index) => {
  const channel = index === 0;
  const id = channel ? 'mobile-channel-1' : `mobile-dm-${index}`;
  return {
    id,
    workspaceId,
    type: channel ? 'ProjectChannel' : 'DirectMessage',
    title: channel ? 'Mobile channel' : `Mobile DM ${index}`,
    lastMessage: {
      id: `last-${id}`,
      conversationId: id,
      authorUserId: 'mock-user-b',
      authorDisplayName: 'Mock User B',
      body: `Preview ${index}`,
      createdAt: '2026-08-23T00:00:00Z',
      version: 1
    },
    unreadCount: index % 3,
    hasMention: index % 5 === 0,
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: `2026-08-23T00:${String(index).padStart(2, '0')}:00Z`
  };
});

test.describe('Issue #351 mobile Message hierarchy', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    skipDesktop(testInfo);
    await installMessagingApi(page);
    await page.setViewportSize({ width: 320, height: 800 });
  });

  test('opens detail at the top and restores the Message list scroll position on Back', async ({ page }) => {
    await page.goto('/app/messages');

    await expect(page.getByTestId('messages-page')).toBeVisible();
    await expect(page.getByTestId('conversation-list-item')).toHaveCount(conversations.length);
    await expectNoHorizontalOverflow(page);

    const rememberedTop = await setEffectiveScrollTop(page, 420);
    expect(rememberedTop).toBeGreaterThan(0);

    await page.getByTestId('conversation-list-item').first().evaluate((element) => {
      (element as HTMLAnchorElement).click();
    });

    await expect(page).toHaveURL(/\/app\/workspaces\/static-workspace-1\/channels\/mobile-channel-1$/);
    await expect(page.getByTestId('channel-messaging-page')).toBeVisible();
    await expect(page.getByTestId('messages-back-link')).toBeVisible();
    await expect(page.locator('.messaging-page__rail')).toBeHidden();
    await expect.poll(() => effectiveScrollTop(page)).toBe(0);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('messages-back-link').click();

    await expect(page).toHaveURL(/\/app\/messages$/);
    await expect(page.getByTestId('messages-page')).toBeVisible();
    await expect.poll(() => effectiveScrollTop(page)).toBe(rememberedTop);
  });

  test('keeps the composer input and Send reachable in a keyboard-sized viewport', async ({ page }) => {
    await page.goto('/app/dm/mobile-dm-1');

    await expect(page.getByTestId('dm-page')).toBeVisible();
    const textarea = page.getByTestId('message-draft');
    const send = page.getByTestId('send-message');
    await textarea.fill('Keyboard viewport message');
    await textarea.focus();

    await page.setViewportSize({ width: 320, height: 420 });
    await scrollEffectiveRootToEnd(page);

    await expect(textarea).toBeVisible();
    await expect(send).toBeVisible();
    await expect(send).toBeEnabled();

    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportContent).toContain('interactive-widget=resizes-content');
    expect(viewportContent).toContain('viewport-fit=cover');

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    await expect.poll(async () => {
      const box = await send.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(viewportHeight + 1);

    const textareaBox = await textarea.boundingBox();
    const sendBox = await send.boundingBox();
    expect(textareaBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(textareaBox!.x).toBeGreaterThanOrEqual(0);
    expect(textareaBox!.x + textareaBox!.width).toBeLessThanOrEqual(321);
    expect(textareaBox!.y).toBeGreaterThanOrEqual(-1);
    expect(textareaBox!.y + textareaBox!.height).toBeLessThanOrEqual(viewportHeight + 1);
    expect(sendBox!.x).toBeGreaterThanOrEqual(0);
    expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(321);
    expect(sendBox!.y).toBeGreaterThanOrEqual(-1);
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(viewportHeight + 1);
    await expectNoHorizontalOverflow(page);
  });
});

function skipDesktop(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    'Issue #351 is a mobile hierarchy and software-keyboard acceptance flow.'
  );
}

async function effectiveScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const appHost = document.getElementById('app-shell-main-content');
    const documentHost = document.scrollingElement;
    const hosts = [appHost, documentHost].filter(
      (host): host is HTMLElement => host instanceof HTMLElement
    );
    const scrollRoot =
      hosts.find((host) => host.scrollTop > 0) ??
      hosts.find((host) => host.scrollHeight > host.clientHeight + 1) ??
      hosts[0] ??
      null;
    return scrollRoot?.scrollTop ?? 0;
  });
}

async function setEffectiveScrollTop(page: Page, requestedTop: number): Promise<number> {
  return page.evaluate((top) => {
    const appHost = document.getElementById('app-shell-main-content');
    const documentHost = document.scrollingElement;
    const hosts = [appHost, documentHost].filter(
      (host): host is HTMLElement => host instanceof HTMLElement
    );
    const scrollRoot =
      hosts.find((host) => host.scrollTop > 0) ??
      hosts.find((host) => host.scrollHeight > host.clientHeight + 1) ??
      hosts[0] ??
      null;
    if (!scrollRoot) {
      return 0;
    }

    const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    scrollRoot.scrollTo({ top: Math.min(top, maxTop), left: 0, behavior: 'auto' });
    return scrollRoot.scrollTop;
  }, requestedTop);
}

async function scrollEffectiveRootToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const appHost = document.getElementById('app-shell-main-content');
    const documentHost = document.scrollingElement;
    const hosts = [appHost, documentHost].filter(
      (host): host is HTMLElement => host instanceof HTMLElement
    );
    const scrollRoot =
      hosts.find((host) => host.scrollTop > 0) ??
      hosts.find((host) => host.scrollHeight > host.clientHeight + 1) ??
      hosts[0] ??
      null;
    scrollRoot?.scrollTo({ top: scrollRoot.scrollHeight, left: 0, behavior: 'auto' });
  });
}

async function installMessagingApi(page: Page): Promise<void> {
  await page.route('**/api/conversations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: conversations })
      });
      return;
    }

    const messageMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messageMatch && method === 'GET') {
      const conversationId = messageMatch[1];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: `message-${conversationId}`,
              workspaceId,
              conversationId,
              authorUserId: 'mock-user-b',
              authorDisplayName: 'Mock User B',
              body: 'Mobile acceptance message',
              createdAt: '2026-08-23T00:00:00Z',
              version: 1
            }
          ]
        })
      });
      return;
    }

    const readMatch = path.match(/^\/api\/conversations\/([^/]+)\/read$/);
    if (readMatch && method === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    const detailMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversationId = detailMatch[1];
      const channel = conversationId.startsWith('mobile-channel');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: conversationId,
          workspaceId,
          type: channel ? 'ProjectChannel' : 'DirectMessage',
          title: channel ? 'Mobile channel' : 'Mobile DM 1',
          isArchived: false,
          isLocked: false,
          createdAt: '2026-08-22T00:00:00Z',
          updatedAt: '2026-08-23T00:00:00Z',
          members: [
            {
              userId: currentUserId,
              displayName: 'Mock User A',
              canRead: true,
              canPost: true,
              leftAt: null,
              removedAt: null
            },
            {
              userId: 'mock-user-b',
              displayName: 'Mock User B',
              canRead: true,
              canPost: true,
              leftAt: null,
              removedAt: null
            }
          ],
          mentionCandidates: [
            {
              userId: 'mock-user-b',
              displayName: 'Mock User B'
            }
          ]
        })
      });
      return;
    }

    await route.fallback();
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
