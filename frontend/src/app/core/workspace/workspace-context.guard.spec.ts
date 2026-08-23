import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';

import { WorkspacesFacade } from '../../features/workspaces/workspaces.facade';
import { WorkspaceContextGuardResult, workspaceContextGuard } from './workspace-context.guard';
import { WorkspaceSelectionFacade } from './workspace-selection.facade';

describe('workspaceContextGuard', () => {
  const dashboard = signal({ status: 'loading' } as ReturnType<WorkspacesFacade['dashboard']>);
  let isWorkspaceAuthorized: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dashboard.set({ status: 'loading' } as ReturnType<WorkspacesFacade['dashboard']>);
    isWorkspaceAuthorized = vi.fn().mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: WorkspacesFacade, useValue: { dashboard } },
        { provide: WorkspaceSelectionFacade, useValue: { isWorkspaceAuthorized } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('allows a current-authorized route without mutating active Workspace scope', async () => {
    dashboard.set({ status: 'ready' } as ReturnType<WorkspacesFacade['dashboard']>);

    await expect(resolveGuard(runGuard('workspace-a'))).resolves.toBe(true);
    expect(isWorkspaceAuthorized).toHaveBeenCalledWith('workspace-a');
  });

  it('redirects an unknown or revoked route Workspace to the neutral selector', async () => {
    dashboard.set({ status: 'ready' } as ReturnType<WorkspacesFacade['dashboard']>);
    isWorkspaceAuthorized.mockReturnValue(false);

    const result = await resolveGuard(runGuard('revoked-workspace'));

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/workspaces');
  });

  it('does not validate a delayed Workspace after the router cancels that navigation', () => {
    const result = runGuard('workspace-a');
    expect(result).toBeInstanceOf(Observable);
    const subscription = (result as Observable<WorkspaceContextGuardResult>).subscribe();

    subscription.unsubscribe();
    dashboard.set({ status: 'ready' } as ReturnType<WorkspacesFacade['dashboard']>);

    expect(isWorkspaceAuthorized).not.toHaveBeenCalled();
  });

  it('has no scope-changing side effect when a ready navigation is later cancelled', async () => {
    dashboard.set({ status: 'ready' } as ReturnType<WorkspacesFacade['dashboard']>);

    await expect(resolveGuard(runGuard('workspace-a'))).resolves.toBe(true);

    expect(isWorkspaceAuthorized).toHaveBeenCalledOnce();
  });
});

function runGuard(workspaceId: string) {
  return TestBed.runInInjectionContext(() => workspaceContextGuard(
    { paramMap: convertToParamMap({ workspaceId }) } as never,
    {} as never,
  ));
}

function resolveGuard(result: ReturnType<typeof runGuard>): Promise<WorkspaceContextGuardResult> {
  return result instanceof Observable
    ? firstValueFrom(result as Observable<WorkspaceContextGuardResult>)
    : Promise.resolve(result as WorkspaceContextGuardResult);
}
