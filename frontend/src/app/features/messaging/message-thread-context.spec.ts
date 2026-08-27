import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';

import {
  AIP_AUTH_SESSION_MOCK,
  DEFAULT_AUTH_SESSION
} from '../../core/auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { ChannelMessagingPageComponent } from './channel-messaging-page/channel-messaging-page.component';
import { DmPageComponent } from './dm-page/dm-page.component';
import { MessageThreadDto } from './messaging.api';
import { AIP_MESSAGING_PAGE_MOCK, MessagingFacade } from './messaging.facade';
import {
  MessagingMessageViewModel,
  MessagingPageViewModel,
  MessagingThreadViewModel
} from './messaging.types';
import { ThreadPreviewComponent } from './thread-preview/thread-preview.component';

const currentUserId = DEFAULT_AUTH_SESSION.currentUser?.userId ?? 'mock-user-a';

describe('Issue 362 message thread contract', () => {
  afterEach(() => {
    sessionStorage.clear();
    document.getElementById('thread-trigger-root-a')?.remove();
    TestBed.inject(HttpTestingController, null)?.verify();
    TestBed.resetTestingModule();
  });

  it('keeps the main composer separate, posts to the exact thread endpoint, and reuses the idempotency key on retry', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade);
    openThread(httpMock, facade);

    facade.setDraft('Main timeline draft');
    facade.setThreadDraft('Thread-only draft');
    facade.sendThreadDraft();

    const firstPost = httpMock.expectOne('/api/messages/root-a/thread/messages');
    expect(firstPost.request.method).toBe('POST');
    expect(firstPost.request.withCredentials).toBe(true);
    expect(firstPost.request.body).toMatchObject({
      body: 'Thread-only draft',
      mentionedUserIds: []
    });
    const clientRequestId = firstPost.request.body.clientRequestId as string;
    expect(clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    firstPost.flush({}, { status: 503, statusText: 'Unavailable' });

    expect(facade.thread()).toMatchObject({
      status: 'ready',
      draft: 'Thread-only draft',
      sending: false,
      pendingClientRequestId: clientRequestId
    });
    facade.sendThreadDraft();
    const retryPost = httpMock.expectOne('/api/messages/root-a/thread/messages');
    expect(retryPost.request.body.clientRequestId).toBe(clientRequestId);
    retryPost.flush({
      message: threadReply('reply-b', 'Thread-only draft', clientRequestId),
      summary: threadSummary(2, ['Mock User B', 'Mock User A'])
    });

    expect(facade.page().draft).toBe('Main timeline draft');
    expect(facade.page().messages.map((message) => message.id)).toEqual(['root-a']);
    expect(facade.page().messages[0].thread?.replyCount).toBe(2);
    expect(facade.thread()).toMatchObject({
      status: 'ready',
      draft: '',
      sending: false,
      pendingClientRequestId: undefined,
      summary: { replyCount: 2 }
    });
    expect(facade.thread().replies.map((reply) => reply.id)).toEqual(['reply-a', 'reply-b']);
  });

  it('retains the protected projection, oversized draft, and retry key after a POST 400 revalidates successfully', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade);
    openThread(httpMock, facade);
    const oversizedDraft = 'x'.repeat(12_001);
    facade.setThreadDraft(oversizedDraft);
    facade.sendThreadDraft();

    const rejectedPost = httpMock.expectOne('/api/messages/root-a/thread/messages');
    const clientRequestId = rejectedPost.request.body.clientRequestId as string;
    rejectedPost.flush({}, { status: 400, statusText: 'Bad Request' });

    expect(facade.thread()).toMatchObject({
      status: 'ready',
      rootMessage: { id: 'root-a', body: 'Pinned parent body' },
      draft: oversizedDraft,
      sending: false,
      pendingClientRequestId: clientRequestId
    });
    httpMock.expectOne('/api/messages/root-a/thread').flush(threadDto());
    expect(facade.thread()).toMatchObject({
      status: 'ready',
      rootMessage: { id: 'root-a', body: 'Pinned parent body' },
      draft: oversizedDraft,
      pendingClientRequestId: clientRequestId
    });

    facade.sendThreadDraft();
    const retryPost = httpMock.expectOne('/api/messages/root-a/thread/messages');
    expect(retryPost.request.body.clientRequestId).toBe(clientRequestId);
    retryPost.flush({}, { status: 503, statusText: 'Unavailable' });
  });

  it('clears all protected thread state when POST 400 revalidation is denied', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade);
    openThread(httpMock, facade);
    facade.setThreadDraft('Rejected reply');
    facade.sendThreadDraft();

    httpMock.expectOne('/api/messages/root-a/thread/messages').flush(
      {},
      { status: 400, statusText: 'Bad Request' }
    );
    httpMock.expectOne('/api/messages/root-a/thread').flush(
      {},
      { status: 403, statusText: 'Forbidden' }
    );

    expect(facade.thread()).toMatchObject({
      status: 'permissionDenied',
      rootMessage: undefined,
      summary: undefined,
      replies: [],
      draft: '',
      pendingClientRequestId: undefined
    });
    expect(facade.page().messages[0].thread).toBeUndefined();
  });

  it('keeps reply events out of the main timeline and reconciles names through ordered authorized refetches', async () => {
    const events = new Subject<DurableRealtimeEvent>();
    const { httpMock, facade } = await configureFacade(events);
    openConversation(httpMock, facade);
    openThread(httpMock, facade);

    events.next(realtimeEvent('Messaging.MessageCreated.v1', {
      conversationId: 'conversation-a',
      message: {
        id: 'reply-realtime',
        conversationId: 'conversation-a',
        threadRootMessageId: 'root-a',
        body: 'Realtime reply body',
        createdAt: '2026-08-27T03:00:00Z',
        sender: { userId: 'user-c', displayName: 'New Participant' }
      }
    }));

    expect(facade.page().messages.map((message) => message.id)).toEqual(['root-a']);
    const replyRefresh = httpMock.expectOne('/api/messages/root-a/thread');
    replyRefresh.flush(threadDto({
      replies: [threadReply('reply-a'), threadReply('reply-realtime', 'Realtime reply body')],
      summary: threadSummary(2, ['Mock User B', 'New Participant'])
    }));
    expect(facade.page().messages[0].thread?.participantDisplayNames).toEqual([
      'Mock User B',
      'New Participant'
    ]);

    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      replyCount: 3,
      requiresRefetch: true
    }));
    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      replyCount: 4,
      requiresRefetch: true
    }));
    const orderedRefreshes = httpMock.match('/api/messages/root-a/thread');
    expect(orderedRefreshes).toHaveLength(2);
    orderedRefreshes[1].flush(threadDto({
      replies: [
        threadReply('reply-a'),
        threadReply('reply-realtime'),
        threadReply('reply-newer-a'),
        threadReply('reply-newer-b')
      ],
      summary: threadSummary(4, ['Newest Participant'])
    }));
    orderedRefreshes[0].flush(threadDto({
      replies: [threadReply('reply-a'), threadReply('reply-realtime'), threadReply('reply-stale')],
      summary: threadSummary(3, ['Stale Participant'])
    }));

    expect(facade.page().messages[0].thread).toMatchObject({
      replyCount: 4,
      participantDisplayNames: ['Newest Participant']
    });
    expect(facade.thread().summary).toMatchObject({
      replyCount: 4,
      participantDisplayNames: ['Newest Participant']
    });
  });

  it('does not let an older initial load replace a newer realtime reconciliation', async () => {
    const events = new Subject<DurableRealtimeEvent>();
    const { httpMock, facade } = await configureFacade(events);
    openConversation(httpMock, facade);
    facade.openThread('root-a', 'thread-trigger-root-a');
    const initialLoad = httpMock.expectOne('/api/messages/root-a/thread');

    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      replyCount: 2,
      requiresRefetch: true
    }));
    const realtimeRefresh = httpMock.expectOne('/api/messages/root-a/thread');
    realtimeRefresh.flush(threadDto({
      replies: [threadReply('reply-a'), threadReply('reply-newer')],
      summary: threadSummary(2, ['Newest Participant'])
    }));
    initialLoad.flush(threadDto({
      replies: [threadReply('reply-stale')],
      summary: threadSummary(1, ['Stale Participant'])
    }));

    expect(facade.thread().summary).toMatchObject({
      replyCount: 2,
      participantDisplayNames: ['Newest Participant']
    });
    expect(facade.thread().replies.map((reply) => reply.id)).toEqual(['reply-a', 'reply-newer']);
  });

  it('keeps a locally deleted threaded root as a bodyless anchor and reopens its disabled thread', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade, {
      authorUserId: currentUserId,
      authorDisplayName: 'Mock User A',
      body: 'Local root secret'
    });

    facade.requestMessageDelete('root-a');
    facade.confirmMessageDelete('root-a');
    const deleteRequest = httpMock.expectOne('/api/messages/root-a');
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush({ status: 'OK' });

    expect(facade.page().messages[0]).toMatchObject({
      id: 'root-a',
      body: '',
      isDeleted: true,
      thread: { replyCount: 1 }
    });
    expect(JSON.stringify(facade.page().messages[0])).not.toContain('Local root secret');
    httpMock.expectOne('/api/messages/root-a/thread').flush(threadDto({
      rootMessage: deletedRootMessage({
        authorUserId: currentUserId,
        authorDisplayName: 'Mock User A'
      })
    }));

    facade.openThread('root-a', 'thread-trigger-root-a');
    httpMock.expectOne('/api/messages/root-a/thread').flush(threadDto({
      rootMessage: deletedRootMessage({
        authorUserId: currentUserId,
        authorDisplayName: 'Mock User A'
      })
    }));
    expect(facade.thread()).toMatchObject({
      status: 'ready',
      rootMessage: { id: 'root-a', body: '', isDeleted: true },
      summary: { replyCount: 1 }
    });
  });

  it('retains and authoritatively reconciles a realtime tombstone when deletion overtakes its thread summary', async () => {
    const events = new Subject<DurableRealtimeEvent>();
    const { httpMock, facade } = await configureFacade(events);
    openConversation(httpMock, facade, {}, 0);

    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      requiresRefetch: true
    }));
    const overtakenSummary = httpMock.expectOne('/api/messages/root-a/thread');
    events.next(realtimeEvent('Messaging.MessageDeleted.v1', {
      conversationId: 'conversation-a',
      messageId: 'root-a',
      messageVersion: 2
    }));
    const deletionRevalidation = httpMock.expectOne('/api/messages/root-a/thread');

    expect(facade.page().messages[0]).toMatchObject({ body: '', isDeleted: true });
    overtakenSummary.flush(threadDto({ summary: threadSummary(1, ['Stale participant']) }));
    deletionRevalidation.flush(threadDto({ rootMessage: deletedRootMessage() }));

    expect(facade.page().messages[0]).toMatchObject({
      id: 'root-a',
      body: '',
      isDeleted: true,
      version: 2,
      thread: { replyCount: 1, participantDisplayNames: ['Mock User B'] }
    });
    expect(JSON.stringify(facade.page().messages[0])).not.toContain('Pinned parent body');
  });

  it('does not treat a transient deletion revalidation failure as proof of zero replies', async () => {
    const events = new Subject<DurableRealtimeEvent>();
    const { httpMock, facade } = await configureFacade(events);
    openConversation(httpMock, facade, {}, 0);

    events.next(realtimeEvent('Messaging.MessageDeleted.v1', {
      conversationId: 'conversation-a',
      messageId: 'root-a',
      messageVersion: 2
    }));
    httpMock.expectOne('/api/messages/root-a/thread').flush(
      {},
      { status: 503, statusText: 'Unavailable' }
    );
    expect(facade.page()).toMatchObject({
      realtimeDegraded: true,
      messages: [{ id: 'root-a', body: '', isDeleted: true }]
    });

    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      requiresRefetch: true
    }));
    httpMock.expectOne('/api/messages/root-a/thread').flush(threadDto({
      rootMessage: deletedRootMessage(),
      replies: [],
      summary: threadSummary(0, [])
    }));
    expect(facade.page().messages).toEqual([]);
  });

  it('maps a deleted threaded root returned by a conversation reload without restoring its body', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade, { isDeleted: true, body: 'Deleted reload secret' });

    expect(facade.page().messages[0]).toMatchObject({
      id: 'root-a',
      body: '',
      isDeleted: true,
      thread: { replyCount: 1 }
    });
    expect(JSON.stringify(facade.page().messages[0])).not.toContain('Deleted reload secret');
  });

  it('rejects a malformed reply identity from the authoritative POST projection', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade);
    openThread(httpMock, facade);
    facade.setThreadDraft('Malformed response test');
    facade.sendThreadDraft();

    httpMock.expectOne('/api/messages/root-a/thread/messages').flush({
      message: { ...threadReply('', 'Malformed response test'), id: undefined },
      summary: threadSummary(2, ['Mock User B'])
    });

    expect(facade.thread()).toMatchObject({
      status: 'error',
      rootMessage: undefined,
      summary: undefined,
      replies: []
    });
    expect(facade.page().messages[0].thread).toBeUndefined();
  });

  it('clears parent, replies, count, and participant names together after an authorization failure', async () => {
    const events = new Subject<DurableRealtimeEvent>();
    const { httpMock, facade } = await configureFacade(events);
    openConversation(httpMock, facade);
    openThread(httpMock, facade);

    expect(facade.thread().rootMessage?.body).toBe('Pinned parent body');
    expect(facade.thread().summary?.participantDisplayNames).toEqual(['Mock User B']);
    events.next(realtimeEvent('Messaging.ThreadChanged.v1', {
      conversationId: 'conversation-a',
      threadRootMessageId: 'root-a',
      requiresRefetch: true
    }));
    httpMock.expectOne('/api/messages/root-a/thread').flush(
      {},
      { status: 403, statusText: 'Forbidden' }
    );

    expect(facade.thread()).toMatchObject({
      status: 'permissionDenied',
      rootMessage: undefined,
      summary: undefined,
      replies: []
    });
    expect(facade.page().messages[0].thread).toBeUndefined();
    expect(JSON.stringify(facade.thread())).not.toContain('Mock User B');
    expect(JSON.stringify(facade.thread())).not.toContain('Pinned parent body');
  });

  it('returns focus to the native timeline trigger when the thread closes', async () => {
    const { httpMock, facade } = await configureFacade();
    openConversation(httpMock, facade);
    const trigger = document.createElement('button');
    trigger.id = 'thread-trigger-root-a';
    document.body.append(trigger);
    openThread(httpMock, facade, trigger.id);

    facade.closeThread();
    await Promise.resolve();

    expect(facade.thread().status).toBe('closed');
    expect(document.activeElement).toBe(trigger);
  });
});

