# Security Policy

## Supported Scope

AIP Portal is pre-production. Security fixes are tracked against the current `main` branch until formal versioning is introduced.

## Reporting A Vulnerability

Report suspected vulnerabilities privately to the repository owner or project maintainer. Do not open public issues containing credentials, raw tokens, tenant data, file contents, signed URLs, or exploit details.

Include:

- affected route, feature, or configuration
- reproduction steps
- expected and actual behavior
- tenant/isolation impact if known
- relevant logs with secrets redacted

## Security Baseline

- Passwords, invite tokens, session keys, API tokens, and webhook secrets must not be stored or logged raw.
- Tenant-owned data must be protected by `TenantId`, `ITenantEntity`, EF global query filters, and application-layer authorization.
- Platform operations must stay under explicit platform-scoped APIs.
- File uploads must validate size, extension, MIME type, authorization, quota, and generated storage keys.
- Production deployments must disable development tenant headers and setup mode, use HTTPS/HSTS, and keep secrets out of committed config.

## Implementation Security Documentation

See `docs/SECURITY.md` for current implementation security rules and `docs/ROADMAP.md` for current readiness and unresolved risks.
