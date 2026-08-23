import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { WorkspacesFacade } from './workspaces.facade';

const workspaceDto = {
  id: 'workspace-1',
  name: 'Backend Workspace',
  description: 'Authoritative dashboard card',
  icon: null,
  status: 0,
  createdAt: '2026-08-22T00:00:00Z',
  updatedAt: '2026-08-23T00:00:00Z',
  currentUserRole: 'Owner',
  accessSource: 'WorkspaceMembership',
  canOpenWorkspace: true,
  canOpenMembers: false,
  canOpenProjects: true,
  unreadAnnouncementCount: 0,
  unreadConversationCount: 5,
  inProgressProjectCount: 2,
};

describe('WorkspacesFacade live dashboard projection', () => {
  let facade: WorkspacesFacade;
  let http: HttpTestingController;
  let activeWorkspace: {
    setActiveWorkspace: ReturnType<typeof vi.fn>;
    clearWorkspace: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    activeWorkspace = {
      setActiveWorkspace: vi.fn(),
      clearWorkspace: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActiveWorkspaceFacade, useValue: activeWorkspace },
        {
          provide: AuthSessionFacade,
          useValue: { session: signal({ capabilities: [] }) },
        },
      ],
    });

    facade = TestBed.inject(WorkspacesFacade);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('maps the complete list and enveloped page capability without placeholders', () => {
    const capabilitiesRequest = http.expectOne('/api/workspaces/capabilities');
    expect(capabilitiesRequest.request.withCredentials).toBe(true);
    capabilitiesRequest.flush({
      requestId: 'request-capabilities',
      data: { canCreate: true },
      warnings: [],
    });

    const listRequest = http.expectOne('/api/workspaces');
    expect(listRequest.request.withCredentials).toBe(true);
    listRequest.flush([workspaceDto]);

    expect(facade.dashboard()).toMatchObject({
      status: 'ready',
      pageCapabilities: ['createWorkspace'],
    });
    expect(facade.dashboard().message).toBeUndefined();
    expect(facade.dashboard().workspaces[0]).toMatchObject({
      id: 'workspace-1',
      currentUserRole: 'Owner',
      accessSource: 'WorkspaceMembership',
      roleLabel: '管理者',
      unreadAnnouncementCount: 0,
      unreadConversationCount: 5,
      activeProjectCount: 2,
      capabilities: ['openWorkspace', 'openProjects'],
    });
    expect(activeWorkspace.setActiveWorkspace).toHaveBeenCalledWith({
      id: 'workspace-1',
      label: 'Backend Workspace',
    });
  });

  it('shows the no-access state while retaining backend-authorized create capability', () => {
    http.expectOne('/api/workspaces').flush([]);
    http.expectOne('/api/workspaces/capabilities').flush({
      requestId: 'request-capabilities',
      data: { canCreate: true },
      warnings: [],
    });

    expect(facade.dashboard()).toMatchObject({
      status: 'noWorkspaceAccess',
      workspaces: [],
      pageCapabilities: ['createWorkspace'],
    });
    expect(activeWorkspace.setActiveWorkspace).toHaveBeenCalledWith(null);
  });

  it.each([401, 403])('maps HTTP %s to a safe permission-denied state', (status) => {
    http
      .expectOne('/api/workspaces')
      .flush(
        { requestId: 'request-denied', error: { code: 'CapabilityDenied' } },
        { status, statusText: 'Denied' },
      );
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });

    expect(facade.dashboard()).toMatchObject({
      status: 'permissionDenied',
      workspaces: [],
      pageCapabilities: [],
    });
    expect(activeWorkspace.clearWorkspace).toHaveBeenCalled();
  });

  it('does not fabricate cards or counts when the dashboard projection fails', () => {
    http
      .expectOne('/api/workspaces')
      .flush(
        { requestId: 'request-failed', error: { code: 'DependencyUnavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: true } });

    expect(facade.dashboard()).toMatchObject({
      status: 'error',
      workspaces: [],
      pageCapabilities: [],
    });
  });

  it('fails page create capability closed without hiding an authorized card', () => {
    http.expectOne('/api/workspaces').flush([workspaceDto]);
    http
      .expectOne('/api/workspaces/capabilities')
      .flush(
        { requestId: 'request-capability-failed' },
        { status: 503, statusText: 'Service Unavailable' },
      );

    expect(facade.dashboard()).toMatchObject({
      status: 'ready',
      pageCapabilities: [],
    });
    expect(facade.dashboard().workspaces).toHaveLength(1);
  });

  it('treats a malformed successful list as an error rather than no Workspace access', () => {
    http.expectOne('/api/workspaces').flush({ items: [workspaceDto] });
    http.expectOne('/api/workspaces/capabilities').flush({ data: { canCreate: false } });

    expect(facade.dashboard()).toMatchObject({
      status: 'error',
      workspaces: [],
      pageCapabilities: [],
    });
  });
});