describe('ThreadPreviewComponent', () => {
  let fixture: ComponentFixture<ThreadPreviewComponent>;

  afterEach(() => TestBed.resetTestingModule());

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ThreadPreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(ThreadPreviewComponent);
    fixture.componentRef.setInput('thread', threadViewModel());
    fixture.componentRef.setInput('canPost', true);
    fixture.componentRef.setInput('canCreateThread', true);
    fixture.detectChanges();
  });

  it('pins the parent, discloses bounded loading, and uses a separate reply context', async () => {
    await Promise.resolve();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="thread-root-message"]')?.textContent).toContain('Pinned parent body');
    expect(root.querySelector('[data-testid="thread-bounded-notice"]')?.textContent).toContain(
      'Showing the latest 100 of 101 replies'
    );
    expect(root.querySelector('label[for="thread-reply-draft"]')?.textContent).toContain(
      'Replying in thread to Mock User B'
    );
    expect(document.activeElement).toBe(root.querySelector('[data-testid="thread-preview"]'));
  });

  it('supports Enter, Shift+Enter, IME, Escape, and native back/close controls', () => {
    const send = vi.spyOn(fixture.componentInstance.send, 'emit');
    const close = vi.spyOn(fixture.componentInstance.close, 'emit');
    const textarea = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLTextAreaElement>('[data-testid="thread-reply-draft"]')!;

    textarea.value = 'Keyboard reply';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(send).toHaveBeenCalledWith([]);

    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="thread-preview"]')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
    const back = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="thread-back"]')!;
    const closeButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="thread-close"]')!;
    expect(back.type).toBe('button');
    expect(closeButton.type).toBe('button');
    back.click();
    closeButton.click();
    expect(close).toHaveBeenCalledTimes(3);
  });

  it.each(['thread-back', 'thread-close'])('does not steal focus from %s when loading completes', async (testId) => {
    const pendingFixture = TestBed.createComponent(ThreadPreviewComponent);
    pendingFixture.componentRef.setInput('thread', {
      ...threadViewModel(),
      status: 'loading',
      rootMessage: undefined,
      replies: [],
      summary: undefined
    });
    pendingFixture.componentRef.setInput('canPost', true);
    pendingFixture.componentRef.setInput('canCreateThread', true);
    pendingFixture.detectChanges();
    await Promise.resolve();
    const control = (pendingFixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
    control.focus();

    pendingFixture.componentRef.setInput('thread', threadViewModel());
    pendingFixture.detectChanges();
    await Promise.resolve();

    expect(document.activeElement).toBe(control);
    pendingFixture.destroy();
  });

  it('renders durable reply tombstones and disables posting to a deleted parent', () => {
    const current = threadViewModel();
    fixture.componentRef.setInput('thread', {
      ...current,
      rootMessage: { ...current.rootMessage!, isDeleted: true, body: '' },
      replies: [{ ...current.replies[0], isDeleted: true, body: '' }]
    });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('.thread__tombstone')).toHaveLength(2);
    expect(root.querySelector<HTMLTextAreaElement>('[data-testid="thread-reply-draft"]')?.disabled).toBe(true);
    expect(root.querySelector('[data-testid="thread-composer-disabled"]')?.textContent).toContain(
      'parent message was deleted'
    );
  });
});

