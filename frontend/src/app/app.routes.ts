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
        path: 'workspaces',
        component: PagePlaceholderComponent,
        data: {
          title: 'ワークスペース',
          summary: '未実装'
        }
      },
      {
        path: 'projects',
        component: PagePlaceholderComponent,
        data: {
          title: '制作',
          summary: '準備中'
        }
      },
      {
        path: 'files',
        component: PagePlaceholderComponent,
        data: {
          title: 'ファイル',
          summary: '未実装'
        }
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
        component: PagePlaceholderComponent,
        data: {
          title: '監査',
          summary: '未実装'
        }
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
