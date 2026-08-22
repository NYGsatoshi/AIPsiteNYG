import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

const LIST_SCROLL_STORAGE_KEY = 'aip.messaging.list-scroll-y.v1';

@Injectable({ providedIn: 'root' })
export class MessageNavigationStateService {
  private readonly document = inject(DOCUMENT);

  rememberListScroll(): void {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    window.sessionStorage.setItem(LIST_SCROLL_STORAGE_KEY, String(Math.max(0, window.scrollY)));
  }

  restoreListScroll(): void {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    const stored = window.sessionStorage.getItem(LIST_SCROLL_STORAGE_KEY);
    if (stored === null) {
      return;
    }

    const target = Number(stored);
    if (!Number.isFinite(target) || target < 0) {
      window.sessionStorage.removeItem(LIST_SCROLL_STORAGE_KEY);
      return;
    }

    let attemptsRemaining = 8;
    const restore = () => {
      window.scrollTo({ top: target, left: 0, behavior: 'auto' });
      attemptsRemaining -= 1;

      if (attemptsRemaining > 0 && Math.abs(window.scrollY - target) > 1) {
        window.requestAnimationFrame(restore);
      }
    };

    window.requestAnimationFrame(restore);
  }
}