describe('Message thread route wiring', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens and closes the contextual channel panel from the visible reply-count entry', async () => {
    const fixture = await renderRouteThread(ChannelMessagingPageComponent, 'channel', 2);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[data-testid="open-message-thread-root-a"]')!;

    expect(trigger.textContent).toContain('↳');
    expect(trigger.textContent).toContain('2 replies');
    trigger.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="thread-preview"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="thread-close"]')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(root.querySelector('[data-testid="thread-preview"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens and closes the shared DM panel from the zero-reply entry', async () => {
    const fixture = await renderRouteThread(DmPageComponent, 'dm', 0);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[data-testid="open-message-thread-root-a"]')!;

    expect(trigger.textContent).toContain('↳');
    expect(trigger.textContent).toContain('Reply in thread');
    trigger.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="thread-preview"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="thread-back"]')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(root.querySelector('[data-testid="thread-preview"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps a deleted threaded parent readable and keyboard-reopenable without rendering its body', async () => {
    const fixture = await renderRouteThread(DmPageComponent, 'dm', 1, true);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[data-testid="open-message-thread-root-a"]')!;

    expect(root.querySelector('[data-testid="message-tombstone"]')?.textContent).toContain('Message deleted');
    expect(root.textContent).not.toContain('Pinned parent body');
    expect(trigger.textContent).toContain('1 reply');
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    const panel = root.querySelector<HTMLElement>('[data-testid="thread-preview"]')!;
    expect(panel).not.toBeNull();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await Promise.resolve();

    expect(root.querySelector('[data-testid="thread-preview"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

async function configureFacade(events = new Subject<DurableRealtimeEvent>()): Promise<{
  readonly httpMock: HttpTestingController;
  readonly facade: MessagingFacade;
}> {
  await TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_AUTH_SESSION_MOCK, useValue: DEFAULT_AUTH_SESSION },
      {
        provide: FrontendFeatureFlagsService,
        useValue: {
          realtimeSignalREnabled: () => false,
          optimisticMessagingEnabled: () => true
        }
      },
      {
        provide: RealtimeFacade,
        useValue: {
          durableEvents$: events.asObservable(),
          registerProtectedStateClearer: () => () => undefined,
          registerSubscription: () => () => undefined,
          registerCatchUp: () => () => undefined
        }
      }
    ]
  }).compileComponents();
  return {
    httpMock: TestBed.inject(HttpTestingController),
    facade: TestBed.inject(MessagingFacade)
  };
}

