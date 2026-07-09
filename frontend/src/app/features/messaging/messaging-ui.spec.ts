import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  AIP_AUTH_SESSION_MOCK,
  DEFAULT_AUTH_SESSION
} from '../../core/auth/auth-session.facade';
import { ChannelMessagingPageComponent } from './channel-messaging-page/channel-messaging-page.component';
import { mapMessage } from './messaging.mapper';
import { AIP_MESSAGING_PAGE_MOCK, MessagingFacade } from './messaging.facade';
import { MESSAGING_PAGE_SCENARIOS } from './messaging.mock';
import { MessagesPageComponent } from './messages-page/messages-page.component';

const currentUserId = DEFAULT_AUTH_SESSION.currentUser?.userId ?? 'mock-user-a';

async function configureHttpTest(imports: any[], conversationId = 'conversation-a'): Promise<HttpTestingController> {
  await TestBed.configureTestingModule({
    imports,
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AIP_AUTH_SESSION_MOCK,
        useValue: DEFAULT_AUTH_SESSION
      },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ workspaceId: 'workspace-a', conversationId }))
        }
      }
    ]
  }).compileComponents();

  return TestBed.inject(HttpTestingController);
}

function flushConversationOpen(httpMock: HttpTestingController, conversationId = 'conversation-a'): void {
  httpMock.expectOne('/api/conversations').flush({
    items: [
      {
        id: conversationId,
        workspaceId: 'workspace-a',
        type: 'ProjectChannel',
        title: 'General',
        unreadCount: 0,
        createdAt: '2026-07-09T00:00:00Z'
      }
    ]
  });

  httpMock.expectOne(`/api/conversations/${conversationId}`).flush({
    id: conversationId,
    workspaceId: 'workspace-a',
    type: 'ProjectChannel',
    title: 'General',
    isLocked: false,
    isArchived: false,
    members: [
      {
        userId: currentUserId,
        displayName: 'Mock User A',
        canRead: true,
        canPost: true,
        removedAt: null,
        leftAt: null
      }
    ],
    createdAt: '2026-07-09T00:00:00Z'
  });

  httpMock.expectOne(`/api/conversations/${conversationId}/messages`).flush({
    items: [
      {
        id: 'message-a',
        workspaceId: 'workspace-a',
        conversationId,
        authorUserId: 'other-user',
        authorDisplayName: 'Other User',
        body: 'Existing backend message',
        attachments: [],
        createdAt: '2026-07-09T01:00:00Z',
        isDeleted: false
      }
    ]
  });
}

