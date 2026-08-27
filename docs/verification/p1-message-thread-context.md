# Issue #362 Message thread context verification

Status: candidate implementation on `feat/362-message-thread-context`.

## Implemented contract

- one logical thread is owned by a canonical root Message through nullable
  `ThreadRootMessageId`; replies remain in the same Conversation;
- the main timeline excludes replies and projects authorized root summaries;
- exact authorized GET/POST thread routes provide a pinned root, at most the
  latest 100 replies, truthful `hasMore`, a three-name summary, strict first-
  reply creation authority, and target-isolated idempotency;
- deleted replies remain stable bodyless tombstones and count toward the
  durable summary; a deleted root remains readable as a pinned tombstone but
  rejects new replies;
- `Messaging.ThreadChanged.v1` is metadata-only and forces authoritative HTTP
  reconciliation; reply `MessageCreated` events carry `threadRootMessageId`;
- channel and DM routes share a separate-draft thread surface, using a
  contextual desktop panel and dedicated pane at the existing 860-pixel mobile
  breakpoint, with native buttons, Escape, and trigger focus return.

Legacy `ConversationType.Thread` / `ParentConversationId` data and APIs are
unchanged and compatibility-only. This change performs no anchor backfill,
attachment work, quoted reply, reactions, unread cursor, lock UI, or broader
Issue #343 action work.

Known boundary: the pre-existing main Conversation list omits every deleted
Message. If an open root is deleted, the thread GET/panel continues to render
its pinned bodyless tombstone, but the root cannot be rediscovered or reopened
from the main timeline. General main-timeline tombstone presentation remains
part of the broader Message actions work, not this Issue #362 slice.

## Security evidence

The focused HTTP tests exercise direct API access for cross-Tenant,
cross-Workspace, Project-scope, nonparticipant/admin, removed, revoked-
membership, read-only, and missing `CanCreateThread` cases. Denials are
asserted not to disclose bodies, counts, or participant names. Authorized
projection always precedes participant-name reads. Audit and ThreadChanged
payload assertions reject Message bodies and participant names.

## Local verification record

- `dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --filter Scope=Issue362 --no-restore`: 4 passed, 2 environment-skipped PostgreSQL cases, 0 failed;
- backend test project/full solution compilation: passed with seven pre-existing warnings and no Issue #362 error;
- `dotnet ef migrations has-pending-model-changes`: no pending model changes;
- app Angular compiler `ngc -p tsconfig.app.json --noEmit`: passed;
- frontend spec TypeScript `tsc -p tsconfig.spec.json --noEmit`: passed;
- focused Playwright spec standalone TypeScript compilation: passed;
- frontend architecture check and its four-rule Node test suite: passed;
- `git diff --check`: no whitespace error.

Two `PostgreSqlFact` cases compile but were not executed locally because
`POSTGRES_TEST_CONNECTION_STRING` is unavailable. The local Windows Angular
unit runner also remained in transform/runner startup before test collection:
the complete focused file, a split pure-mapper file, and direct single-worker
Vitest attempts all exceeded their bounded timeouts without an assertion or
compile failure. Authoritative Linux CI must supply their execution result.

The branch was synchronized to main `dea7f12be12085f22536456c6fcfeb027ee04555`
and the focused backend, pending-model, Angular/spec TypeScript, Playwright
TypeScript, and architecture checks above were rerun at that base. The
production Angular build, static 320-pixel browser scenario, and Angular unit
assertions were not executed locally; exact-head Linux CI must supply those
gates, and no browser/axe pass is inferred from source or TypeScript checks.
