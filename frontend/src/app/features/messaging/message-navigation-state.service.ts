import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

const LIST_SCROLL_STORAGE_KEY = 'aip.messaging.list-scroll-y.v1';
const LIST_SCROLL_PENDING_KEY = 'aip.messaging.list-scroll-restore-pending.v1';
const APP_SCROLL_HOST_ID = 'app-shell-main-content';

@Injectable({ providedIn: 'root' })
export class MessageNavigationStateService {
  private readonly document = inject(DOCUMENT);

  rememberListScroll(): void {
    const window = this.document.defaultView;
    const host = this.scrollHost();
    if (!window || !host) {
      return;
    }

    window.sessionStorage.setItem(
      LIST_SCROLL_STORAGE_KEY,
      String(Math.max(0, host.scrollTop)),
    );
    window.sessionStorage.setItem(LIST_SCROLL_PENDING_KEY, '1');
  }

  restoreListScroll(): void {
    const window = this.document.defaultView;
    if (!window || window.sessionStorage.getItem(LIST_SCROLL_PENDING_KEY) !== '1') {
      return;
    }

    const stored = window.sessionStorage.getItem(LIST_SCROLL_STORAGE_KEY);
    const target = stored === null ? Number.NaN : Number(stored);
    if (!Number.isFinite(target) || target < 0) {
      this.clearPendingListScroll();
      return;
    }

    let attemptsRemaining = 8;
    const restore = () => {
      const host = this.scrollHost();
      if (!host) {
        this.clearPendingListScroll();
        return;
      }

      host.scrollTo({ top: target, left: 0, behavior: 'auto' });
      attemptsRemaining -= 1;

      if (Math.abs(host.scrollTop - target) <= 1 || attemptsRemaining <= 0) {
        this.clearPendingListScroll();
        return;
      }

      window.requestAnimationFrame(restore);
    };

    window.requestAnimationFrame(restore);
  }

  resetDetailScroll(): void {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    window.requestAnimationFrame(() => {
      this.scrollHost()?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }

  private scrollHost(): HTMLElement | null {
    const appHost = this.document.getElementById(APP_SCROLL_HOST_ID);
    if (appHost instanceof HTMLElement) {
      return appHost;
    }

    const fallback = this.document.scrollingElement;
    return fallback instanceof HTMLElement ? fallback : null;
  }

  private clearPendingListScroll(): void {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    window.sessionStorage.removeItem(LIST_SCROLL_STORAGE_KEY);
    window.sessionStorage.removeItem(LIST_SCROLL_PENDING_KEY);
  }
}
