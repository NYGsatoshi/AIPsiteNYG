import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './a11y';

const workspaceId = 'static-workspace-362';
const conversationId = 'thread-dm-362';
const rootMessageId = 'thread-root-362';
const zeroReplyRootId = 'thread-empty-root-362';
const deletedRootMessageId = 'thread-deleted-root-362';
const currentUserId = 'mock-user-a';

test.describe('Issue #362 mobile Message thread context', () => {
  test.beforeEach(async ({ page }) => {
    await installThreadApi(page);
    await page.setViewportSize({ width: 320, height: 800 });
  });

  test('uses a dedicated 320px thread pane with keyboard focus, an isolated draft, and no overflow', async ({ page }) => {
    await page.goto(`/app/dm/${conversationId}`);

    await expect(page.getByTestId('dm-page')).toBeVisible();
    const populatedEntry = page.getByTestId(`open-message-thread-${rootMessageId}`);
    const emptyEntry = page.getByTestId(`open-message-thread-${zeroReplyRootId}`);
    const deletedEntry = page.getByTestId(`open-message-thread-${deletedRootMessageId}`);
    await expect(populatedEntry).toContainText('↳');
    await expect(populatedEntry).toContainText('1 reply');
    await expect(emptyEntry).toContainText('Reply in thread');
    await expect(page.getByTestId('message-tombstone')).toContainText('Message deleted');
    await expect(deletedEntry).toContainText('1 reply');

    const mainDraft = page.getByTestId('message-draft');
    await mainDraft.fill('Keep this main-timeline draft');
    await populatedEntry.focus();
    await populatedEntry.press('Enter');

    const thread = page.getByTestId('thread-preview');
    await expect(thread).toBeVisible();
    await expect(thread).toBeFocused();
    await expect(page.getByTestId('dm-conversation-surface')).toBeHidden();
    await expect(page.getByTestId('thread-root-message')).toContainText('Pinned parent body');
    await expect(page.getByText('Replying in thread to Mock User B')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="thread-preview"]');

    const replyDraft = page.getByTestId('thread-reply-draft');
    await replyDraft.fill('Reply from the dedicated mobile pane');
    const postPromise = page.waitForRequest(
      (request) => request.method() === 'POST' &&
        request.url().endsWith(`/api/messages/${rootMessageId}/thread/messages`)
    );
    await replyDraft.press('Enter');
    const post = await postPromise;
    expect(post.headers()['x-csrf-token']).toBe('csrf-message-thread');
    expect(post.postDataJSON()).toMatchObject({
      body: 'Reply from the dedicated mobile pane',
      mentionedUserIds: []
    });
    expect(post.postDataJSON().clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(thread).toContainText('2 replies');
    await expect(thread).toContainText('Reply from the dedicated mobile pane');
    await expectNoHorizontalOverflow(page);

    await thread.press('Escape');
    await expect(thread).toHaveCount(0);
    await expect(populatedEntry).toBeFocused();
    await expect(page.getByTestId('dm-conversation-surface')).toBeVisible();
    await expect(mainDraft).toHaveValue('Keep this main-timeline draft');
    await expectNoHorizontalOverflow(page);

    await deletedEntry.focus();
    await deletedEntry.press('Enter');
    const deletedThread = page.getByTestId('thread-preview');
    await expect(deletedThread).toBeVisible();
    await expect(deletedThread).toBeFocused();
    await expect(page.getByTestId('thread-root-message')).toContainText('Message deleted');
    await expect(page.getByTestId('thread-reply-draft')).toBeDisabled();
    await expect(page.getByTestId('thread-composer-disabled')).toContainText('parent message was deleted');
    await expect(page.getByText('Deleted parent secret')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page, '[data-testid="thread-preview"]');

    await deletedThread.press('Escape');
    await expect(deletedThread).toHaveCount(0);
    await expect(deletedEntry).toBeFocused();
  });
});

async function installThreadApi(page: Page): Promise<void> {
  let replies = [threadReply('thread-reply-362', 'Existing thread reply')];

  await page.route('**/api/security/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'csrf-message-thread', headerName: 'X-CSRF-Token' })
    });
  });

  await page.route('**/api/messages/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const threadMatch = path.match(/^\/api\/messages\/([^/]+)\/thread$/);
    const postMatch = path.match(/^\/api\/messages\/([^/]+)\/thread\/messages$/);

    if (threadMatch && request.method() === 'GET' && threadMatch[1] === rootMessageId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(threadProjection(replies))
      });
      return;
    }

    if (threadMatch && request.method() === 'GET' && threadMatch[1] === deletedRootMessageId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rootMessage: rootMessage(deletedRootMessageId, 'Deleted parent secret', true),
          replies: [threadReply('thread-deleted-root-reply-362', 'Durable reply', undefined, deletedRootMessageId)],
          summary: threadSummary(1, deletedRootMessageId),
          hasMore: false,
          maximumReplies: 100
        })
      });
      return;
    }

    if (postMatch && request.method() === 'POST' && postMatch[1] === rootMessageId) {
      const payload = request.postDataJSON() as { body?: string; clientRequestId?: string };
      const created = threadReply(
        'thread-reply-created-362',
        payload.body ?? '',
        payload.clientRequestId
      );
      replies = [...replies, created];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: created,
          summary: threadSummary(replies.length)
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/conversations**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const detailMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
    const messagesMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (path === '/api/conversations' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: conversationId,
            workspaceId,
            type: 'DirectMessage',
            title: 'Thread DM',
            unreadCount: 0,
            createdAt: '2026-08-27T00:00:00Z'
          }]
        })
      });
      return;
    }

    if (messagesMatch && request.method() === 'GET' && messagesMatch[1] === conversationId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { ...rootMessage(rootMessageId, 'Pinned parent body'), thread: threadSummary(replies.length) },
            rootMessage(zeroReplyRootId, 'Root without replies'),
            {
              ...rootMessage(deletedRootMessageId, 'Deleted parent secret', true),
              thread: threadSummary(1, deletedRootMessageId)
            }
          ]
        })
      });
      return;
    }

    if (detailMatch && request.method() === 'GET' && detailMatch[1] === conversationId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: conversationId,
          workspaceId,
          type: 'DirectMessage',
          title: 'Thread DM',
          isLocked: false,
          isArchived: false,
          createdAt: '2026-08-27T00:00:00Z',
          members: [
            {
              userId: currentUserId,
              displayName: 'Mock User A',
              canRead: true,
              canPost: true,
              canCreateThread: true,
              leftAt: null,
              removedAt: null
            },
            {
              userId: 'mock-user-b',
              displayName: 'Mock User B',
              canRead: true,
              canPost: true,
              canCreateThread: true,
              leftAt: null,
              removedAt: null
            }
          ]
        })
      });
      return;
    }

    await route.fallback();
  });
}

