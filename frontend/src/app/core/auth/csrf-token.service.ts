import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { finalize, map, Observable, shareReplay, throwError } from 'rxjs';

export interface CsrfToken {
  readonly token: string;
  readonly headerName: string;
  readonly cacheKey: string;
}

interface CsrfTokenResponse {
  readonly token?: string;
  readonly Token?: string;
  readonly headerName?: string;
  readonly HeaderName?: string;
}

@Injectable({ providedIn: 'root' })
export class CsrfTokenService {
  private readonly httpBackend = inject(HttpBackend, { optional: true });
  private cachedToken: CsrfToken | null = null;
  private inFlightToken$: Observable<CsrfToken> | null = null;

  ensureToken(cacheKey = 'tenant-unresolved'): Observable<CsrfToken> {
    if (this.cachedToken?.cacheKey === cacheKey) {
      return new Observable<CsrfToken>((subscriber) => {
        subscriber.next(this.cachedToken as CsrfToken);
        subscriber.complete();
      });
    }

    if (this.inFlightToken$) {
      return this.inFlightToken$;
    }

    const http = this.createBackendHttpClient();
    if (!http) {
      return throwError(() => new Error('CSRF token endpoint is unavailable in this Angular context.'));
    }

    this.inFlightToken$ = http.get<CsrfTokenResponse>('/api/security/csrf-token', { withCredentials: true }).pipe(
      map((response) => {
        const token = response.token ?? response.Token;
        const headerName = response.headerName ?? response.HeaderName ?? 'X-CSRF-Token';
        if (!token) {
          throw new Error('CSRF token response did not include a token.');
        }

        return {
          token,
          headerName,
          cacheKey
        };
      }),
      map((token) => {
        this.cachedToken = token;
        return token;
      }),
      finalize(() => {
        this.inFlightToken$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    return this.inFlightToken$;
  }

  clearToken(): void {
    this.cachedToken = null;
    this.inFlightToken$ = null;
  }

  private createBackendHttpClient(): HttpClient | null {
    return this.httpBackend ? new HttpClient(this.httpBackend) : null;
  }
}
