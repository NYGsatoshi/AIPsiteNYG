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
    const host = this.effectiveScrollHost();
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
      const host = this.effectiveScrollHost();
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
      for (const host of this.scrollHosts()) {
        host.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });
  }

  private effectiveScrollHost(): HTMLElement | null {
    const hosts = this.scrollHosts();
    return (
      hosts.find((host) => host.scrollTop > 0) ??
      hosts.find((host) => host.scrollHeight > host.clientHeight + 1) ??
      hosts[0] ??
      null
    );
  }

  private scrollHosts(): HTMLElement[] {
    const hosts: HTMLElement[] = [];
    const appHost = this.document.getElementById(APP_SCROLL_HOST_ID);
    const documentHost = this.document.scrollingElement;

    if (appHost instanceof HTMLElement) {
      hosts.push(appHost);
    }

    if (documentHost instanceof HTMLElement && documentHost !== appHost) {
      hosts.push(documentHost);
    }

    return hosts;
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
