import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

const APP_SCROLL_HOST_ID = 'app-shell-main-content';
const MOBILE_HIERARCHY_QUERY = '(max-width: 860px)';
const RESTORE_ATTEMPTS = 8;

type AnnouncementScrollHostId = 'app-shell-main-content' | 'document';

interface AnnouncementScrollHost {
  readonly id: AnnouncementScrollHostId;
  readonly element: HTMLElement;
}

interface PendingListState {
  readonly announcementId: string | null;
  readonly scrollTop: number;
  readonly hostId: AnnouncementScrollHostId | null;
}

/**
 * Keeps the recipient list/detail handoff local to announcements. It deliberately
 * does not share Message navigation keys or selectors.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncementNavigationStateService {
  private readonly document = inject(DOCUMENT);
  private pendingListState: PendingListState | null = null;

  hasPendingListState(): boolean {
    return this.pendingListState !== null;
  }

  rememberListState(announcementId: string): void {
    if (!announcementId || !this.isMobileHierarchy()) {
      return;
    }

    const host = this.effectiveScrollHost();
    this.pendingListState = {
      announcementId,
      scrollTop: Math.max(0, host?.element.scrollTop ?? 0),
      hostId: host?.id ?? null,
    };
  }

  rememberListHeadingFallback(): void {
    if (!this.isMobileHierarchy() || this.pendingListState) {
      return;
    }

    this.pendingListState = {
      announcementId: null,
      scrollTop: 0,
      hostId: null,
    };
  }

  resetDetailScroll(afterReset: () => void): void {
    if (!this.isMobileHierarchy()) {
      afterReset();
      return;
    }

    this.schedule(() => {
      for (const host of this.scrollHosts()) {
        this.scrollTo(host.element, 0);
      }
      afterReset();
    });
  }

  restoreListState(afterRestore: (announcementId: string | null) => void): void {
    const state = this.pendingListState;
    this.pendingListState = null;
    if (!state || !this.isMobileHierarchy()) {
      afterRestore(null);
      return;
    }

    let attemptsRemaining = RESTORE_ATTEMPTS;
    const restore = () => {
      const host = this.restoreScrollHost(state.hostId);
      if (host) {
        this.scrollTo(host.element, state.scrollTop);
      }

      attemptsRemaining -= 1;
      if (
        !host ||
        Math.abs(host.element.scrollTop - state.scrollTop) <= 1 ||
        attemptsRemaining <= 0
      ) {
        afterRestore(state.announcementId);
        return;
      }

      this.schedule(restore);
    };

    this.schedule(restore);
  }

  private effectiveScrollHost(): AnnouncementScrollHost | null {
    const hosts = this.scrollHosts();
    return hosts.find((host) => host.element.scrollTop > 0) ?? hosts[0] ?? null;
  }

  private restoreScrollHost(hostId: AnnouncementScrollHostId | null): AnnouncementScrollHost | null {
    const hosts = this.scrollHosts();
    return hosts.find((host) => host.id === hostId) ?? this.effectiveScrollHost();
  }

  private scrollHosts(): readonly AnnouncementScrollHost[] {
    const hosts: AnnouncementScrollHost[] = [];
    const appHost = this.document.getElementById(APP_SCROLL_HOST_ID);
    const documentHost = this.document.scrollingElement;

    if (appHost instanceof HTMLElement) {
      hosts.push({ id: 'app-shell-main-content', element: appHost });
    }
    if (documentHost instanceof HTMLElement && documentHost !== appHost) {
      hosts.push({ id: 'document', element: documentHost });
    }

    return hosts;
  }

  private isMobileHierarchy(): boolean {
    const window = this.document.defaultView;
    if (!window) {
      return false;
    }

    return window.matchMedia?.(MOBILE_HIERARCHY_QUERY).matches ?? window.innerWidth <= 860;
  }

  private schedule(callback: () => void): void {
    const window = this.document.defaultView;
    if (window?.requestAnimationFrame) {
      window.requestAnimationFrame(callback);
      return;
    }

    queueMicrotask(callback);
  }

  private scrollTo(element: HTMLElement, top: number): void {
    try {
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top, left: 0, behavior: 'auto' });
      } else {
        element.scrollTop = top;
      }
    } catch {
      // Embedded/document roots can expose a non-operational scrollTo implementation.
      element.scrollTop = top;
    }
  }
}
