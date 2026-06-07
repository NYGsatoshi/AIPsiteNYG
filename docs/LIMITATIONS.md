# Limitations

These limitations are intentional release notes. Do not describe them as complete features in demos or handoff material.

- No end-to-end encryption yet.
- No voice or video calls.
- No live streaming.
- No full billing or payment integration.
- No advanced SSO.
- No dedicated full-text search engine.
- No advanced Gantt drag editing.
- No full free-form docking.
- No complete external integrations.
- API token creation/validation is foundation-only until authentication middleware is implemented.
- Webhook endpoint management exists, but outbound delivery is deferred.
- Object storage provider names are configuration placeholders until a production adapter is implemented.
- Local filesystem storage is suitable for development and small on-prem pilots only.
- Tenant metadata export is implemented, but full tenant restore is not.
- Password reset is not implemented.
- Full CSRF token enforcement is not implemented for cookie-auth unsafe methods.
- SaaS readiness depends on authenticated HTTP tenant isolation tests passing.
- SaaS readiness also depends on PostgreSQL-backed search isolation tests and object storage.
- Backup/restore documentation exists, but each pilot environment still needs a recorded restore drill.
