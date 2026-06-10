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
- Cookie-auth browser CSRF protection is implemented for same-origin frontend/API calls; external API clients should use a future non-cookie API token authentication path.
- Login lockout is persisted on existing user accounts; unknown-email attempts use generic responses and audit/rate-limit controls but do not create persistent lockout rows.
- Sessions are not tenant-bound records yet, so tenant membership and role changes revoke the user's active sessions globally.
- SaaS readiness still depends on PostgreSQL-backed search isolation tests and object storage.
- Backup/restore documentation exists, but each pilot environment still needs a recorded restore drill.
