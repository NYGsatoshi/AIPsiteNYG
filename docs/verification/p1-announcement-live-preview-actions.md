# Issue #382 — Announcement live preview actions and linked attachment

## Scope

This change completes the local Announcement preview contract introduced by PR #439.

The editor, local preview, durable draft workflow, publication transition, and recipient detail now share one content model:

- title
- plain-text body
- priority
- authorized audience summary
- read-confirmation state
- one optional CTA (`label` + `url`)
- one optional linked attachment (`label` + `url`)

The linked attachment is a reference to an already-authorized application route or HTTPS resource. It is not a binary upload contract and does not store a storage key, signed URL, capability grant, or download authorization.

## Persistence and compatibility

No database migration is required. CTA and attachment metadata are stored in a versioned envelope in the existing 20,000-character `Body` column.

- Existing plain-text rows remain unchanged and decode with no actions.
- Draft save and publication copy the same canonical persisted value.
- Draft and Announcement detail responses expose plain `body`, `cta`, and `attachment` fields separately.
- Unknown or malformed envelopes fail closed to plain text with no actionable links.
- The envelope length, including metadata, must remain within the existing 20,000-character database limit.

## URL boundary

The API and frontend accept only:

- an application-relative path beginning with one `/`, without traversal segments; or
- an absolute `https://` URL with a host and without embedded credentials.

The contract rejects HTTP, protocol-relative URLs, `javascript:`, backslashes, control characters, whitespace, traversal segments, and credential-bearing HTTPS URLs.

## Preview boundary

The local preview remains deliberately inert:

- no Announcement identifier is assigned;
- no HTTP or router request is made;
- CTA and attachment rows have no `href`;
- no publish, delivery, download, read, or analytics operation can occur;
- desktop and bounded mobile widths can be switched locally for layout review.

Published Announcement detail renders only links that pass the frontend defensive mapper after the server-owned contract has validated them.

## Automated coverage

Backend:

```text
AnnouncementContentContractTests
- legacy plain-text compatibility
- CTA and attachment round trip through draft/detail responses
- safe URL allowlist
- unsafe URL rejection
- malformed envelope fail-closed behavior
```

Frontend:

```text
announcements.api.spec.ts
- create/draft serialization
- detail/draft mapping
- unsafe response link suppression
- safe URL allowlist

announcement-editor.links.spec.ts
- live CTA/attachment preview
- draft submission preservation
- unsafe URL publication block and focus
- paired label/URL validation

announcement-local-preview.component.spec.ts
- inert CTA/attachment rendering
- mobile preview switch
```

## Manual verification

1. Open the Announcement create editor.
2. Enter title, body, priority, and an authorized audience.
3. Enter a CTA label and `/`-relative or HTTPS URL.
4. Enter a linked-attachment label and `/`-relative or HTTPS URL.
5. Open Preview and verify title, body, priority, audience, attachment presence, and CTA update without navigation.
6. Switch Desktop / Mobile and verify the layout remains readable.
7. Return to Edit and confirm all values are preserved.
8. Save the draft, reload it, and confirm CTA and attachment values are restored.
9. Publish through the confirmation dialog and verify recipient detail renders the CTA and linked attachment.
10. Repeat with `javascript:`, HTTP, protocol-relative, traversal, and credential-bearing URLs; confirm save/publication is blocked.
