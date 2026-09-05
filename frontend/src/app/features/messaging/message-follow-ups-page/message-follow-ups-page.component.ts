import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideBookmarkCheck, LucideCheck, LucideChevronLeft } from '@lucide/angular';

import { MessageFollowUpFacade } from '../message-follow-up.facade';

@Component({
  selector: 'app-message-follow-ups-page',
  standalone: true,
  imports: [DatePipe, LucideBookmarkCheck, LucideCheck, LucideChevronLeft, RouterLink],
  template: `
    <section class="saved" aria-labelledby="saved-messages-heading" data-testid="saved-messages-page">
      <a class="saved__back" routerLink="/messages" data-testid="saved-messages-back">
        <svg lucideChevronLeft aria-hidden="true"></svg>
        Conversations
      </a>
      <header class="saved__header">
        <div>
          <p class="saved__eyebrow">Personal follow-up</p>
          <h1 id="saved-messages-heading">Saved messages</h1>
          <p>Saved work is separate from unread status and conversation Later.</p>
        </div>
        <svg class="saved__heading-icon" lucideBookmarkCheck aria-hidden="true"></svg>
      </header>

      <p class="saved__notice">
        Reminders are not scheduled in this version. No reminder time or delivery state is stored.
      </p>

      @if (facade.view().status === 'loading') {
        <p role="status" data-testid="saved-messages-loading">Loading saved messages…</p>
      } @else if (facade.view().status === 'error') {
        <section class="saved__state" data-testid="saved-messages-error">
          <h2>Saved messages unavailable</h2>
          <p>{{ facade.view().error }}</p>
          <button type="button" (click)="facade.load()">Try again</button>
        </section>
      } @else if (facade.view().status === 'empty') {
        <section class="saved__state" data-testid="saved-messages-empty">
          <h2>No saved messages</h2>
          <p>Use a message's More menu to save it for follow-up.</p>
        </section>
      } @else {
        <ul class="saved__list" aria-label="Saved messages">
          @for (item of facade.view().items; track item.messageId) {
            <li class="saved__item" data-testid="saved-message-item">
              <div class="saved__meta">
                <strong>{{ item.conversationTitle }}</strong>
                <span>{{ item.authorDisplayName }} · {{ item.messageCreatedAt | date: 'medium' }}</span>
              </div>
              <p>{{ item.body }}</p>
              <div class="saved__actions">
                <a
                  [routerLink]="item.route"
                  [queryParams]="{ focusMessageId: item.messageId, threadRootMessageId: item.threadRootMessageId }"
                  [attr.aria-label]="'Open saved message in ' + item.conversationTitle"
                  data-testid="open-saved-message"
                >Open message</a>
                <button
                  type="button"
                  [disabled]="!!facade.view().pendingMessageId"
                  [attr.aria-label]="'Complete saved message from ' + item.authorDisplayName"
                  data-testid="complete-saved-message"
                  (click)="facade.remove(item.messageId)"
                >
                  <svg lucideCheck aria-hidden="true"></svg>
                  {{ facade.view().pendingMessageId === item.messageId ? 'Completing…' : 'Complete' }}
                </button>
              </div>
            </li>
          }
        </ul>
        <nav class="saved__paging" aria-label="Saved message pages">
          <button type="button" [disabled]="facade.view().page <= 1" (click)="facade.load(facade.view().page - 1)">Previous</button>
          <span>Page {{ facade.view().page }}</span>
          <button type="button" [disabled]="!facade.hasNextPage()" (click)="facade.load(facade.view().page + 1)">Next</button>
        </nav>
      }
    </section>
  `,
  styleUrl: './message-follow-ups-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class MessageFollowUpsPageComponent {
  readonly facade = inject(MessageFollowUpFacade);

  constructor() {
    this.facade.load();
  }
}
