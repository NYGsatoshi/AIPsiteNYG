# Risk Register

| Risk | Description | Probability | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| Scope creep | MVP expands into deferred realtime, AI, docking, or external integrations. | High | High | Keep `docs/MVP_SCOPE.md` as the lock; convert extras to post-MVP issues. | Shared |
| Authorization bugs | Cross-workspace, group, channel, conversation, project, file, or audit leaks. | Medium | High | Enforce authorization in Application services and add cross-scope tests. | Backend |
| Data model churn | Late entity changes create migration and UI contract churn. | Medium | Medium | Freeze MVP fields early; use explicit DTOs; defer nice-to-have fields. | Backend |
| File upload security | Unsafe extension, MIME, size, path, or download behavior. | Medium | High | Validate before storage; configure paths; test invalid uploads and unauthorized downloads. | Backend |
| DM unread complexity | Conversation read markers and unread counts drift from user expectations. | Medium | Medium | Keep server-managed read state; test open/read/send cases; avoid SignalR until stable. | Tracking |
| Gantt UI complexity | Gantt grows into critical path/resource planning before MVP. | Medium | Medium | Keep first Gantt read-only and task/milestone/dependency based. | Tracking |
| Docker/deployment delay | Production readiness slips because compose, env vars, or storage are incomplete. | Medium | High | Run deployment smoke tests by Week 5; keep Docker-ready but not Docker-first. | Backend |
| UI docking overengineering | Docking consumes time needed for core workflows. | Medium | Medium | Limit MVP to persisted data model or preset layouts. | Frontend |
| Too much AI-generated code without review | Generated code introduces inconsistent patterns or hidden regressions. | High | High | Require build/test after slices; review diffs by module; prefer small issues. | Shared |
