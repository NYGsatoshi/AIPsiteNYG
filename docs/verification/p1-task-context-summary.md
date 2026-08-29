# P1 Task context summary verification

Issue: #339

Status: local candidate evidence; exact-head CI pending

## Scope

The maintained Task detail source-scope component now presents a compact
summary before its full Issue #357 detail. It derives only a zero-to-two count
of enabled generic source kinds, the `Web` and `Project files` policy states,
and the server-owned Project-default or Task-override origin. It adds no API,
source inventory, provider, runtime, or authorization behavior.

Activating the summary moves focus to the detailed context region. The
capability-gated settings link remains separate, and the server continues to
authorize every mutation. Existing authoritative refetch, request-generation,
and protected-state clearing update or remove both summary and detail together.

## Acceptance coverage

| Acceptance criterion | Evidence |
| --- | --- |
| Compact context types/count | Component and contract tests cover 0, 1, and 2 allowed source-kind states plus Web/Project-files labels. |
| Detail/settings navigation | Component and Playwright coverage activate the summary and assert focus on the detailed context; the existing authorized editor link remains covered. |
| Inheritance versus override | Contract and Playwright coverage assert `Task override`; component coverage asserts refreshed `Project default` state. |
| Authorization changes | Component tests cover synchronous security clearing, denied refresh clearing, and authoritative Project/Task invalidation refetch. |
| No unauthorized names/counts | Contract tests require the explicit non-inventory explanation and reject fixture source identifiers/details. |
| Responsive and accessible | The focused Playwright scenario runs at 320 pixels with keyboard activation, horizontal-containment, and axe checks. |

## Verification record

Local candidate checks:

- Focused Angular source-scope tests passed 13/13 across the component and
  canonical contract files.
- The full Angular suite passed 974/974 in 95 files.
- The production Angular build passed. It retained the repository's existing
  initial-bundle and unrelated component-style warnings and introduced no new
  source-scope style-budget warning.
- The focused Issue #357 backend contract passed 24/24. This frontend-only
  change adds no provider-specific query, migration, or persistence behavior.
- Frontend architecture validation passed, including 4/4 architecture harness
  tests.
- The focused Task source-scope Playwright scenario passed 2/2 in the desktop
  and mobile Chromium projects. The test forces a 320-pixel viewport, uses
  keyboard activation, verifies focus transfer and horizontal containment,
  and runs axe.
- The broader host-native Playwright run passed 124 functional cases with 8
  expected skips. Its two screenshot-baseline cases failed on the unrelated
  Workspace shell (desktop and mobile drawer). Repository policy treats
  Windows host screenshots as diagnostic only; the pinned Linux CI screenshot
  job remains required and no baseline was changed.
- `git diff --check` passed.

The browser API remains mocked. It proves presentation and interaction, while
the unchanged Issue #357 backend tests remain the server authorization and DTO
evidence. Required CI on the immutable PR head must be green before merge.
