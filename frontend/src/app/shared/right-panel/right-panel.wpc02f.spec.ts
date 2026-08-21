import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import {
  ActiveWorkspaceFacade,
  WorkspaceSummary,
} from '../../core/workspace/active-workspace.facade';
import { RightPanelFacade } from './right-panel.facade';

const SOURCE_WORKSPACE: WorkspaceSummary = {
  id: 'workspace-source',
  label: 'Source workspace',
};

const TARGET_WORKSPACE: WorkspaceSummary = {
  id: 'workspace-target',
  label: 'Target workspace',
};

describe('RightPanelFacade WPC-02F protected notification targets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('ArtifactNotificationRequiresAuthorizedOpenAndSwitchesToReturnedWorkspace', () => {
    const context = configureRightPanel(
      protectedNotificationDto(
        'Artifact',
        'artifact-1',
        '/artifacts/stale-artifact',
      ),
    );

    expect(context.facade.viewModel().notifications[0].target.route).toBeUndefined();

    context.facade.displayNotificationTarget('notification-1');

    context.httpMock.expectNone('/api/notifications/notification-1/read');
    const open = context.httpMock.expectOne('/api/notifications/notification-1/open');
    expect(open.request.method).toBe('POST');
    expect(open.request.withCredentials).toBe(true);
    open.flush({
      outcome: 'Opened',
      route: '/artifacts/artifact-1',
      stateVersion: 6,
      context: { workspaceId: TARGET_WORKSPACE.id },
    });

    expect(context.navigate).toHaveBeenCalledWith('/artifacts/artifact-1');
    expect(context.setActiveWorkspace).toHaveBeenCalledWith(TARGET_WORKSPACE);
    expect(context.facade.viewModel().notifications[0].read).toBe(true);
    expect(context.facade.viewModel().scope).toEqual({
      workspaceId: TARGET_WORKSPACE.id,
      projectId: '',
      conversationId: '',
    });
    context.httpMock.verify();
  });

  it('MessageNotificationUsesCanonicalConversationRouteAndAuthoritativeWorkspaceContext', () => {
    const context = configureRightPanel(
      protectedNotificationDto(
        'Message',
        'message-1',
        '/messages/stale-message',
      ),
    );

    expect(context.facade.viewModel().notifications[0].target.route).toBeUndefined();

    context.facade.displayNotificationTarget('notification-1');

    context.httpMock.expectNone('/api/notifications/notification-1/read');
    const open = context.httpMock.expectOne('/api/notifications/notification-1/open');
    open.flush({
      outcome: 'Opened',
      route: '/conversations/conversation-1?messageId=message-1',
      stateVersion: 6,
      context: { workspaceId: TARGET_WORKSPACE.id },
    });

    expect(context.navigate).toHaveBeenCalledWith(
      '/conversations/conversation-1?messageId=message-1',
    );
    expect(context.setActiveWorkspace).toHaveBeenCalledWith(TARGET_WORKSPACE);
    expect(context.facade.viewModel().notifications[0].read).toBe(true);
    expect(context.facade.viewModel().scope).toEqual({
      workspaceId: TARGET_WORKSPACE.id,
      projectId: '',
      conversationId: 'conversation-1',
    });
    context.httpMock.verify();
  });

  it('MismatchedMessageRouteDoesNotNavigateSwitchWorkspaceOrMarkRead', () => {
    const context = configureRightPanel(
      protectedNotificationDto(
        'Message',
        'message-1',
        '/messages/stale-message',
      ),
    );

    context.facade.displayNotificationTarget('notification-1');

    context.httpMock.expectNone('/api/notifications/notification-1/read');
    context.httpMock
      .expectOne('/api/notifications/notification-1/open')
      .flush({
        outcome: 'Opened',
        route: '/conversations/conversation-1?messageId=another-message',
        stateVersion: 6,
        context: { workspaceId: TARGET_WORKSPACE.id },
      });

    expect(context.navigate).not.toHaveBeenCalled();
    expect(context.setActiveWorkspace).not.toHaveBeenCalled();
    expect(context.facade.viewModel().notifications[0].read).toBe(false);
    expect(context.facade.viewModel().unavailableMessage).toContain(
      'no longer available',
    );
    context.httpMock.verify();
  });

  it('AuthorizedRouteForUnknownWorkspaceDoesNotNavigateOrMarkRead', () => {
    const context = configureRightPanel(
      protectedNotificationDto(
        'Artifact',
        'artifact-1',
        '/artifacts/stale-artifact',
      ),
      false,
    );

    context.facade.displayNotificationTarget('notification-1');

    context.httpMock.expectNone('/api/notifications/notification-1/read');
    context.httpMock
      .expectOne('/api/notifications/notification-1/open')
      .flush({
        outcome: 'Opened',
        route: '/artifacts/artifact-1',
        stateVersion: 6,
        context: { workspaceId: TARGET_WORKSPACE.id },
      });

    expect(context.navigate).not.toHaveBeenCalled();
    expect(context.setActiveWorkspace).not.toHaveBeenCalled();
    expect(context.facade.viewModel().notifications[0].read).toBe(false);
    expect(context.facade.viewModel().scope.workspaceId).toBe('');
    expect(context.facade.viewModel().unavailableMessage).toContain(
      'no longer available',
    );
    context.httpMock.verify();
  });
});

function configureRightPanel(
  notification: Record<string, unknown>,
  includeTargetWorkspace = true,
) {
  const availableWorkspaces = includeTargetWorkspace
    ? [SOURCE_WORKSPACE, TARGET_WORKSPACE]
    : [SOURCE_WORKSPACE];
  let activeWorkspace: WorkspaceSummary | null = SOURCE_WORKSPACE;
  const setActiveWorkspace = vi.fn((workspace: WorkspaceSummary | null) => {
    activeWorkspace = workspace;
  });

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: RealtimeFacade,
        useValue: {
          durableEvents$: NEVER,
          connectionState: () => 'Connected',
          registerCatchUp: () => undefined,
          registerProtectedStateClearer: () => () => undefined,
        },
      },
      {
        provide: AuthSessionFacade,
        useValue: {
          currentUser: () => ({
            workspaces: availableWorkspaces,
          }),
        },
      },
      {
        provide: ActiveWorkspaceFacade,
        useValue: {
          activeWorkspace: () => activeWorkspace,
          setActiveWorkspace,
        },
      },
    ],
  });

  const facade = TestBed.inject(RightPanelFacade);
  const httpMock = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  httpMock.expectOne('/api/notifications').flush({ items: [notification] });

  return {
    facade,
    httpMock,
    navigate,
    setActiveWorkspace,
  };
}

function protectedNotificationDto(
  relatedEntityType: 'Artifact' | 'Message',
  relatedEntityId: string,
  persistedRoute: string,
): Record<string, unknown> {
  return {
    id: 'notification-1',
    title: `${relatedEntityType} notification`,
    body: 'safe notification body',
    relatedEntityType,
    relatedEntityId,
    targetRoute: persistedRoute,
    isRead: false,
    stateVersion: 5,
  };
}
