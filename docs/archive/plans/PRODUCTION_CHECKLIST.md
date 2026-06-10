# Production Checklist

- HTTPS enabled at the reverse proxy or hosting layer.
- Secure cookies enabled in production.
- CSRF protection enabled for cookie-authenticated unsafe browser requests.
- Data Protection keys persisted outside the container/process.
- Production connection string configured through environment variables.
- File storage path configured and mounted.
- Database backup configured and restore tested.
- Admin account created and protected.
- Default passwords removed.
- Allowed upload extensions reviewed.
- Upload size reviewed.
- Audit logs enabled.
- Error responses are safe and do not expose stack traces.
- CORS reviewed.
- Rate limiting considered for login and invite endpoints.
- Server firewall configured.
- Reverse proxy configured.
- Raw passwords, tokens, invite tokens, and message/file contents excluded from logs.