function openConversation(
  httpMock: HttpTestingController,
  facade: MessagingFacade,
  rootOverrides: Record<string, unknown> = {},
  replyCount = 1
): void {
  facade.loadConversation('conversation-a', 'channel', 'workspace-a');
  httpMock.expectOne('/api/conversations').flush({ items: [] });
  httpMock.expectOne('/api/conversations/conversation-a').flush({
    id: 'conversation-a',
    workspaceId: 'workspace-a',
    type: 'ProjectChannel',
    title: 'General',
    isLocked: false,
    isArchived: false,
    members: [{
      userId: currentUserId,
      displayName: 'Mock User A',
      canRead: true,
      canPost: true,
      canCreateThread: true,
      removedAt: null,
      leftAt: null
    }]
  });
  httpMock.expectOne('/api/conversations/conversation-a/messages').flush({
    items: [{
      ...rootMessage(),
      ...rootOverrides,
      thread: replyCount > 0 ? threadSummary(replyCount, ['Mock User B']) : undefined
    }]
  });
}

function openThread(
  httpMock: HttpTestingController,
  facade: MessagingFacade,
  triggerElementId = 'thread-trigger-root-a'
): void {
  facade.openThread('root-a', triggerElementId);
  const request = httpMock.expectOne('/api/messages/root-a/thread');
  expect(request.request.method).toBe('GET');
  expect(request.request.withCredentials).toBe(true);
  request.flush(threadDto());
}

