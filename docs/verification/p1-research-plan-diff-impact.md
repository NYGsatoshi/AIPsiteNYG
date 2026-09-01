# P1 Research Plan Diff + Impact (`#366`)

## Canonical review contract

Issue #366 extends the existing server-owned immutable Research Plan revision
model from #364; it does not introduce a second plan source of truth or a second
execution snapshot mechanism.

The edit flow is:

1. `GET /api/tasks/{taskItemId}/research-plan` returns the current authorized
   immutable revision and aggregate version.
2. Existing steps retain the current revision step `id` as `baseStepId` in the
   browser draft; newly added steps have `baseStepId: null`.
3. `POST /api/tasks/{taskItemId}/research-plan/preview` accepts the complete
   proposed ordered step list plus `expectedVersion`.
4. The server normalizes the draft, validates that each supplied `baseStepId`
   belongs to the current revision and is referenced at most once, and returns
   a typed diff plus a bounded impact summary.
5. The preview returns a SHA-256 fingerprint bound to the current plan version,
   current revision identity, normalized ordered draft, and base-step mapping.
6. `PUT /api/tasks/{taskItemId}/research-plan` echoes that fingerprint as
   `previewFingerprint`. If the version changed, the normal stale-version 409
   applies. If the draft differs from what was reviewed, the server returns 409
   `RESEARCH_PLAN_PREVIEW_MISMATCH` and appends no revision.
7. A successful save still creates one complete next immutable revision. The
   existing Task execution snapshot continues to capture the exact current
   revision at accepted-run time.

Legacy authorized callers may still use the #364 atomic replacement contract
without a preview fingerprint. The first-party Task UI introduced by #366
requires review before enabling its save action.

## Diff semantics

The server distinguishes these change kinds:

- `Added`: a proposed step has no `baseStepId`.
- `Removed`: a current-revision step is not referenced by the proposed draft.
- `Modified`: title, objective, scope summary, or status differs after server
  normalization.
- `Reordered`: the relative order of retained current-revision steps changes.
  Position shifts caused only by adding/removing another step do not create a
  false reorder classification.

One retained step may be both `Modified` and `Reordered`.

## Impact semantics

Impact output is intentionally bounded to facts the current product contract can
prove. It reports:

- execution step-count changes;
- execution-order changes;
- added/removed execution-plan steps;
- changed step content/status;
- changed source-scope *guidance text*;
- when Plan coverage changes enough that Task deliverable alignment should be
  reviewed before save.

A Research Plan edit does **not** widen effective source authorization. The
existing Task execution source policy remains the authority for source access.
Likewise, Research Plan text does not mutate the Task deliverable contract, so
free-form text is never interpreted as proof that a deliverable expanded or
contracted.

## Undo / discard

Before persistence, `Discard changes` restores the loaded authoritative revision
and invalidates any preview. Any subsequent draft edit also invalidates the
preview, so the user must review again before saving. Persisted historical
revisions remain append-only and are not mutated or deleted by this issue.

## Authorization / concurrency

Preview and save both require the existing status/visibility-sensitive
`CanManageProject` boundary. Missing, cross-Tenant, deleted, and unauthorized
Tasks use the existing metadata-safe not-found behavior. `expectedVersion`
remains the optimistic concurrency boundary; stale preview/save attempts do not
append a revision, audit mutation, or realtime invalidation.

## Verification

- `ResearchPlanDiffServiceTests`
  - classifies add/remove/modify/reorder in one authoritative preview;
  - reports bounded source-scope and deliverable-alignment impacts;
  - binds an accepted save to the reviewed fingerprint;
  - rejects changed-after-review drafts without appending a revision;
  - rejects base step identities outside the current revision.
- `task-research-plan.component.spec.ts`
  - requires `Review changes` before save;
  - renders typed diff and impact summary;
  - sends the exact reviewed base-step mapping and fingerprint on save;
  - invalidates review on any subsequent draft edit;
  - retains conflict reload and read-only viewer behavior.
- Responsive CSS keeps the before/after diff single-column below 720px and
  reduces padding below 360px so the review remains usable at 320px widths.
