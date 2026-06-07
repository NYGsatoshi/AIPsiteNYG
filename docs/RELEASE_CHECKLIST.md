# Release Checklist

## Build And Tests

- [ ] `dotnet restore AipPortal.slnx` passes.
- [ ] `dotnet build AipPortal.slnx` passes.
- [ ] `dotnet test AipPortal.slnx` passes.
- [ ] Tenant isolation tests pass.
- [ ] Smoke test confirms app starts.
- [ ] Smoke test confirms database is reachable.
- [ ] Smoke test confirms `/health/live` and `/health/ready`.

## Security

- [ ] No secrets committed.
- [ ] Production configuration reviewed.
- [ ] Default passwords removed.
- [ ] `Security:CookieSecurePolicy=Always`.
- [ ] `Security:RequireHttps=true`.
- [ ] `Security:EnableHsts=true`.
- [ ] HTTPS enabled at reverse proxy.
- [ ] Development tenant header disabled in production.
- [ ] `Platform:PlatformAdminSetupMode=false`.
- [ ] PlatformAdmin and TenantAdmin separation tested.
- [ ] Suspended tenant behavior tested.
- [ ] File download authorization tested.
- [ ] API tokens, invite tokens, and webhook secrets are never logged raw.

## Operations

- [ ] Database migrated.
- [ ] Backup taken before migration.
- [ ] Restore tested at least once in development.
- [ ] File storage backup included.
- [ ] Admin setup documented.
- [ ] First tenant creation documented.
- [ ] Audit logs working.
- [ ] Known risks listed.

## Product Smoke Tests

- [ ] Login works.
- [ ] Default tenant exists when required.
- [ ] Tenant isolation works.
- [ ] File upload works.
- [ ] File download works.
- [ ] Project creation works.
- [ ] Task creation works.
- [ ] Admin APIs are protected.
- [ ] Search is tenant-scoped.
- [ ] Notifications are tenant-scoped.

## Go/No-Go

Pilot release is allowed only when all critical security and backup items above are complete. If any item remains open, mark the release conditionally safe or unsafe in `docs/PILOT_STATUS.md`.
