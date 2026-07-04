import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';

import { authSessionGuard } from './auth-session.guard';
import { AuthSessionFacade } from './auth-session.facade';

describe('authSessionGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('allows private routes only after validating the server session', async () => {
    const result = firstValueFrom(runGuard('/workspaces'));
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/me');

    request.flush({
      userId: 'user-a',
      displayName: 'User A',
      email: 'user-a@example.invalid',
      systemRole: 'TenantUser',
      status: 'Active'
    });

    await expect(result).resolves.toBe(true);
    expect(TestBed.inject(AuthSessionFacade).isAuthenticated()).toBe(true);
  });

  it('redirects unauthenticated users to login', async () => {
    const result = firstValueFrom(runGuard('/workspaces'));
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/me');

    request.flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    const tree = await result;
    expect(serializeUrl(tree)).toBe('/login');
    expect(TestBed.inject(AuthSessionFacade).isAuthenticated()).toBe(false);
  });

  it('sends forbidden users to permission denied', async () => {
    const result = firstValueFrom(runGuard('/admin/audit'));
    const request = TestBed.inject(HttpTestingController).expectOne('/api/auth/me');

    request.flush({ error: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(serializeUrl(await result)).toBe('/permission-denied');
  });
});

function runGuard(url: string): Observable<boolean | UrlTree> {
  return TestBed.runInInjectionContext(
    () => authSessionGuard({} as never, { url } as never) as Observable<boolean | UrlTree>
  );
}

function serializeUrl(value: boolean | UrlTree): string {
  if (value === true || value === false) {
    return String(value);
  }

  return TestBed.inject(Router).serializeUrl(value);
}
