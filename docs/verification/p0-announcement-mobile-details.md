# P0 announcement mobile details verification

Status: Issue #385 implementation candidate. This record distinguishes local
mocked-browser and focused Angular evidence from the real-backend browser
smoke, which requires its Compose-only synthetic environment.

## Implemented recipient boundary

At the mobile hierarchy breakpoint, the recipient announcement list and detail
are distinct route states: `/announcements` and `/announcements/:announcementId`.
Selecting a list row pushes detail navigation; the in-detail Back action uses a
replacement list navigation so browser Back does not immediately reopen the
same detail. The list scroll position and originating row focus are restored
after Back, while direct or unavailable links use the list heading fallback.

The detail presents priority, title, publication/expiry facts, and a generic
audience scope before the body. `expiresAt` is retained and labelled only as a
display expiry; it is not presented as a task deadline. The only recipient
action is the existing server-backed read confirmation. It is single-flight,
remains unread until the server confirms `{ status: "OK" }`, reports a generic
retryable failure, and never creates a browser read timestamp. There is no
audience-name expansion, CTA URL, composer, thread, acknowledgement model, or
role-derived recipient permission.

Announcement protected state is cleared on session, tenant, workspace, and
authorization boundaries. In-flight list, detail, audience, create, and read
requests are cancelled and generation-gated before they can restore a prior
tenant projection. Rehydration is still server-authoritative: after a
tenant/session identity boundary, a fresh Workspace HTTP list must succeed
before centralized feature HTTP catch-ups run, including when realtime is
disabled. After an actual Workspace switch, the replacement active selection
is committed before those centralized HTTP catch-ups run. Existing
same-identity authorization recovery retains its Workspace HTTP fallback.

## Narrow smoke-fixture support

`SeedBrowserSmokeAsync` changes only its synthetic Browser Smoke announcement:
it requires read confirmation and removes prior `AnnouncementRead` rows only
for the matching tenant, synthetic announcement, and smoke user. This is test
fixture preparation, not a production API or domain-contract change. The
mandatory real-backend smoke now validates the read action's empty JSON body,
Angular CSRF header, confirmed UI state, and persisted `isRead` list/detail
projection after reload. It records no token, cookie, read timestamp, or user
data.

## Verification inventory

Focused Angular coverage includes API mapping, facade request/reconciliation
and protected-clear races, mobile route/Back/history focus, navigation scroll
state, and detail action focus. The static Playwright case runs at 320px with a
long recipient body and asserts the visual fact order, immediate/sticky 44px
read action, no horizontal overflow, no composer, accessibility audit, CSRF
read POST, and scroll/focus restoration.

The real-backend smoke remains an environment gate: it must be run through
`npm run test:ui:real-backend` with the repository's synthetic Compose seed.
Mocked static Playwright results do not establish backend persistence; the
real-backend helper supplies that separate proof when the environment is
available.

## Completed local checks

On 2026-08-25, the focused Angular command covering the announcement and
recovery paths passed 7 files / 87 tests. The targeted static Playwright
command for the 320px recipient detail case passed 2 / 2 projects. The
standard UI runner first completed its production build with the existing
budget warnings; this isolated worktree then used its local dependency
linkage with `PLAYWRIGHT_SKIP_BUILD=1` for the targeted static run.

The focused `AppDbContextSeedTests` command passed 5 / 5 for the narrow
BrowserSmoke fixture change. The Compose-backed real-browser smoke was not run
in this worktree: no synthetic Compose environment was started, so the
real-backend persistence/CSRF assertion remains an explicit execution gate.
