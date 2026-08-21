import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { RightPanelFacade } from './right-panel.facade';

describe('WPC-02F protected notification navigation', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('Artifact ignores persisted targetRoute and switches workspace only after authorized open', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Artifact', 'ArtifactChanged', 'artifact-1', '/projects/stale')],
    });

    const notification = facade.viewModel().notifications[0];
    expect(notification.target.type).toBe('artifact');
    expect(notification.target.route).toBeUndefined();

    facade.displayNotificationTarget('notification-1');
    const open = http.expectOne('/api/notifications/notification-1/open');
    expect(open.request.method).toBe('POST');
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    expect(navigate).not.toHaveBeenCalled();

    open.flush({
      outcome: 'Opened',
      route: '/artifacts/artifact-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.activeScope()).toEqual({
      workspaceId: 'workspace-b',
      projectId: '',
      conversationId: '',
    });
    expect(navigate).toHaveBeenCalledWith('/artifacts/artifact-1');
    expect(facade.viewModel().notifications[0].read).toBe(true);
  });

  it('Message is protected even when notificationType resembles a legacy DM and uses ConversationId from the server', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Message', 'DirectMessage', 'message-1', '/dm/stale-conversation')],
    });

    const notification = facade.viewModel().notifications[0];
    expect(notification.target.type).toBe('message');
    expect(notification.target.route).toBeUndefined();

    facade.displayNotificationTarget('notification-1');
    const open = http.expectOne('/api/notifications/notification-1/open');
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    open.flush({
      outcome: 'Opened',
      route: '/conversations/conversation-9?messageId=message-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.activeScope()).toEqual({
      workspaceId: 'workspace-b',
      projectId: '',
      conversationId: 'conversation-9',
    });
    expect(navigate).toHaveBeenCalledWith('/conversations/conversation-9?messageId=message-1');
    expect(facade.viewModel().notifications[0].read).toBe(true);
  });

  it('rejects a mismatched Message open route without switching workspace or marking read locally', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Message', 'DirectMessage', 'message-1', '/dm/stale')],
    });

    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/conversations/conversation-9?messageId=message-other',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    expect(navigate).not.toHaveBeenCalled();
    expect(facade.viewModel().notifications[0].read).toBe(false);
    expect(facade.viewModel().unavailableMessage).toContain('no longer available');
  });

  it('Unavailable protected target never switches workspace, navigates, or marks read locally', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Artifact', 'ArtifactChanged', 'artifact-1', '/artifacts/stale')],
    });

    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Unavailable',
      route: null,
      stateVersion: 5,
      context: null,
    });

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    expect(navigate).not.toHaveBeenCalled();
    expect(facade.viewModel().notifications[0].read).toBe(false);
  });

  it('rejects an authorized route when the returned Workspace is outside the current user scope', () => {
    configure([{ id: 'workspace-a', label: 'Workspace A' }]);
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Artifact', 'ArtifactChanged', 'artifact-1', '/artifacts/stale')],
    });

    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/artifacts/artifact-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    expect(navigate).not.toHaveBeenCalled();
    expect(facade.viewModel().notifications[0].read).toBe(false);
    expect(facade.viewModel().unavailableMessage).toContain('no longer available');
  });
});

function configure(
  workspaces = [
    { id: 'workspace-a', label: 'Workspace A' },
    { id: 'workspace-b', label: 'Workspace B' },
  ],
): void {
  const events = new Subject<DurableRealtimeEvent>();

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: RealtimeFacade,
        useValue: {
          durableEvents$: events.asObservable(),
          connectionState: () => 'Connected',
          registerCatchUp: () => () => undefined,
          registerProtectedStateClearer: () => () => undefined,
        },
      },
      {
        provide: AuthSessionFacade,
        useValue: {
          currentUser: () => ({ workspaces }),
        },
      },
    ],
  });
}

function notificationDto(
  relatedEntityType: string,
  notificationType: string,
  relatedEntityId: string,
  targetRoute: string,
): Record<string, unknown> {
  return {
    id: 'notification-1',
    notificationType,
    title: 'Protected notification',
    body: 'safe API list body',
    relatedEntityType,
    relatedEntityId,
    targetRoute,
    isRead: false,
    stateVersion: 5,
  };
}