function threadDto(overrides: Partial<MessageThreadDto> = {}): MessageThreadDto {
  return {
    rootMessage: rootMessage(),
    replies: [threadReply('reply-a')],
    summary: threadSummary(1, ['Mock User B']),
    hasMore: false,
    maximumReplies: 100,
    ...overrides
  };
}

function rootMessage(): Record<string, unknown> {
  return {
    id: 'root-a',
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    authorUserId: 'mock-user-b',
    authorDisplayName: 'Mock User B',
    body: 'Pinned parent body',
    attachments: [],
    createdAt: '2026-08-27T01:00:00Z',
    isDeleted: false,
    version: 1
  };
}

function deletedRootMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...rootMessage(),
    body: '',
    attachments: [],
    isDeleted: true,
    version: 2,
    ...overrides
  };
}

function threadReply(
  id: string,
  body = 'Existing reply',
  clientRequestId?: string
): Record<string, unknown> {
  return {
    id,
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    authorUserId: 'mock-user-b',
    authorDisplayName: 'Mock User B',
    body,
    attachments: [],
    createdAt: '2026-08-27T02:00:00Z',
    isDeleted: false,
    version: 1,
    clientRequestId,
    threadRootMessageId: 'root-a'
  };
}

function threadSummary(replyCount: number, participantDisplayNames: readonly string[]): Record<string, unknown> {
  return {
    threadRootMessageId: 'root-a',
    replyCount,
    latestReplyAt: replyCount > 0 ? '2026-08-27T02:00:00Z' : null,
    participantDisplayNames
  };
}

