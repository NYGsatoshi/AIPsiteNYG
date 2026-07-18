import { TestBed } from '@angular/core/testing';

import { AIP_AUTH_SESSION_MOCK, AuthSessionSnapshot } from '../../core/auth/auth-session.facade';
import { WorkViewPreferenceService } from './work-view-preference.service';

const session = (tenantId: string, userId: string): AuthSessionSnapshot => ({
  status: 'active', isAuthenticated: true, displayName: userId, supportingUsers: [], capabilities: [],
  currentUser: { userId, displayName: userId, email: `${userId}@example.test`, systemRole: 'TenantUser', status: 'Active', capabilities: [], currentWorkspace: null, workspaces: [] },
  currentTenant: { tenantId, isAvailable: true, isPlatformScope: false, allowTenantSwitching: false },
  navigation: { capabilities: [], isLoaded: true }
});

describe('WorkViewPreferenceService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('stores My Tasks projection by tenant, user, screen, and preference version', () => {
    TestBed.configureTestingModule({ providers: [{ provide: AIP_AUTH_SESSION_MOCK, useValue: session('tenant-a', 'user-a') }] });
    const first = TestBed.inject(WorkViewPreferenceService);
    first.saveMyTasksProjection('kanban');

    expect(first.loadMyTasksProjection()).toBe('kanban');
    expect(localStorage.getItem('aipsite.work-view.v1.tenant-a.user-a.my-tasks')).toBe('kanban');
  });

  it('does not expose one user or tenant preference to another', () => {
    TestBed.configureTestingModule({ providers: [{ provide: AIP_AUTH_SESSION_MOCK, useValue: session('tenant-a', 'user-a') }] });
    TestBed.inject(WorkViewPreferenceService).saveMyTasksProjection('kanban');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AIP_AUTH_SESSION_MOCK, useValue: session('tenant-b', 'user-b') }] });

    expect(TestBed.inject(WorkViewPreferenceService).loadMyTasksProjection()).toBe('list');
  });
});