function threadProjection(replies: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    rootMessage: rootMessage(rootMessageId, 'Pinned parent body'),
    replies,
    summary: threadSummary(replies.length),
    hasMore: false,
    maximumReplies: 100
  };
}

function threadSummary(replyCount: number, threadRootMessageId = rootMessageId): Record<string, unknown> {
  return {
    threadRootMessageId,
    replyCount,
    latestReplyAt: replyCount > 0 ? '2026-08-27T02:00:00Z' : null,
    participantDisplayNames: replyCount > 1 ? ['Mock User B', 'Mock User A'] : ['Mock User B']
  };
}

function rootMessage(id: string, body: string, isDeleted = false): Record<string, unknown> {
  return {
    id,
    workspaceId,
    conversationId,
    authorUserId: 'mock-user-b',
    authorDisplayName: 'Mock User B',
    body,
    attachments: [],
    createdAt: '2026-08-27T01:00:00Z',
    isDeleted,
    version: 1
  };
}

function threadReply(
  id: string,
  body: string,
  clientRequestId?: string,
  threadRootMessageId = rootMessageId
): Record<string, unknown> {
  return {
    id,
    workspaceId,
    conversationId,
    authorUserId: id.includes('created') ? currentUserId : 'mock-user-b',
    authorDisplayName: id.includes('created') ? 'Mock User A' : 'Mock User B',
    body,
    attachments: [],
    createdAt: id.includes('created') ? '2026-08-27T03:00:00Z' : '2026-08-27T02:00:00Z',
    isDeleted: false,
    version: 1,
    clientRequestId,
    threadRootMessageId
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
