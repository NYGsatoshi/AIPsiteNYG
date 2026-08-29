import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { expectNoAccessibilityViolations } from './a11y';

const workspaceId = '11111111-1111-4111-8111-111111113368';
const conversationId = '22222222-2222-4222-8222-222222223368';
const messageId = '33333333-3333-4333-8333-333333333368';
const threadRootMessageId = '44444444-4444-4444-8444-444444443368';
const currentUserId = 'mock-user-a';

test.describe('Issue #368 saved Message follow-up', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'Issue #368 uses the 320px saved-message workflow as its representative flow.');
    await page.setViewportSize({ width: 320, height: 800 });
  });

  test('saves work independently, jumps to the exact Message, and completes accessibly without a read mutation', async ({ page }) => {
    const api = await installFollowUpApi(page);
    await page.goto('/app/messages/saved');

    const surface = page.getByTestId('saved-messages-page');
    await expect(surface).toBeVisible();
    await expect(surface).toContainText('separate from unread status and conversation Later');
    await expect(surface).toContainText('Reminders are not scheduled');
    await expect(page.getByTestId('saved-message-item')).toContainText('Follow up on this exact decision');

    const open = page.getByTestId('open-saved-message');
    const complete = page.getByTestId('complete-saved-message');
    for (const control of [open, complete]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="saved-messages-page"]');

    await open.focus();
    await open.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/app/dm/${conversationId}\\?focusMessageId=${messageId}.*threadRootMessageId=${threadRootMessageId}`));
    await expect(page.locator(`#thread-message-${messageId}`)).toBeVisible();
    await expect(page.locator(`#thread-message-${messageId}`)).toBeFocused();
    await expect(page.locator(`#thread-message-${messageId}`)).toContainText('Follow up on this exact decision');
    await expect(page.getByTestId('thread-bounded-notice')).toContainText('including the selected reply');
    expect(api.anchorRequests).toEqual([messageId]);
    expect(api.threadRequests).toEqual([threadRootMessageId]);
    expect(api.threadAnchorRequests).toEqual([messageId]);
    expect(api.readRequests).toBe(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="dm-conversation-surface"]');

    await page.goto('/app/messages/saved');
    await complete.focus();
    await complete.press('Enter');
    await expect(page.getByTestId('saved-messages-empty')).toBeVisible();
    expect(api.deleteRequests).toBe(1);
    expect(api.deleteCsrfTokens).toEqual(['csrf-message-follow-up']);
    expect(api.readRequests).toBe(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="saved-messages-page"]');
  });
});

interface FollowUpApiState {
  anchorRequests: string[];
  threadRequests: string[];
  threadAnchorRequests: string[];
  deleteRequests: number;
  deleteCsrfTokens: string[];
  readRequests: number;
}

async function installFollowUpApi(page: Page): Promise<FollowUpApiState> {
  let saved = true;
  const state: FollowUpApiState = {
    anchorRequests: [],
    threadRequests: [],
    threadAnchorRequests: [],
    deleteRequests: 0,
    deleteCsrfTokens: [],
    readRequests: 0
  };

  await page.route('**/api/security/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'csrf-message-follow-up', headerName: 'X-CSRF-Token' })
    });
  });

  await page.route('**/api/me/message-follow-ups**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/me/message-follow-ups') {
      const items = saved ? [{
        messageId,
        conversationId,
        workspaceId,
        conversationType: 'DirectMessage',
        conversationTitle: 'Decision DM',
        threadRootMessageId,
        authorDisplayName: 'Mock User B',
        body: 'Follow up on this exact decision',
        messageCreatedAt: '2026-08-29T10:00:00Z',
        savedAt: '2026-08-29T11:00:00Z'
      }] : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ page: 1, pageSize: 20, totalCount: items.length, items })
      });
      return;
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith(`/${messageId}`)) {
      state.deleteRequests += 1;
      state.deleteCsrfTokens.push(request.headers()['x-csrf-token'] ?? '');
      saved = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messageId, isSaved: false, savedAt: null })
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/messages/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET' && path === `/api/messages/${threadRootMessageId}/thread`) {
      state.threadRequests.push(threadRootMessageId);
      state.threadAnchorRequests.push(url.searchParams.get('anchorReplyMessageId') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rootMessage: messageProjection(threadRootMessageId, 'Decision thread root'),
          replies: boundedThreadReplies(),
          summary: threadSummary(101),
          hasMore: true,
          maximumReplies: 100
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/conversations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const detailMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    const readMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
    if (readMatch) {
      state.readRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK' }) });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/conversations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: conversationId, workspaceId, type: 'DirectMessage', title: 'Decision DM', unreadCount: 0, createdAt: '2026-08-29T10:00:00Z' }] })
      });
      return;
    }
    if (request.method() === 'GET' && detailMatch?.[1] === conversationId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: conversationId,
          workspaceId,
          type: 'DirectMessage',
          title: 'Decision DM',
          isLocked: false,
          isArchived: false,
          createdAt: '2026-08-29T10:00:00Z',
          members: [
            { userId: currentUserId, displayName: 'Mock User A', canRead: true, canPost: true, leftAt: null, removedAt: null },
            { userId: 'mock-user-b', displayName: 'Mock User B', canRead: true, canPost: true, leftAt: null, removedAt: null }
          ]
        })
      });
      return;
    }
    if (request.method() === 'GET' && messagesMatch?.[1] === conversationId) {
      state.anchorRequests.push(url.searchParams.get('anchorMessageId') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{
          ...messageProjection(threadRootMessageId, 'Decision thread root'),
          thread: threadSummary()
        }] })
      });
      return;
    }
    await route.fallback();
  });

  return state;
}

function messageProjection(id: string, body: string): Record<string, unknown> {
  return {
    id,
    workspaceId,
    conversationId,
    authorUserId: 'mock-user-b',
    authorDisplayName: 'Mock User B',
    body,
    attachments: [],
    createdAt: '2026-08-29T10:00:00Z',
    isDeleted: false,
    version: 1
  };
}

function boundedThreadReplies(): readonly Record<string, unknown>[] {
  const exactOldReply = {
    ...messageProjection(messageId, 'Follow up on this exact decision'),
    threadRootMessageId,
    createdAt: '2026-08-29T09:00:00Z'
  };
  const latestNinetyNine = Array.from({ length: 99 }, (_, index) => ({
    ...messageProjection(`recent-reply-${index + 1}`, `Recent reply ${index + 1}`),
    threadRootMessageId,
    createdAt: new Date(Date.UTC(2026, 7, 29, 10, 0, index + 1)).toISOString()
  }));
  return [exactOldReply, ...latestNinetyNine];
}

function threadSummary(replyCount = 1): Record<string, unknown> {
  return {
    threadRootMessageId,
    replyCount,
    latestReplyAt: '2026-08-29T10:00:00Z',
    participantDisplayNames: ['Mock User B']
  };
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
