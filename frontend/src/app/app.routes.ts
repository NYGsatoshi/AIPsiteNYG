import { Routes } from '@angular/router';

import { PagePlaceholderComponent } from './core/routing/page-placeholder.component';
import { SessionExpiredPageComponent } from './core/session/session-expired-page.component';
import { AppShellComponent } from './layout/app-shell/app-shell.component';
import { AppPermissionDeniedComponent } from './shared/permission/app-permission-denied/app-permission-denied.component';

export const routes: Routes = [
  {
    path: 'login',
    component: PagePlaceholderComponent,
    data: {
      title: 'ログイン',
      summary: '準備中',
      tone: 'public'
    }
  },
  {
    path: 'session-expired',
    component: SessionExpiredPageComponent
  },
  {
    path: 'register/invite',
    loadComponent: () =>
      import('./features/auth/invite-registration-page/invite-registration-page.component').then(
        (m) => m.InviteRegistrationPageComponent
      )
  },
  {
    path: 'permission-denied',
    component: AppPermissionDeniedComponent
  },
  {
    path: 'app',
    component: AppShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'workspaces'
      },
      {
        path: 'workspaces/:workspaceId/channels/:conversationId',
        loadComponent: () =>
          import('./features/messaging/channel-messaging-page/channel-messaging-page.component').then(
            (m) => m.ChannelMessagingPageComponent
          )
      },
      {
        path: 'dm/:conversationId',
        loadComponent: () =>
          import('./features/messaging/dm-page/dm-page.component').then((m) => m.DmPageComponent)
      },
      {
        path: 'workspaces/:workspaceId/members',
        loadComponent: () =>
          import('./features/workspaces/workspace-members-page/workspace-members-page.component').then(
            (m) => m.WorkspaceMembersPageComponent
          )
      },
      {
        path: 'workspaces',
        loadComponent: () =>
          import('./features/workspaces/workspace-dashboard-page/workspace-dashboard-page.component').then(
            (m) => m.WorkspaceDashboardPageComponent
          )
      },
      {
        path: 'announcements',
        loadComponent: () =>
          import('./features/announcements/announcements-page/announcements-page.component').then(
            (m) => m.AnnouncementsPageComponent
          )
      },
      {
        path: 'announcements/:announcementId',
        loadComponent: () =>
          import('./features/announcements/announcements-page/announcements-page.component').then(
            (m) => m.AnnouncementsPageComponent
          )
      },
      {
        path: 'projects/:projectId/tasks/:taskId',
        loadComponent: () =>
          import('./features/projects/task-detail-page/task-detail-page.component').then(
            (m) => m.TaskDetailPageComponent
          )
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./features/projects/my-tasks-page/my-tasks-page.component').then((m) => m.MyTasksPageComponent)
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./features/projects/projects-overview-page/projects-overview-page.component').then(
            (m) => m.ProjectsOverviewPageComponent
          )
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./features/files/files-page/files-page.component').then((m) => m.FilesPageComponent)
      },
      {
        path: 'account',
        component: PagePlaceholderComponent,
        data: {
          title: 'アカウント',
          summary: '準備中'
        }
      },
      {
        path: 'admin/audit',
        loadComponent: () =>
          import('./features/admin/audit-log-page/audit-log-page.component').then((m) => m.AuditLogPageComponent)
      },
      {
        path: 'admin/export-diagnostics',
        loadComponent: () =>
          import('./features/admin/export-diagnostics-page/export-diagnostics-page.component').then(
            (m) => m.ExportDiagnosticsPageComponent
          )
      }
    ]
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'app/workspaces'
  },
  {
    path: '**',
    component: PagePlaceholderComponent,
    data: {
      title: '未実装',
      summary: '準備中'
    }
  }
];