function realtimeEvent(
  eventType: DurableRealtimeEvent['eventType'],
  payload: Record<string, unknown>
): DurableRealtimeEvent {
  return {
    eventId: `event-${eventType}-${Math.random()}`,
    eventType,
    payloadSchemaVersion: 1,
    occurredAt: '2026-08-27T03:00:00Z',
    tenantId: 'tenant-a',
    aggregateType: 'Message',
    aggregateId: 'root-a',
    aggregateVersion: 1,
    actor: { actorType: 'User', actorId: 'mock-user-b' },
    correlationId: null,
    causationId: null,
    payload
  };
}

function threadViewModel(): MessagingThreadViewModel {
  return {
    status: 'ready',
    rootMessageId: 'root-a',
    rootMessage: messageViewModel('root-a', 'Pinned parent body'),
    replies: [messageViewModel('reply-a', 'Existing reply', 'root-a')],
    summary: {
      threadRootMessageId: 'root-a',
      replyCount: 101,
      latestReplyAt: '2026-08-27T02:00:00Z',
      participantDisplayNames: ['Mock User B']
    },
    hasMore: true,
    maximumReplies: 100,
    draft: 'Thread draft',
    sending: false
  };
}

function messageViewModel(
  id: string,
  body: string,
  threadRootMessageId?: string
): MessagingMessageViewModel {
  return {
    id,
    authorLabel: 'Mock User B',
    authorRoleLabel: 'member',
    isOwnMessage: false,
    body,
    isDeleted: false,
    createdAt: '2026-08-27T01:00:00Z',
    sentAtLabel: '8/27/2026, 10:00:00 AM',
    deliveryState: 'confirmed',
    retryAllowed: false,
    threadRootMessageId
  };
}

