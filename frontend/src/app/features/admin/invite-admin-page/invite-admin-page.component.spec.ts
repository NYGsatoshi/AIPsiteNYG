import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AIP_AUTH_SESSION_MOCK,
  DEFAULT_AUTH_SESSION
} from '../../../core/auth/auth-session.facade';
import { authSessionInterceptor } from '../../../core/auth/auth-session.interceptor';
import { InviteAdminPageComponent } from './invite-admin-page.component';

describe('InviteAdminPageComponent', () => {
  let fixture: ComponentFixture<InviteAdminPageComponent>;
  let component: InviteAdminPageComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InviteAdminPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authSessionInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AIP_AUTH_SESSION_MOCK,
          useValue: DEFAULT_AUTH_SESSION
        }
      ]
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteAdminPageComponent);
    component = fixture.componentInstance;
    flushInitialLoad();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts backend enum role values with CSRF header and auth cookies enabled', () => {
    component.email.set('new-user@example.invalid');

    component.createInvite();

    httpMock.expectOne('/api/security/csrf-token').flush({
      token: 'csrf-invite',
      headerName: 'X-CSRF-Token'
    });

    const inviteRequest = httpMock.expectOne('/api/admin/invites');
    expect(inviteRequest.request.withCredentials).toBe(true);
    expect(inviteRequest.request.headers.get('X-CSRF-Token')).toBe('csrf-invite');
    expect(inviteRequest.request.body).toEqual({
      workspaceId: 'workspace-a',
      email: 'new-user@example.invalid',
      role: 3,
      expiresAt: null
    });

    inviteRequest.flush({
      id: 'invite-a',
      workspaceId: 'workspace-a',
      email: 'new-user@example.invalid',
      role: 3,
      expiresAt: '2026-07-13T00:00:00Z'
    });

    httpMock.expectOne('/api/admin/invites').flush({
      items: [
        {
          id: 'invite-a',
          workspaceId: 'workspace-a',
          email: 'new-user@example.invalid',
          role: 3,
          expiresAt: '2026-07-13T00:00:00Z'
        }
      ]
    });

    expect(component.invites()[0]?.role).toBe('Member');
  });

  it('shows ProblemDetails validation errors instead of a generic invite failure', () => {
    component.email.set('new-user@example.invalid');

    component.createInvite();

    httpMock.expectOne('/api/security/csrf-token').flush({
      token: 'csrf-invite',
      headerName: 'X-CSRF-Token'
    });

    httpMock.expectOne('/api/admin/invites').flush(
      {
        title: 'One or more validation errors occurred.',
        errors: {
          Role: ['The JSON value could not be converted to WorkspaceRole.']
        }
      },
      { status: 400, statusText: 'Bad Request' }
    );

    fixture.detectChanges();

    expect(component.message()).toBe('Role: The JSON value could not be converted to WorkspaceRole.');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Role: The JSON value could not be converted to WorkspaceRole.'
    );
  });

  function flushInitialLoad(): void {
    const workspacesRequest = httpMock.expectOne('/api/workspaces');
    expect(workspacesRequest.request.withCredentials).toBe(true);
    workspacesRequest.flush([{ id: 'workspace-a', name: 'Workspace A' }]);

    const invitesRequest = httpMock.expectOne('/api/admin/invites');
    expect(invitesRequest.request.withCredentials).toBe(true);
    invitesRequest.flush({ items: [] });

    fixture.detectChanges();
  }
});
