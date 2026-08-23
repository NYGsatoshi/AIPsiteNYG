import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthSessionFacade, DEFAULT_AUTH_SESSION } from '../../core/auth/auth-session.facade';
import { ActiveWorkspaceFacade } from '../../core/workspace/active-workspace.facade';
import { WorkspaceSelectionFacade } from '../../core/workspace/workspace-selection.facade';
import { WorkspacesFacade } from '../../features/workspaces/workspaces.facade';
import { WorkspaceDashboardViewModel } from '../../features/workspaces/workspaces.types';
import { RightPanelFacade } from '../../shared/right-panel/right-panel.facade';
import { AppShellFacade } from './app-shell.facade';

const dashboard: WorkspaceDashboardViewModel = {
  status: 'ready',
  title: 'Workspaces',
  subtitle: 'Authorized Workspaces',
  pageCapabilities: [],
  workspaces: [
    {
      id: 'workspace-a',
      displayName: 'Workspace A',
      currentUserRole: 'Member',
      accessSource: 'WorkspaceMembership',
      roleLabel: 'メンバー',
      unreadAnnouncementCount: 0,
      unreadConversationCount: 0,
      activeProjectCount: 3,
      runningProjectCount: 2,
      needsReviewProjectCount: 1,
      lastUpdatedLabel: null,
      availability: {
        unreadAnnouncements: true,
        unreadConversations: true,
        activeProjects: true,
        runningProjects: true,
        needsReviewProjects: true,
        lastUpdated: false,
      },
      capabilities: ['openWorkspace', 'openMembers'],
    },
  ],
};

describe('AppShellFacade Workspace context', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('projects authorized options, split state counts, and member capability for the header', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionFacade, useValue: { session: signal(DEFAULT_AUTH_SESSION) } },
        {
          provide: ActiveWorkspaceFacade,
          useValue: { activeWorkspace: signal({ id: 'workspace-a', label: 'Workspace A' }) },
        },
        { provide: WorkspacesFacade, useValue: { dashboard: signal(dashboard) } },
        {
          provide: WorkspaceSelectionFacade,
          useValue: {
            selection: signal({
              status: 'selected',
              workspaceId: 'workspace-a',
              source: 'preference',
            }),
            selectWorkspace: vi.fn(),
          },
        },
        {
          provide: RightPanelFacade,
          useValue: {
            mode: signal('collapsed'),
            setMode: vi.fn(),
            togglePanel: vi.fn(),
          },
        },
      ],
    });

    const facade = TestBed.inject(AppShellFacade);

    expect(facade.viewModel()).toMatchObject({
      workspaceOptions: [{ id: 'workspace-a', label: 'Workspace A' }],
      workspaceSelectionStatus: 'selected',
      runningProjectCount: 2,
      needsReviewProjectCount: 1,
      canOpenWorkspaceMembers: true,
    });
  });

  it('delegates explicit selection and preserves a boolean navigation outcome', async () => {
    const selectWorkspace = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionFacade, useValue: { session: signal(DEFAULT_AUTH_SESSION) } },
        { provide: ActiveWorkspaceFacade, useValue: { activeWorkspace: signal(null) } },
        { provide: WorkspacesFacade, useValue: { dashboard: signal({ ...dashboard, workspaces: [] }) } },
        {
          provide: WorkspaceSelectionFacade,
          useValue: {
            selection: signal({ status: 'selectionRequired', workspaceId: null, source: null }),
            selectWorkspace,
          },
        },
        {
          provide: RightPanelFacade,
          useValue: {
            mode: signal('collapsed'),
            setMode: vi.fn(),
            togglePanel: vi.fn(),
          },
        },
      ],
    });

    const facade = TestBed.inject(AppShellFacade);

    await expect(facade.selectWorkspace('workspace-b')).resolves.toBe(true);
    expect(selectWorkspace).toHaveBeenCalledWith('workspace-b');
    expect(facade.viewModel()).toMatchObject({
      workspaceSelectionStatus: 'selectionRequired',
      runningProjectCount: null,
      needsReviewProjectCount: null,
      canOpenWorkspaceMembers: false,
    });
  });
});
