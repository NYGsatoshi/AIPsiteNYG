import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MessageGlobalSettingsService } from '../message-global-settings.service';

@Component({
  selector: 'app-message-settings-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="message-settings" data-testid="global-message-settings">
      <header class="message-settings__header">
        <div>
          <p class="message-settings__eyebrow">Messages</p>
          <h1>Global message settings</h1>
          <p id="global-message-settings-scope" class="message-settings__scope">
            Changes here apply to every conversation shown in Messages on this browser. They do not mute a
            conversation or change server notification delivery.
          </p>
        </div>
        <a routerLink="/messages">Back to conversations</a>
      </header>

      <section class="message-settings__card" aria-labelledby="global-display-settings-title">
        <div class="message-settings__scope-badge">Global</div>
        <h2 id="global-display-settings-title">Conversation list display</h2>
        <p class="message-settings__muted">
          Conversation-specific notification controls are deliberately kept out of this page. Open a conversation and
          choose “Conversation settings” to mute only that conversation.
        </p>

        <label class="message-settings__setting" for="show-unread-badges">
          <span>
            <strong>Show unread badges</strong>
            <small id="show-unread-badges-help">
              Scope: all conversation lists in Messages on this browser. Current saved value:
              {{ settings.showUnreadBadges() ? 'On' : 'Off' }}.
            </small>
          </span>
          <input
            id="show-unread-badges"
            data-testid="global-show-unread-badges"
            type="checkbox"
            [checked]="pendingShowUnreadBadges()"
            aria-describedby="global-message-settings-scope show-unread-badges-help"
            (change)="onUnreadBadgeChange($event)"
          />
        </label>

        <div class="message-settings__actions">
          <button
            type="button"
            data-testid="save-global-message-settings"
            [disabled]="!hasChanges()"
            (click)="requestSave()"
          >
            Save global settings
          </button>
        </div>

        @if (savedMessage()) {
          <p class="message-settings__status" role="status" aria-live="polite">{{ savedMessage() }}</p>
        }
      </section>

      @if (confirmOpen()) {
        <div class="message-settings__overlay">
          <section
            class="message-settings__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="global-settings-confirm-title"
            aria-describedby="global-settings-confirm-description"
            data-testid="global-settings-confirmation"
          >
            <h2 id="global-settings-confirm-title">Apply this global change?</h2>
            <p id="global-settings-confirm-description">
              Unread badge visibility will change for every conversation list in Messages on this browser. Individual
              conversation mute settings will not be changed.
            </p>
            <div class="message-settings__actions">
              <button type="button" (click)="cancelSave()">Cancel</button>
              <button type="button" data-testid="confirm-global-message-settings" (click)="confirmSave()">
                Apply global change
              </button>
            </div>
          </section>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .message-settings { max-width: 58rem; margin: 0 auto; padding: 1.5rem; color: var(--aip-color-text-primary); }
    .message-settings__header { display: flex; justify-content: space-between; gap: 1.5rem; align-items: flex-start; margin-bottom: 1.5rem; }
    .message-settings__eyebrow { margin: 0; color: var(--aip-color-text-muted); font-size: .75rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .message-settings__header h1 { margin: .25rem 0 .5rem; }
    .message-settings__header a { min-block-size: 2.5rem; display: inline-flex; align-items: center; color: var(--aip-color-action-primary); font-weight: 800; }
    .message-settings__scope, .message-settings__muted { max-width: 44rem; color: var(--aip-color-text-secondary); }
    .message-settings__card { border: 1px solid var(--aip-color-border-default); border-radius: .75rem; padding: 1.25rem; background: var(--aip-color-bg-surface); }
    .message-settings__scope-badge { display: inline-flex; border-radius: 999px; padding: .2rem .55rem; font-size: .75rem; font-weight: 700; background: var(--aip-color-bg-selected); color: var(--aip-color-text-secondary); }
    .message-settings__setting { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1rem 0; border-top: 1px solid var(--aip-color-border-default); }
    .message-settings__setting span { display: grid; gap: .25rem; }
    .message-settings__setting small { color: var(--aip-color-text-secondary); }
    .message-settings__setting input { inline-size: 1.25rem; block-size: 1.25rem; accent-color: var(--aip-color-action-primary); }
    .message-settings__actions { display: flex; justify-content: flex-end; gap: .75rem; }
    .message-settings button { min-block-size: 2.5rem; border: 1px solid var(--aip-color-border-default); border-radius: 6px; padding: 0 .85rem; background: var(--aip-color-bg-control); color: var(--aip-color-text-primary); font: inherit; font-weight: 800; cursor: pointer; }
    .message-settings button:disabled { cursor: not-allowed; opacity: .6; }
    .message-settings__status { margin-bottom: 0; }
    .message-settings__overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 1rem; background: var(--aip-color-overlay); z-index: 1000; }
    .message-settings__confirm { width: min(32rem, 100%); border: 1px solid var(--aip-color-border-default); border-radius: .75rem; padding: 1.25rem; background: var(--aip-color-bg-elevated); box-shadow: var(--aip-shadow-floating); }
    .message-settings :focus-visible { outline: 2px solid var(--aip-color-focus); outline-offset: 3px; }
    @media (max-width: 40rem) { .message-settings__header { flex-direction: column; } }
  `]
})
export class MessageSettingsPageComponent {
  readonly settings = inject(MessageGlobalSettingsService);
  readonly pendingShowUnreadBadges = signal(this.settings.showUnreadBadges());
  readonly confirmOpen = signal(false);
  readonly savedMessage = signal<string | null>(null);
  readonly hasChanges = computed(() => this.pendingShowUnreadBadges() !== this.settings.showUnreadBadges());

  onUnreadBadgeChange(event: Event): void {
    this.pendingShowUnreadBadges.set((event.target as HTMLInputElement).checked);
    this.savedMessage.set(null);
  }

  requestSave(): void {
    if (this.hasChanges()) {
      this.confirmOpen.set(true);
    }
  }

  cancelSave(): void {
    this.confirmOpen.set(false);
  }

  confirmSave(): void {
    if (!this.hasChanges()) {
      this.confirmOpen.set(false);
      return;
    }

    this.settings.setShowUnreadBadges(this.pendingShowUnreadBadges());
    this.confirmOpen.set(false);
    this.savedMessage.set('Global message display settings were updated.');
  }
}
