import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

const LIST_SCROLL_STORAGE_KEY = 'aip.messaging.list-scroll-y.v1';
const LIST_SCROLL_PENDING_KEY = 'aip.messaging.list-scroll-restore-pending.v1';
const LIST_SCROLL_HOST_KEY = 'aip.messaging.list-scroll-host.v1';
const LIST_FOCUS_CONVERSATION_KEY = 'aip.messaging.list-focus-conversation.v1';
const APP_SCROLL_HOST_ID = 'app-shell-main-content';
const DETAIL_BACK_LINK_ID = 'messages-mobile-back-link';
const MOBILE_HIERARCHY_QUERY = '(max-width: 860px)';

type MessageScrollHostId = 'app' | 'document';

interface MessageScrollHost {
  readonly id: MessageScrollHostId;
  readonly element: HTMLElement;
}

@Injectable({ providedIn: 'root' })
export class MessageNavigationStateService {
  private readonly document = inject(DOCUMENT);

  rememberListScroll(conversationId?: string): void {
    const window = this.document.defaultView;
    const host = this.effectiveScrollHost();
    if (!window || !host) {
      return;
    }

    window.sessionStorage.setItem(
      LIST_SCROLL_STORAGE_KEY,
      String(Math.max(0, host.element.scrollTop)),
    );
    window.sessionStorage.setItem(LIST_SCROLL_HOST_KEY, host.id);
    window.sessionStorage.setItem(LIST_SCROLL_PENDING_KEY, '1');
    if (conversationId) {
      window.sessionStorage.setItem(LIST_FOCUS_CONVERSATION_KEY, conversationId);
    } else {
      window.sessionStorage.removeItem(LIST_FOCUS_CONVERSATION_KEY);
    }
  }

  restoreListScroll(): void {
    const window = this.document.defaultView;
    if (!window || window.sessionStorage.getItem(LIST_SCROLL_PENDING_KEY) !== '1') {
      return;
    }

    const stored = window.sessionStorage.getItem(LIST_SCROLL_STORAGE_KEY);
    const storedHostId = this.scrollHostId(window.sessionStorage.getItem(LIST_SCROLL_HOST_KEY));
    const focusConversationId = window.sessionStorage.getItem(LIST_FOCUS_CONVERSATION_KEY);
    const target = stored === null ? Number.NaN : Number(stored);
    if (!Number.isFinite(target) || target < 0) {
      this.clearPendingListScroll();
      return;
    }

    let attemptsRemaining = 8;
    const restore = () => {
      const host = this.restoreScrollHost(storedHostId);
      if (!host) {
        this.clearPendingListScroll();
        return;
      }

      host.element.scrollTo({ top: target, left: 0, behavior: 'auto' });
      attemptsRemaining -= 1;

      if (Math.abs(host.element.scrollTop - target) <= 1 || attemptsRemaining <= 0) {
        this.restoreListFocus(focusConversationId);
        this.clearPendingListScroll();
        return;
      }

      window.requestAnimationFrame(restore);
    };

    window.requestAnimationFrame(restore);
  }

  resetDetailScroll(): void {
    const window = this.document.defaultView;
    if (!window || !this.isMobileHierarchy(window)) {
      return;
    }

    window.requestAnimationFrame(() => {
      for (const host of this.scrollHosts()) {
        host.element.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }

      const backLink = this.document.getElementById(DETAIL_BACK_LINK_ID);
      backLink?.focus({ preventScroll: true });
    });
  }

  private effectiveScrollHost(): MessageScrollHost | null {
    const hosts = this.scrollHosts();
    return (
      hosts.find((host) => host.element.scrollTop > 0 && this.isScrollable(host.element)) ??
      hosts.find((host) => this.isScrollable(host.element)) ??
      hosts[0] ??
      null
    );
  }

  private restoreScrollHost(storedHostId: MessageScrollHostId | null): MessageScrollHost | null {
    const hosts = this.scrollHosts();
    const storedHost = hosts.find((host) => host.id === storedHostId);
    if (storedHost) {
      return storedHost;
    }

    return this.effectiveScrollHost();
  }

  private scrollHosts(): MessageScrollHost[] {
    const hosts: MessageScrollHost[] = [];
    const appHost = this.document.getElementById(APP_SCROLL_HOST_ID);
    const documentHost = this.document.scrollingElement;

    if (appHost instanceof HTMLElement) {
      hosts.push({ id: 'app', element: appHost });
    }

    if (documentHost instanceof HTMLElement && documentHost !== appHost) {
      hosts.push({ id: 'document', element: documentHost });
    }

    return hosts;
  }

  private isScrollable(host: HTMLElement): boolean {
    return host.scrollHeight > host.clientHeight + 1;
  }

  private scrollHostId(value: string | null): MessageScrollHostId | null {
    return value === 'app' || value === 'document' ? value : null;
  }

  private isMobileHierarchy(window: Window): boolean {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(MOBILE_HIERARCHY_QUERY).matches;
    }

    return window.innerWidth <= 860;
  }

  private restoreListFocus(conversationId: string | null): void {
    if (!conversationId) {
      return;
    }

    const target = Array.from(
      this.document.querySelectorAll<HTMLElement>('[data-conversation-id]'),
    ).find((element) => element.dataset['conversationId'] === conversationId);
    target?.focus({ preventScroll: true });
  }

  private clearPendingListScroll(): void {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    window.sessionStorage.removeItem(LIST_SCROLL_STORAGE_KEY);
    window.sessionStorage.removeItem(LIST_SCROLL_HOST_KEY);
    window.sessionStorage.removeItem(LIST_SCROLL_PENDING_KEY);
    window.sessionStorage.removeItem(LIST_FOCUS_CONVERSATION_KEY);
  }
}
