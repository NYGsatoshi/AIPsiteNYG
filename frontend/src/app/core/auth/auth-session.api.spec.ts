import {
  mapAuthStatusResponse,
  mapCurrentTenantResponse,
  mapCurrentUserResponse
} from './auth-session.api';

describe('auth session API adapters', () => {
  it('maps verified current-user fields without relying on id aliases', () => {
    const user = mapCurrentUserResponse({
      userId: 'user-123',
      displayName: 'User Name',
      email: 'self@example.test',
      systemRole: 2,
      status: 1,
      capabilities: ['workspace:view', 'projects:view', 123, 'invite:create']
    });

    expect(user).toEqual({
      userId: 'user-123',
      displayName: 'User Name',
      email: 'self@example.test',
      systemRole: '2',
      status: '1',
      capabilities: ['workspace:view', 'projects:view', 'invite:create'],
      currentWorkspace: null,
      workspaces: []
    });
  });

  it('does not authenticate a status response without a verified user payload', () => {
    const status = mapAuthStatusResponse({
      isAuthenticated: true,
      user: null
    });

    expect(status.isAuthenticated).toBe(false);
    expect(status.user).toBeNull();
  });

  it('maps numeric tenant enum fields into frontend-safe strings', () => {
    const tenant = mapCurrentTenantResponse({
      tenantId: 'tenant-123',
      tenantSlug: 'tenant-slug',
      isAvailable: true,
      isPlatformScope: false,
      displayName: 'Tenant',
      status: 1,
      currentUserRole: 3,
      appMode: 0,
      allowTenantSwitching: true
    });

    expect(tenant.tenantId).toBe('tenant-123');
    expect(tenant.status).toBe('1');
    expect(tenant.currentUserRole).toBe('3');
    expect(tenant.appMode).toBe(0);
  });
});
