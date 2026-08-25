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
import { WorkspaceSelectionFacade } from '../../core/workspace/workspace-selection.facade';
import { RightPanelFacade } from './right-panel.facade';

describe('WPC-02F protected notification navigation', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('Artifact ignores persisted targetRoute and switches workspace only after authorized open', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const realtime = TestBed.inject(RealtimeFacade);
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

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/artifacts/artifact-1'));
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.activeScope()).toEqual({
      workspaceId: 'workspace-b',
      projectId: '',
      conversationId: '',
    });
    expect(navigate).toHaveBeenCalledWith('/artifacts/artifact-1');
    expect(facade.viewModel().notifications[0].read).toBe(true);
    expect(realtime.clearForWorkspaceBoundary).toHaveBeenCalledOnce();
  });

  it('Message is protected even when notificationType resembles a legacy DM and uses ConversationId from the server', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const realtime = TestBed.inject(RealtimeFacade);
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

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/conversations/conversation-9?messageId=message-1'),
    );
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.activeScope()).toEqual({
      workspaceId: 'workspace-b',
      projectId: '',
      conversationId: 'conversation-9',
    });
    expect(navigate).toHaveBeenCalledWith('/conversations/conversation-9?messageId=message-1');
    expect(facade.viewModel().notifications[0].read).toBe(true);
    expect(realtime.clearForWorkspaceBoundary).toHaveBeenCalledOnce();
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

  it('clears protected-open progress when a legacy target supersedes its pending request', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    http.expectOne('/api/notifications').flush({
      items: [
        notificationDto('Artifact', 'ArtifactChanged', 'artifact-1', '/artifacts/stale'),
        {
          ...notificationDto('Announcement', 'AnnouncementPublished', 'announcement-2', '/announcements/announcement-2'),
          id: 'notification-2',
        },
      ],
    });
    facade.displayNotificationTarget('notification-1');
    const pendingOpen = http.expectOne('/api/notifications/notification-1/open');
    expect(facade.viewModel().notificationOpenInProgress).toBe(true);

    facade.displayNotificationTarget('notification-2');

    expect(pendingOpen.cancelled).toBe(true);
    expect(facade.viewModel().notificationOpenInProgress).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/announcements/announcement-2');
    http.expectOne('/api/notifications/notification-2/read').flush({});
  });

  it('Task uses the server Workspace context before opening its canonical route', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    http.expectOne('/api/notifications').flush({
      items: [notificationDto('TaskItem', 'TaskAssigned', 'task-1', '/projects/stale/tasks/stale')],
    });
    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/projects/project-b/tasks/task-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/projects/project-b/tasks/task-1'),
    );
    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.viewModel().notifications[0].read).toBe(true);
  });

  it('fails closed when a competing Workspace transition supersedes an open operation', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const selection = TestBed.inject(WorkspaceSelectionFacade);
    let finishTargetNavigation!: (value: boolean) => void;
    const targetNavigation = new Promise<boolean>((resolve) => { finishTargetNavigation = resolve; });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockReturnValue(targetNavigation);

    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Message', 'DirectMessage', 'message-1', '/dm/stale')],
    });
    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/conversations/conversation-9?messageId=message-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());

    await expect(selection.selectWorkspace('workspace-a')).resolves.toBe(true);
    finishTargetNavigation(true);
    await vi.waitFor(() => expect(facade.viewModel().unavailableMessage).toContain('no longer available'));

    expect(facade.viewModel().notifications[0].read).toBe(false);
    expect(facade.activeScope()).toEqual({ workspaceId: '', projectId: '', conversationId: '' });
    expect(navigate).toHaveBeenLastCalledWith('/workspaces');
  });

  it('does not commit an old target Workspace when a later notification click supersedes selection', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const selection = TestBed.inject(WorkspaceSelectionFacade);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    const realtime = TestBed.inject(RealtimeFacade);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/projects/project-a');
    let finishNeutralNavigation!: (value: boolean) => void;
    const neutralNavigation = new Promise<boolean>((resolve) => {
      finishNeutralNavigation = resolve;
    });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockReturnValue(neutralNavigation);
    const select = vi.spyOn(selection, 'selectWorkspace');

    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Message', 'DirectMessage', 'message-1', '/dm/stale')],
    });
    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/conversations/conversation-9?messageId=message-1',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/workspaces'));

    facade.displayNotificationTarget('missing-notification');
    finishNeutralNavigation(true);
    await select.mock.results[0].value;
    await Promise.resolve();

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-a');
    expect(selection.selection().workspaceId).toBe('workspace-a');
    expect(realtime.clearForWorkspaceBoundary).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(facade.viewModel().notifications[0].read).toBe(false);
  });

  it('repairs a stale target route when a later notification click supersedes navigation', async () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);
    let finishTargetNavigation!: (value: boolean) => void;
    const targetNavigation = new Promise<boolean>((resolve) => {
      finishTargetNavigation = resolve;
    });
    const navigate = vi.spyOn(router, 'navigateByUrl')
      .mockReturnValueOnce(targetNavigation)
      .mockResolvedValue(true);

    http.expectOne('/api/notifications').flush({
      items: [notificationDto('TaskDeadlineDigest', 'TaskDeadlineDigest', 'digest-1', '/tasks')],
    });
    facade.displayNotificationTarget('notification-1');
    http.expectOne('/api/notifications/notification-1/open').flush({
      outcome: 'Opened',
      route: '/tasks',
      stateVersion: 6,
      context: { workspaceId: 'workspace-b' },
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks'));

    facade.displayNotificationTarget('missing-notification');
    finishTargetNavigation(true);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/workspaces'));

    expect(activeWorkspace.activeWorkspace()?.id).toBe('workspace-b');
    expect(facade.activeScope()).toEqual({ workspaceId: '', projectId: '', conversationId: '' });
    expect(facade.viewModel().notifications[0].read).toBe(false);
  });

  it('Workspace boundary cancels an in-flight protected open and clears selected notification context', () => {
    configure();
    const facade = TestBed.inject(RightPanelFacade);
    const http = TestBed.inject(HttpTestingController);
    const realtime = TestBed.inject(RealtimeFacade);
    const activeWorkspace = TestBed.inject(ActiveWorkspaceFacade);

    activeWorkspace.setActiveWorkspace({ id: 'workspace-a', label: 'Workspace A' });
    http.expectOne('/api/notifications').flush({
      items: [notificationDto('Artifact', 'ArtifactChanged', 'artifact-1', '/artifacts/stale')],
    });
    facade.setActiveScope({ workspaceId: 'workspace-a', projectId: 'project-a', conversationId: '' });
    facade.displayNotificationTarget('notification-1');
    const open = http.expectOne('/api/notifications/notification-1/open');

    realtime.clearForWorkspaceBoundary();

    expect(open.cancelled).toBe(true);
    expect(activeWorkspace.activeWorkspace()).toBeNull();
    expect(facade.activeScope()).toEqual({ workspaceId: '', projectId: '', conversationId: '' });
    expect(facade.viewModel().notifications).toHaveLength(1);
    expect(facade.viewModel().selectedNotificationId).toBeNull();
    expect(facade.viewModel().notificationOpenInProgress).toBe(false);
  });
});

function configure(): void {
  const events = new Subject<DurableRealtimeEvent>();
  const protectedStateClearers = new Map<string, (reason: 'workspace') => void>();
  const workspaces = [
    { id: 'workspace-a', label: 'Workspace A' },
    { id: 'workspace-b', label: 'Workspace B' },
  ];

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
          runAuthoritativeHttpCatchUps: vi.fn().mockResolvedValue(undefined),
          registerProtectedStateClearer: (owner: string, clear: (reason: 'workspace') => void) => {
            protectedStateClearers.set(owner, clear);
            return () => protectedStateClearers.delete(owner);
          },
          clearForWorkspaceBoundary: vi.fn(() => {
            TestBed.inject(ActiveWorkspaceFacade).clearWorkspace();
            for (const clear of [...protectedStateClearers.values()]) clear('workspace');
          }),
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
  TestBed.inject(WorkspaceSelectionFacade).reconcileAuthorizedWorkspaces(
    workspaces,
    { tenantId: 'tenant-1', userId: 'user-1' },
    'workspace-a',
  );
  vi.mocked(TestBed.inject(RealtimeFacade).clearForWorkspaceBoundary).mockClear();
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
