import { toObservable } from '@angular/core/rxjs-interop';
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { filter, map, take } from 'rxjs/operators';

import { WorkspacesFacade } from '../../features/workspaces/workspaces.facade';
import { WorkspaceSelectionFacade } from './workspace-selection.facade';

export type WorkspaceContextGuardResult = boolean | UrlTree;

/**
 * Validates a canonical Workspace route without mutating active scope.
 * WorkspacesFacade commits the route-owned scope only after NavigationEnd;
 * scoped components gate their loads until that committed scope matches.
 */
export const workspaceContextGuard: CanActivateFn = (route) => {
  const workspaces = inject(WorkspacesFacade);
  const selection = inject(WorkspaceSelectionFacade);
  const router = inject(Router);
  const workspaceId = route.paramMap.get('workspaceId');
  if (!workspaceId) {
    return router.createUrlTree(['/workspaces']);
  }

  const initial = workspaces.dashboard();
  const resolveSelection = (): WorkspaceContextGuardResult =>
    selection.isWorkspaceAuthorized(workspaceId)
      ? true
      : router.createUrlTree(['/workspaces']);
  if (initial.status !== 'loading') {
    return resolveSelection();
  }

  // Router cancellation unsubscribes this stream. Validation itself has no
  // scope-changing side effect, including when the dashboard is already ready.
  return toObservable(workspaces.dashboard).pipe(
    filter((dashboard) => dashboard.status !== 'loading'),
    take(1),
    map(() => resolveSelection()),
  );
};
