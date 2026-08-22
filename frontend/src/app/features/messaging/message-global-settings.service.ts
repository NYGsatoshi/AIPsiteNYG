import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

interface StoredMessageGlobalSettings {
  readonly showUnreadBadges: boolean;
}

const STORAGE_KEY = 'aip.messaging.global-settings.v1';

/**
 * App-wide Message presentation preferences for this browser.
 *
 * This intentionally does not model delivery/mute state. Conversation mute is
 * server-authoritative through the participant-state API; keeping the two
 * scopes separate prevents a browser-only preference from masquerading as a
 * notification-delivery contract.
 */
@Injectable({ providedIn: 'root' })
export class MessageGlobalSettingsService {
  private readonly platformId = inject(PLATFORM_ID);
  readonly showUnreadBadges = signal(this.read().showUnreadBadges);

  setShowUnreadBadges(value: boolean): void {
    this.showUnreadBadges.set(value);
    this.write({ showUnreadBadges: value });
  }

  private read(): StoredMessageGlobalSettings {
    if (!isPlatformBrowser(this.platformId)) {
      return { showUnreadBadges: true };
    }

    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { showUnreadBadges: true };
      }
      const parsed = JSON.parse(raw) as Partial<StoredMessageGlobalSettings>;
      return { showUnreadBadges: parsed.showUnreadBadges !== false };
    } catch {
      return { showUnreadBadges: true };
    }
  }

  private write(value: StoredMessageGlobalSettings): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage may be unavailable in hardened/private browsing contexts.
      // The in-memory value still applies for the active app session.
    }
  }
}
