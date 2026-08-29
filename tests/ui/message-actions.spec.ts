import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { expectNoAccessibilityViolations } from './a11y';

const workspaceId = 'static-workspace-343';
const currentUserId = 'mock-user-a';
const ownMessageId = 'own-message-343';
const otherMessageId = 'other-message-343';

test.describe('Issue #343 non-closing Message action subset', () => {
  let apiState: MessageActionApiState;

  test.beforeEach(async ({ page }, testInfo) => {
    apiState = await installMessageActionApi(page);
    await page.setViewportSize(
      testInfo.project.name === 'chromium-mobile'
        ? { width: 320, height: 800 }
        : { width: 960, height: 800 }
    );
  });

  test('keeps Edit, Delete, and Report keyboard-operable through More without leaking generic failures', async ({ page }, testInfo) => {
    await page.goto('/app/dm/action-dm-343');

    await expect(page.getByTestId('dm-page')).toBeVisible();
    const ownMore = page.getByTestId(`message-more-actions-${ownMessageId}`);
    await expect(ownMore).toBeVisible();
    const ownMoreBox = await ownMore.boundingBox();
    expect(ownMoreBox?.width).toBeGreaterThanOrEqual(44);
    expect(ownMoreBox?.height).toBeGreaterThanOrEqual(44);

    await ownMore.focus();
    if (testInfo.project.name === 'chromium-mobile') {
      await ownMore.tap();
    } else {
      await ownMore.press('Enter');
    }
    await expect(ownMore).toHaveAttribute('aria-expanded', 'true');
    const edit = page.getByTestId(`edit-message-${ownMessageId}`);
    const deleteAction = page.getByTestId(`delete-message-${ownMessageId}`);
    const reportAction = page.getByTestId(`report-message-${ownMessageId}`);
    await expect(edit).toBeVisible();
    await expect(deleteAction).toBeVisible();
    await expect(reportAction).toBeVisible();
    for (const action of [edit, deleteAction, reportAction]) {
      const box = await action.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    if (testInfo.project.name === 'chromium-mobile') {
      await expectNoHorizontalOverflow(page);
    }
    await expectNoAccessibilityViolations(page, '[data-testid="message-timeline"]');
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Enter');

    const editInput = page.getByTestId(`message-edit-input-${ownMessageId}`);
    await expect(editInput).toBeFocused();
    await editInput.fill('Edited through the current PATCH endpoint');
    const patchPromise = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().endsWith(`/api/messages/${ownMessageId}`)
    );
    const save = page.getByTestId(`save-message-edit-${ownMessageId}`);
    await save.focus();
    await save.press('Enter');
    const patch = await patchPromise;
    expect(patch.postDataJSON()).toEqual({ body: 'Edited through the current PATCH endpoint' });
    expect(patch.headers()['x-csrf-token']).toBe('csrf-message-actions');
    await expect(page.getByTestId('message-edited-marker')).toBeVisible();
    await expect(page.locator('#message-timeline')).toBeFocused();

    await ownMore.focus();
    await ownMore.press('Enter');
    await deleteAction.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Delete message?' })).toBeVisible();
    await expectNoAccessibilityViolations(page, '[role="dialog"]');
    expect(apiState.deleteRequests).toBe(0);
    await expect(page.getByTestId(`message-more-actions-${ownMessageId}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete message' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(ownMore).toBeFocused();
    expect(apiState.deleteRequests).toBe(0);

    await ownMore.press('Enter');
    await page.getByTestId(`delete-message-${ownMessageId}`).press('Enter');
    const deleteDialog = page.getByRole('dialog', { name: 'Delete message?' });
    await expect(deleteDialog).toBeVisible();
    const deletePromise = page.waitForRequest(
      (request) => request.method() === 'DELETE' && request.url().endsWith(`/api/messages/${ownMessageId}`)
    );
    await deleteDialog.getByRole('button', { name: 'Delete message', exact: true }).press('Enter');
    const deleteRequest = await deletePromise;
    expect(deleteRequest.headers()['x-csrf-token']).toBe('csrf-message-actions');
    expect(apiState.deleteRequests).toBe(1);
    await expect(page.locator(`#message-${ownMessageId}`)).toHaveCount(0);
    await expect(page.locator('#message-timeline')).toBeFocused();

    const otherMore = page.getByTestId(`message-more-actions-${otherMessageId}`);
    await otherMore.focus();
    await otherMore.press('Enter');
    await expect(page.getByTestId(`edit-message-${otherMessageId}`)).toHaveCount(0);
    await expect(page.getByTestId(`delete-message-${otherMessageId}`)).toHaveCount(0);
    if (testInfo.project.name === 'chromium-mobile') {
      await page.getByTestId(`report-message-${otherMessageId}`).tap();
    } else {
      await page.getByTestId(`report-message-${otherMessageId}`).press('Enter');
    }
    await expect(page.getByRole('dialog', { name: 'Report message' })).toBeVisible();

    const failedReport = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith(`/api/messages/${otherMessageId}/report`)
    );
    await page.getByRole('button', { name: 'Record report request' }).press('Enter');
    expect((await failedReport).status()).toBe(400);
    await expect(page.getByText('SECRET_ACTION_DENIAL_DO_NOT_RENDER')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toContainText('This message action is no longer available.');

    const successfulReport = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith(`/api/messages/${otherMessageId}/report`)
    );
    await page.getByRole('button', { name: 'Record report request' }).press('Enter');
    const reportRequest = await successfulReport;
    expect(reportRequest.postDataJSON()).toEqual({ reasonCode: 'reported' });
    expect(reportRequest.headers()['x-csrf-token']).toBe('csrf-message-actions');
    await expect(page.getByTestId('message-action-status')).toContainText('Report request recorded.');

    if (testInfo.project.name === 'chromium-mobile') {
      await expectNoHorizontalOverflow(page);
    }
  });
});

interface MessageActionApiState {
  deleteRequests: number;
}

async function installMessageActionApi(page: Page): Promise<MessageActionApiState> {
  let reportAttempts = 0;
  const state: MessageActionApiState = { deleteRequests: 0 };

  await page.route('**/api/security/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'csrf-message-actions', headerName: 'X-CSRF-Token' })
    });
  });

  await page.route('**/api/messages/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const messageMatch = url.pathname.match(/^\/api\/messages\/([^/]+)(\/report)?$/);
    if (!messageMatch) {
      await route.fallback();
      return;
    }

    const messageId = messageMatch[1];
    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON() as { body?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messageDto(messageId, payload.body ?? ''))
      });
      return;
    }

    if (request.method() === 'DELETE') {
      state.deleteRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK' }) });
      return;
    }

    if (request.method() === 'POST' && messageMatch[2] === '/report') {
      reportAttempts += 1;
      if (reportAttempts === 1) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'SECRET_ACTION_DENIAL_DO_NOT_RENDER' })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK' }) });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/conversations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
    const messagesMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (path === '/api/conversations' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'action-dm-343',
            workspaceId,
            type: 'DirectMessage',
            title: 'Action DM',
            unreadCount: 0,
            createdAt: '2026-08-24T00:00:00Z'
          }]
        })
      });
      return;
    }

    if (messagesMatch && request.method() === 'GET') {
      const conversationId = messagesMatch[1];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { ...messageDto(otherMessageId, 'A visible message from another participant'), conversationId, authorUserId: 'mock-user-b', authorDisplayName: 'Mock User B' },
            { ...messageDto(ownMessageId, 'An editable message from the current participant'), conversationId }
          ]
        })
      });
      return;
    }

    if (conversationMatch && request.method() === 'GET') {
      const conversationId = conversationMatch[1];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: conversationId,
          workspaceId,
          type: 'DirectMessage',
          title: 'Action DM',
          isLocked: false,
          isArchived: false,
          createdAt: '2026-08-24T00:00:00Z',
          members: [
            { userId: currentUserId, displayName: 'Mock User A', canRead: true, canPost: true, leftAt: null, removedAt: null },
            { userId: 'mock-user-b', displayName: 'Mock User B', canRead: true, canPost: true, leftAt: null, removedAt: null }
          ]
        })
      });
      return;
    }

    await route.fallback();
  });

  return state;
}

function messageDto(id: string, body: string): Record<string, unknown> {
  return {
    id,
    workspaceId,
    conversationId: 'action-dm-343',
    authorUserId: currentUserId,
    authorDisplayName: 'Mock User A',
    body,
    attachments: [],
    createdAt: '2026-08-24T00:01:00Z',
    editedAt: id === ownMessageId && body.startsWith('Edited') ? '2026-08-24T00:02:00Z' : null,
    isDeleted: false,
    version: id === ownMessageId && body.startsWith('Edited') ? 2 : 1
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
