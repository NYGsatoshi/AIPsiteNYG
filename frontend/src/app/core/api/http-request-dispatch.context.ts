import { HttpContextToken } from '@angular/common/http';

/**
 * Carries a one-shot notification immediately before an intercepted request
 * reaches the transport subscription. Cloned retry requests retain the same
 * signal, so a retry cannot report a second dispatch.
 */
export class HttpRequestDispatchSignal {
  private notified = false;

  constructor(private readonly callback: () => void) {}

  notify(): void {
    if (this.notified) {
      return;
    }

    this.notified = true;
    this.callback();
  }
}

export const HTTP_REQUEST_DISPATCH_SIGNAL = new HttpContextToken<HttpRequestDispatchSignal | null>(
  () => null,
);