describe('Messaging MVP0 backend wiring', () => {
  afterEach(() => {
    sessionStorage.clear();
    TestBed.inject(HttpTestingController, null)?.verify();
    TestBed.resetTestingModule();
  });

  it('renders a reachable conversation list from the backend', async () => {
    const httpMock = await configureHttpTest([MessagesPageComponent]);
    const fixture = TestBed.createComponent(MessagesPageComponent);

    const request = httpMock.expectOne('/api/conversations');
    expect(request.request.withCredentials).toBe(true);
    request.flush({
      items: [
        {
          id: 'conversation-a',
          workspaceId: 'workspace-a',
          type: 'ProjectChannel',
          title: 'General',
          lastMessage: { body: 'Last channel message' },
          unreadCount: 2,
          createdAt: '2026-07-09T00:00:00Z'
        },
        {
          id: 'dm-a',
          workspaceId: 'workspace-a',
          type: 'DirectMessage',
          title: null,
          unreadCount: 0,
          createdAt: '2026-07-09T00:00:00Z'
        }
      ]
    });

    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('[data-testid="conversation-list-item"]').length).toBe(2);
    expect(root.querySelector('a[href="/workspaces/workspace-a/channels/conversation-a"]')).not.toBeNull();
    expect(root.querySelector('a[href="/dm/dm-a"]')).not.toBeNull();
    expect(root.textContent).toContain('General');
  });

  it('opens an existing conversation and renders backend messages', async () => {
    const httpMock = await configureHttpTest([ChannelMessagingPageComponent]);
    const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
    flushConversationOpen(httpMock);

    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="conversation-surface"]')).not.toBeNull();
    expect(root.textContent).toContain('General');
    expect(root.textContent).toContain('Existing backend message');
  });

  it('maps own messages from the current user id', () => {
    const ownMessage = mapMessage(
      {
        id: 'message-own',
        authorUserId: currentUserId,
        authorDisplayName: 'Mock User A',
        body: 'Mine',
        createdAt: '2026-07-09T01:00:00Z',
        isDeleted: false
      },
      currentUserId
    );
    const otherMessage = mapMessage(
      {
        id: 'message-other',
        authorUserId: 'other-user',
        authorDisplayName: 'Other',
        body: 'Theirs',
        createdAt: '2026-07-09T01:01:00Z',
        isDeleted: false
      },
      currentUserId
    );

    expect(ownMessage.isOwnMessage).toBe(true);
    expect(otherMessage.isOwnMessage).toBe(false);
  });

  it('shows a pending own message during send and confirms it only after backend success', async () => {
    const httpMock = await configureHttpTest([ChannelMessagingPageComponent]);
    const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
    flushConversationOpen(httpMock);
    const facade = TestBed.inject(MessagingFacade);

    facade.setDraft('Backend-bound message');
    facade.sendDraft();
    fixture.detectChanges();

    let root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="pending-message"]')?.textContent).toContain('Backend-bound message');
    expect(texts(root, '[data-testid="confirmed-message"]').some((text) => text.includes('Backend-bound message'))).toBe(
      false
    );

    const sendRequest = httpMock.expectOne('/api/conversations/conversation-a/messages');
    expect(sendRequest.request.withCredentials).toBe(true);
    expect(sendRequest.request.body).toEqual({ body: 'Backend-bound message' });
    sendRequest.flush({
      id: 'message-created',
      workspaceId: 'workspace-a',
      conversationId: 'conversation-a',
      authorUserId: currentUserId,
      authorDisplayName: 'Mock User A',
      body: 'Backend-bound message',
      attachments: [],
      createdAt: '2026-07-09T01:05:00Z',
      isDeleted: false
    });

    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="pending-message"]')).toBeNull();
    expect(texts(root, '[data-testid="confirmed-message"]').some((text) => text.includes('Backend-bound message'))).toBe(
      true
    );
    expect(root.querySelector('.message--own')?.textContent).toContain('Backend-bound message');
    expect(root.querySelector<HTMLTextAreaElement>('[data-testid="message-draft"]')?.value).toBe('');
    expect(facade.page().sendState).toEqual({ status: 'sent', messageId: 'message-created' });
  });

  it('preserves the draft and does not show confirmed success when send fails', async () => {
    const httpMock = await configureHttpTest([ChannelMessagingPageComponent]);
    const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
    flushConversationOpen(httpMock);
    const facade = TestBed.inject(MessagingFacade);

    facade.setDraft('Do not clear me');
    facade.sendDraft();
    httpMock.expectOne('/api/conversations/conversation-a/messages').flush(
      { message: 'failed' },
      { status: 500, statusText: 'Server Error' }
    );

    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(texts(root, '[data-testid="confirmed-message"]').some((text) => text.includes('Do not clear me'))).toBe(false);
    expect(root.querySelector('[data-testid="pending-message"]')).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>('[data-testid="message-draft"]')?.value).toBe('Do not clear me');
    expect(root.textContent).toContain('Message API request failed.');
    expect(facade.page().sendState.status).toBe('failed');
  });

  it('renders attachment copy as disabled and hides unsupported paging controls', async () => {
    const httpMock = await configureHttpTest([ChannelMessagingPageComponent]);
    const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
    flushConversationOpen(httpMock);

    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="attachment-disabled"]')?.textContent).toContain(
      'Attachments are disabled'
    );
    expect(root.querySelector('[data-testid="load-older"]')).toBeNull();
    expect(root.querySelector('[data-testid="load-newer"]')).toBeNull();
  });

  it('does not expose fake retry for failed mock messages', async () => {
    await TestBed.configureTestingModule({
      imports: [ChannelMessagingPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AIP_AUTH_SESSION_MOCK,
          useValue: DEFAULT_AUTH_SESSION
        },
        { provide: AIP_MESSAGING_PAGE_MOCK, useValue: MESSAGING_PAGE_SCENARIOS.failedOutgoingRetry },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ workspaceId: 'workspace-a', conversationId: 'channel-general' }))
          }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(ChannelMessagingPageComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="failed-message"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="retry-failed-message"]')).toBeNull();
  });
});

function texts(root: HTMLElement, selector: string): readonly string[] {
  return Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? '');
}
