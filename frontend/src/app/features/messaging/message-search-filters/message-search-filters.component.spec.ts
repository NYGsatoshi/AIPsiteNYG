import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MessageSearchFiltersComponent } from './message-search-filters.component';
import { MessagingConversationListItem } from '../messaging.types';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const unreadMentionId = '22222222-2222-4222-8222-222222222222';
const unreadOnlyId = '33333333-3333-4333-8333-333333333333';
const mentionOnlyId = '44444444-4444-4444-8444-444444444444';
const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const conversations: readonly MessagingConversationListItem[] = [
  {
    id: unreadMentionId,
    kind: 'dm',
    title: 'Unread mention',
    route: `/dm/${unreadMentionId}`,
    lastActivityLabel: '10:00',
    safePreviewLabel: '',
    viewerIsParticipant: true,
    unreadCount: 2,
    hasMention: true
  },
  {
    id: unreadOnlyId,
    kind: 'channel',
    title: 'Unread only',
    route: `/workspaces/${workspaceId}/channels/${unreadOnlyId}`,
    lastActivityLabel: '09:00',
    safePreviewLabel: 'A safe preview',
    viewerIsParticipant: true,
    unreadCount: 1,
    hasMention: false
  },
  {
    id: mentionOnlyId,
    kind: 'channel',
    title: 'Mention only',
    route: `/workspaces/${workspaceId}/channels/${mentionOnlyId}`,
    lastActivityLabel: '08:00',
    safePreviewLabel: 'Another safe preview',
    viewerIsParticipant: true,
    unreadCount: 0,
    hasMention: true
  }
];

describe('MessageSearchFiltersComponent', () => {
  let fixture: ComponentFixture<MessageSearchFiltersComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageSearchFiltersComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(MessageSearchFiltersComponent);
    fixture.componentRef.setInput('conversations', conversations);
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('toggles, combines, removes, and clears authorized conversation quick filters', async () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(conversationRows(root)).toHaveLength(3);

    click(root, '[data-testid="message-filter-unread"]');
    fixture.detectChanges();
    expect(conversationRows(root)).toHaveLength(2);
    expect(testElement(root, 'message-filter-unread').getAttribute('aria-pressed')).toBe('true');
    expect(testElement(root, 'message-active-unread-chip')).not.toBeNull();
    expect(
      testElement(root, 'message-active-unread-chip').querySelector('[data-testid="filter-chip"]')
    ).not.toBeNull();
    expect(
      testElement(root, 'message-active-unread-chip').querySelector('button')?.getAttribute('aria-label')
    ).toBe('Remove filter Conversation: Unread');

    click(root, '[data-testid="message-filter-mentions"]');
    fixture.detectChanges();
    expect(conversationRows(root)).toHaveLength(1);
    expect(conversationRows(root)[0].textContent).toContain('Unread mention');
    expect(testElement(root, 'message-active-mentions-chip')).not.toBeNull();

    click(root, '[data-testid="message-active-unread-chip"] button');
    fixture.detectChanges();
    await nextTask();
    expect(conversationRows(root)).toHaveLength(2);
    expect(conversationRows(root).map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Unread mention'), expect.stringContaining('Mention only')])
    );
    expect(document.activeElement).toBe(testElement(root, 'message-filter-unread'));

    click(root, '[data-testid="message-filters-clear-all"]');
    fixture.detectChanges();
    await nextTask();
    expect(conversationRows(root)).toHaveLength(3);
    expect(root.querySelector('[data-testid="message-active-filters"]')).toBeNull();
    expect(root.textContent).not.toContain('Has file');
    expect(document.activeElement).toBe(testElement(root, 'message-search-input'));
  });

  it('uses only the canonical Message search and renders validated authorized results', () => {
    const root = fixture.nativeElement as HTMLElement;
    submitSearch(root, 'budget');

    const request = httpMock.expectOne((candidate) => candidate.url === '/api/search');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.params.get('q')).toBe('budget');
    expect(request.request.params.get('type')).toBe('Message');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('50');
    request.flush({
      items: [
        {
          type: 5,
          id: messageId,
          title: 'Unread mention',
          snippet: 'Budget decision is ready',
          route: `/conversations/${unreadMentionId}`,
          workspaceId,
          authorDisplayName: 'Authorized author'
        },
        {
          type: 'Task',
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          title: 'Wrong type',
          route: `/conversations/${unreadMentionId}`
        },
        {
          type: 'Message',
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          title: 'Unsafe route',
          route: 'https://example.test/leak'
        }
      ]
    });
    fixture.detectChanges();

    const results = root.querySelectorAll<HTMLAnchorElement>('[data-testid="message-search-result"]');
    expect(results).toHaveLength(1);
    expect(results[0].getAttribute('href')).toBe(`/dm/${unreadMentionId}`);
    expect(results[0].textContent).toContain('Budget decision is ready');
    expect(results[0].textContent).toContain('Authorized author');
    expect(testElement(root, 'message-active-search-chip').textContent).toContain('budget');
    expect(testElement(root, 'message-search-status').textContent).toContain('1 authorized message matches shown');
    expect(conversationRows(root)).toHaveLength(3);
  });

  it('offers an adjustment path for zero results and restores focus for keyboard editing', async () => {
    const root = fixture.nativeElement as HTMLElement;
    submitSearch(root, 'missing');
    httpMock.expectOne((candidate) => candidate.url === '/api/search').flush({ items: [] });
    fixture.detectChanges();

    expect(testElement(root, 'message-search-empty').textContent).toContain('Change the search or clear');
    click(root, '[data-testid="message-search-change"]');
    fixture.detectChanges();
    await nextTask();

    const input = testElement(root, 'message-search-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('[data-testid="message-search-empty"]')).toBeNull();
    expect(conversationRows(root)).toHaveLength(3);
  });

  it('cancels an obsolete search when the query changes and redacts server failures', () => {
    const root = fixture.nativeElement as HTMLElement;
    submitSearch(root, 'first query');
    const obsolete = httpMock.expectOne((candidate) => candidate.url === '/api/search');

    setSearchInput(root, 'second query');
    fixture.detectChanges();
    expect(obsolete.cancelled).toBe(true);
    expect(root.querySelector('[data-testid="message-active-search-chip"]')).toBeNull();

    submitSearch(root, 'second query');
    httpMock
      .expectOne((candidate) => candidate.url === '/api/search')
      .flush({ detail: 'private database stack and title' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const error = testElement(root, 'message-search-error').textContent ?? '';
    expect(error).toContain('temporarily unavailable');
    expect(error).not.toContain('private database stack');
  });
});

function submitSearch(root: HTMLElement, value: string): void {
  setSearchInput(root, value);
  root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function setSearchInput(root: HTMLElement, value: string): void {
  const input = testElement(root, 'message-search-input') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function click(root: HTMLElement, selector: string): void {
  root.querySelector<HTMLButtonElement>(selector)?.click();
}

function testElement(root: HTMLElement, testId: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`Expected data-testid=${testId}`);
  }
  return element;
}

function conversationRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="conversation-list-item"]'));
}

function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve));
}
