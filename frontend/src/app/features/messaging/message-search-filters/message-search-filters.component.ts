import { Component, ElementRef, Input, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { MessageSearchResponseDto, MessagingApi } from '../messaging.api';
import { MessagingConversationListItem } from '../messaging.types';

type MessageSearchStatus = 'idle' | 'invalid' | 'loading' | 'ready' | 'empty' | 'error';

interface MessageSearchResult {
  readonly messageId: string;
  readonly conversationId: string;
  readonly title: string;
  readonly snippet: string;
  readonly authorDisplayName: string;
  readonly route: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATION_ROUTE_PATTERN = /^\/conversations\/([0-9a-f-]+)$/i;

@Component({
  selector: 'app-message-search-filters',
  standalone: true,
  imports: [ConversationListComponent, RouterLink],
  template: `
    <section
      class="message-discovery"
      aria-label="Find conversations and messages"
      data-testid="message-search-filters"
    >
      <button
        #mobileToggle
        type="button"
        class="message-discovery__mobile-toggle"
        data-testid="message-filter-drawer-toggle"
        aria-controls="message-search-filter-controls"
        [attr.aria-expanded]="mobilePanelOpen()"
        (click)="toggleMobilePanel()"
      >
        Search and filter messages
      </button>

      <div
        id="message-search-filter-controls"
        class="message-discovery__controls"
        [class.message-discovery__controls--open]="mobilePanelOpen()"
        (keydown.escape)="closeMobilePanel($event)"
      >
        <form
          class="message-discovery__search"
          role="search"
          [attr.aria-busy]="searchStatus() === 'loading'"
          (submit)="submitSearch($event)"
        >
          <label for="message-search-input">Search messages</label>
          <div class="message-discovery__search-control">
            <input
              #searchInput
              id="message-search-input"
              type="search"
              data-testid="message-search-input"
              autocomplete="off"
              maxlength="120"
              placeholder="Search message text or conversation title"
              aria-describedby="message-search-scope message-search-status"
              [value]="query()"
              (input)="updateQuery($event)"
            />
            <button type="submit" data-testid="message-search-submit" [disabled]="searchStatus() === 'loading'">
              {{ searchStatus() === 'loading' ? 'Searching' : 'Search' }}
            </button>
          </div>
          <p id="message-search-scope" class="message-discovery__scope">
            Searches only messages and conversation titles you can currently access.
          </p>
          <p
            id="message-search-status"
            class="message-discovery__status"
            data-testid="message-search-status"
            aria-live="polite"
          >
            @switch (searchStatus()) {
              @case ('invalid') {
                Enter at least 2 characters.
              }
              @case ('loading') {
                Searching your accessible conversations.
              }
              @case ('ready') {
                {{ searchResults().length }} authorized message matches shown.
              }
              @case ('empty') {
                No matching messages were found.
              }
              @case ('error') {
                Message search is unavailable. Try again.
              }
            }
          </p>
        </form>

        <div class="message-discovery__quick-filters" role="group" aria-labelledby="message-quick-filter-label">
          <span id="message-quick-filter-label">Conversation filters</span>
          <div class="message-discovery__quick-filter-buttons">
            <button
              #unreadFilter
              type="button"
              data-testid="message-filter-unread"
              [class.message-discovery__quick-filter--active]="unreadOnly()"
              [attr.aria-pressed]="unreadOnly()"
              (click)="toggleUnread()"
            >
              Unread
            </button>
            <button
              #mentionsFilter
              type="button"
              data-testid="message-filter-mentions"
              [class.message-discovery__quick-filter--active]="mentionsOnly()"
              [attr.aria-pressed]="mentionsOnly()"
              (click)="toggleMentions()"
            >
              &#64;Me
            </button>
          </div>
        </div>
      </div>

      @if (hasActiveConditions()) {
        <section class="message-discovery__active" aria-labelledby="message-active-filter-label">
          <div class="message-discovery__active-heading">
            <h2 id="message-active-filter-label">Active conditions</h2>
            <button type="button" data-testid="message-filters-clear-all" (click)="clearAll()">Clear all</button>
          </div>
          <div class="message-discovery__active-chips" data-testid="message-active-filters">
            @if (appliedQuery()) {
              <button
                type="button"
                class="message-discovery__active-chip"
                data-testid="message-active-search-chip"
                [attr.aria-label]="'Remove search condition: ' + appliedQuery()"
                (click)="clearSearch(true)"
              >
                Search: “{{ appliedQuery() }}” <span aria-hidden="true">×</span>
              </button>
            }
            @if (unreadOnly()) {
              <button
                type="button"
                class="message-discovery__active-chip"
                data-testid="message-active-unread-chip"
                aria-label="Remove Unread conversation filter"
                (click)="toggleUnread(true)"
              >
                Unread <span aria-hidden="true">×</span>
              </button>
            }
            @if (mentionsOnly()) {
              <button
                type="button"
                class="message-discovery__active-chip"
                data-testid="message-active-mentions-chip"
                aria-label="Remove @Me conversation filter"
                (click)="toggleMentions(true)"
              >
                &#64;Me <span aria-hidden="true">×</span>
              </button>
            }
          </div>
        </section>
      }

      @if (appliedQuery()) {
        <section class="message-discovery__matches" aria-labelledby="message-search-results-title">
          <h2 id="message-search-results-title">Message matches</h2>
          @if (searchStatus() === 'loading') {
            <p class="message-discovery__muted" data-testid="message-search-loading">Searching messages...</p>
          } @else if (searchStatus() === 'error') {
            <div class="message-discovery__result-state" data-testid="message-search-error">
              <p>Message search is temporarily unavailable. No server error detail is shown.</p>
              <button type="button" (click)="retrySearch()">Try again</button>
            </div>
          } @else if (searchStatus() === 'empty') {
            <div class="message-discovery__result-state" data-testid="message-search-empty">
              <p>No messages match “{{ appliedQuery() }}”. Change the search or clear the active conditions.</p>
              <div class="message-discovery__result-actions">
                <button type="button" data-testid="message-search-change" (click)="changeSearch()">
                  Change search
                </button>
                <button type="button" data-testid="message-search-clear-empty" (click)="clearAll()">Clear all</button>
              </div>
            </div>
          } @else if (searchStatus() === 'ready') {
            <ul class="message-discovery__results" data-testid="message-search-results">
              @for (result of searchResults(); track result.messageId) {
                <li>
                  <a class="message-discovery__result" data-testid="message-search-result" [routerLink]="result.route">
                    <span class="message-discovery__result-title">{{ result.title }}</span>
                    @if (result.snippet) {
                      <span class="message-discovery__result-snippet">{{ result.snippet }}</span>
                    }
                    @if (result.authorDisplayName) {
                      <span class="message-discovery__result-author">From {{ result.authorDisplayName }}</span>
                    }
                  </a>
                </li>
              }
            </ul>
          }
        </section>
      }

      <section class="message-discovery__conversations" aria-labelledby="message-conversation-results-title">
        <h2 id="message-conversation-results-title">Conversations</h2>
        @if (filteredConversations().length > 0) {
          <app-conversation-list
            [conversations]="filteredConversations()"
            [selectedConversationId]="selectedConversationId"
            [preserveListScroll]="preserveListScroll"
            [showUnreadBadges]="showUnreadBadges"
          />
        } @else if (conversationState().length > 0) {
          <div class="message-discovery__result-state" data-testid="message-conversation-filter-empty">
            <p>No conversations match the active quick filters.</p>
            <button
              type="button"
              data-testid="message-conversation-filters-clear"
              (click)="clearConversationFilters(true)"
            >
              Clear conversation filters
            </button>
          </div>
        } @else {
          <ng-content select="[message-search-empty]" />
        }
      </section>
    </section>
  `,
  styleUrl: './message-search-filters.component.scss'
})
export class MessageSearchFiltersComponent implements OnDestroy {
  private readonly api = inject(MessagingApi);
  private request: Subscription | null = null;
  private requestGeneration = 0;

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('mobileToggle') private mobileToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('unreadFilter') private unreadFilter?: ElementRef<HTMLButtonElement>;
  @ViewChild('mentionsFilter') private mentionsFilter?: ElementRef<HTMLButtonElement>;

  readonly conversationState = signal<readonly MessagingConversationListItem[]>([]);

  @Input({ required: true })
  set conversations(value: readonly MessagingConversationListItem[]) {
    this.conversationState.set(value ?? []);
  }

  @Input() selectedConversationId: string | null = null;
  @Input() preserveListScroll = false;
  @Input() showUnreadBadges = true;

  readonly query = signal('');
  readonly appliedQuery = signal('');
  readonly unreadOnly = signal(false);
  readonly mentionsOnly = signal(false);
  readonly mobilePanelOpen = signal(false);
  readonly searchStatus = signal<MessageSearchStatus>('idle');
  readonly searchResults = signal<readonly MessageSearchResult[]>([]);
  readonly hasActiveConditions = computed(
    () => Boolean(this.appliedQuery()) || this.unreadOnly() || this.mentionsOnly()
  );
  readonly filteredConversations = computed(() =>
    this.conversationState().filter(
      (conversation) =>
        (!this.unreadOnly() || (conversation.unreadCount ?? 0) > 0) &&
        (!this.mentionsOnly() || conversation.hasMention === true)
    )
  );

  ngOnDestroy(): void {
    this.cancelRequest();
  }

  toggleMobilePanel(): void {
    const open = !this.mobilePanelOpen();
    this.mobilePanelOpen.set(open);
    if (open) {
      setTimeout(() => this.searchInput?.nativeElement.focus());
    }
  }

  closeMobilePanel(event: KeyboardEvent): void {
    if (!this.mobilePanelOpen()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.mobilePanelOpen.set(false);
    setTimeout(() => this.mobileToggle?.nativeElement.focus());
  }

  updateQuery(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.query.set(value);
    if (value.trim() !== this.appliedQuery()) {
      this.cancelRequest();
      this.appliedQuery.set('');
      this.searchResults.set([]);
      this.searchStatus.set('idle');
    }
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    const query = this.query().trim();
    if (query.length < 2) {
      this.cancelRequest();
      this.appliedQuery.set('');
      this.searchResults.set([]);
      this.searchStatus.set('invalid');
      return;
    }

    this.startSearch(query);
  }

  retrySearch(): void {
    const query = this.appliedQuery();
    if (query) {
      this.startSearch(query);
    }
  }

  toggleUnread(focusToggle = false): void {
    this.unreadOnly.update((value) => !value);
    if (focusToggle) {
      this.scheduleFocus(this.unreadFilter);
    }
  }

  toggleMentions(focusToggle = false): void {
    this.mentionsOnly.update((value) => !value);
    if (focusToggle) {
      this.scheduleFocus(this.mentionsFilter);
    }
  }

  clearSearch(focusInput = false): void {
    this.cancelRequest();
    this.query.set('');
    this.appliedQuery.set('');
    this.searchResults.set([]);
    this.searchStatus.set('idle');
    if (focusInput) {
      this.scheduleFocus(this.searchInput);
    }
  }

  changeSearch(): void {
    if (this.isMobileViewport()) {
      this.mobilePanelOpen.set(true);
    }
    this.clearSearch(true);
  }

  clearConversationFilters(focusToggle = false): void {
    this.unreadOnly.set(false);
    this.mentionsOnly.set(false);
    if (focusToggle) {
      this.scheduleFocus(this.unreadFilter);
    }
  }

  clearAll(): void {
    this.clearSearch();
    this.clearConversationFilters();
    this.scheduleFocus(this.searchInput);
  }

  private startSearch(query: string): void {
    const generation = ++this.requestGeneration;
    this.request?.unsubscribe();
    this.request = null;
    this.query.set(query);
    this.appliedQuery.set(query);
    this.searchResults.set([]);
    this.searchStatus.set('loading');

    const request = this.api.searchMessages(query).subscribe({
      next: (response) => {
        if (!this.isCurrent(generation, query)) {
          return;
        }

        const results = this.parseResponse(response);
        this.searchResults.set(results);
        this.searchStatus.set(results.length > 0 ? 'ready' : 'empty');
      },
      error: () => {
        if (this.isCurrent(generation, query)) {
          this.searchResults.set([]);
          this.searchStatus.set('error');
        }
      }
    });
    this.request = request;
    request.add(() => {
      if (this.request === request) {
        this.request = null;
      }
    });
  }

  private parseResponse(response: MessageSearchResponseDto): MessageSearchResult[] {
    if (!Array.isArray(response?.items)) {
      return [];
    }

    const conversationsById = new Map(
      this.conversationState().map((conversation) => [conversation.id.toLowerCase(), conversation])
    );
    const results: MessageSearchResult[] = [];
    const seenMessageIds = new Set<string>();

    for (const raw of response.items) {
      if (!isRecord(raw) || (raw['type'] !== 5 && raw['type'] !== 'Message')) {
        continue;
      }

      const messageId = stringValue(raw['id']);
      const title = stringValue(raw['title'])?.trim();
      const route = stringValue(raw['route']);
      const routeMatch = route?.match(CONVERSATION_ROUTE_PATTERN);
      const conversationId = routeMatch?.[1];
      if (
        !messageId ||
        !UUID_PATTERN.test(messageId) ||
        !title ||
        !conversationId ||
        !UUID_PATTERN.test(conversationId) ||
        seenMessageIds.has(messageId.toLowerCase())
      ) {
        continue;
      }

      const knownConversation = conversationsById.get(conversationId.toLowerCase());
      seenMessageIds.add(messageId.toLowerCase());
      results.push({
        messageId,
        conversationId,
        title,
        snippet: stringValue(raw['snippet'])?.trim().slice(0, 240) ?? '',
        authorDisplayName: stringValue(raw['authorDisplayName'])?.trim().slice(0, 120) ?? '',
        route: knownConversation?.route ?? `/conversations/${conversationId}`
      });
    }

    return results;
  }

  private cancelRequest(): void {
    this.requestGeneration++;
    this.request?.unsubscribe();
    this.request = null;
  }

  private isCurrent(generation: number, query: string): boolean {
    return generation === this.requestGeneration && this.appliedQuery() === query;
  }

  private scheduleFocus(target?: ElementRef<HTMLElement>): void {
    setTimeout(() => {
      const focusTarget = this.isMobileViewport() && !this.mobilePanelOpen() ? this.mobileToggle : target;
      focusTarget?.nativeElement.focus();
    });
  }

  private isMobileViewport(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 640px)').matches
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