async function renderRouteThread<T>(
  component: Type<T>,
  routeKind: 'channel' | 'dm',
  replyCount: number,
  isDeleted = false
): Promise<ComponentFixture<T>> {
  const events = new Subject<DurableRealtimeEvent>();
  const routeParams = routeKind === 'channel'
    ? { workspaceId: 'workspace-a', conversationId: 'conversation-a' }
    : { conversationId: 'conversation-a' };
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_AUTH_SESSION_MOCK, useValue: DEFAULT_AUTH_SESSION },
      { provide: AIP_MESSAGING_PAGE_MOCK, useValue: routePage(routeKind, replyCount, isDeleted) },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap(routeParams)) }
      },
      {
        provide: FrontendFeatureFlagsService,
        useValue: {
          realtimeSignalREnabled: () => false,
          optimisticMessagingEnabled: () => true
        }
      },
      {
        provide: RealtimeFacade,
        useValue: {
          connectionState: signal('Connected'),
          durableEvents$: events.asObservable(),
          registerProtectedStateClearer: () => () => undefined,
          registerSubscription: () => () => undefined,
          registerCatchUp: () => () => undefined
        }
      }
    ]
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture;
}

function routePage(
  routeKind: 'channel' | 'dm',
  replyCount: number,
  isDeleted = false
): MessagingPageViewModel {
  return {
    routeKind,
    status: 'ready',
    title: routeKind === 'dm' ? 'Thread DM' : 'Thread channel',
    conversation: {
      id: 'conversation-a',
      kind: routeKind,
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      title: routeKind === 'dm' ? 'Thread DM' : 'Thread channel',
      subtitle: 'Thread route test',
      viewerIsParticipant: true,
      viewerWasRemoved: false,
      capabilities: ['readBody', 'postMessage', 'createThread'],
      mentionCandidates: [],
      attachment: { mode: 'disabled', label: 'Attachments disabled.' }
    },
    conversations: [],
    messages: [{
      ...messageViewModel('root-a', isDeleted ? '' : 'Pinned parent body'),
      isDeleted,
      thread: replyCount > 0
        ? {
            threadRootMessageId: 'root-a',
            replyCount,
            latestReplyAt: '2026-08-27T02:00:00Z',
            participantDisplayNames: ['Mock User B']
          }
        : undefined
    }],
    draft: '',
    sending: false,
    sendState: { status: 'idle' },
    hasNewMessagesWhileReading: false,
    readCursorBehavior: 'latestVisibleMessage',
    pagingWindow: { visibleMessageIds: ['root-a'], preloadBefore: 0, preloadAfter: 0 }
  };
}
