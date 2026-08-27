# P1 announcement local-preview verification

Status: bounded, non-closing local preview candidate. This record covers only
the existing Announcement editor's current-tab presentation. It does not add a
new Announcement API, a persisted preview, or a recipient delivery workflow.

## Implemented boundary

The editor exposes native `Edit` and `Preview` buttons. Preview renders the
current form values directly: title, plain-text body, mapped priority, the
current server-authorized audience display name, estimated recipient count when
available, and the existing read-confirmation requirement. The recipient-side
priority badge is reused; the read-confirmation state is inert explanatory
text, never the live recipient action.

Preview is deliberately local-only. Toggling it has no HTTP request, create
command, delivery, read, analytics, route, storage, or persistence behavior.
It has no persisted identifier and cannot emit the live detail component's
mark-read command. Returning to Edit retains the reactive form values and
focuses the title field.

The editor resolves its audience solely from the current server-authorized
option list. On a refreshed projection that revokes the selected audience, it
closes preview and removes the old display name/count rather than retaining a
snapshot. A full protected-state clear destroys the editor and its local
preview together.

## Truthful display limits

The preview says only that the Announcement is not published and will publish
immediately after the separate confirmation step. It does not fabricate a
publication timestamp, recipient identities, a CTA URL, attachments, links,
scheduled delivery, time-zone behavior, saved drafts, delivery state, read
history, analytics, or an existing-Announcement edit mutation.

The current API create contract carries title, body, numeric priority, exact
authorized scope IDs, `isPinned: false`, and read-confirmation. It contains no
browser schedule, attachment, link/CTA, or persisted draft command. Existing
`PublishedAt` storage must not be represented as an approved scheduler.

## Verification inventory

- Focused editor unit coverage verifies live title/body/priority/audience/read
  confirmation reflection, native non-submit toggles, inert read-confirmation
  presentation, no publish emission, Edit value retention/focus restoration,
  and revoked-audience preview removal.
- The static Angular Playwright announcement scenario exercises keyboard
  Preview/Edit at a forced 320-pixel viewport, checks preview content, no
  Announcement publish/read request during toggling, no horizontal overflow,
  and axe checks. Mocked responses establish UI behavior only.
- Existing real-backend announcement create/selected-scope reauthorization
  coverage remains authoritative for CSRF, persistence, and authorization; the
  local preview adds no endpoint or server behavior to re-prove.

## Issue disposition

Issue #382 remains open. Its requested complete recipient-view parity still
needs approved contracts for CTA/link configuration, attachments, an actual
existing-Announcement edit mutation, scheduled publication/time-zone semantics,
and any durable preview or analytics model. This candidate must not be
described as completing those capabilities.
