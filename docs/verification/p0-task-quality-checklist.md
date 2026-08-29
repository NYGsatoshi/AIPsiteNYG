# P0 Task-create quality checklist verification

Status: Issue #354 implementation candidate. This is a bounded browser review
inside the maintained canonical Project-to-Task-create flow. It does not add a
Task state, a required Brief field, an API, persistence, a runtime, or a source
provider.

## Product boundary

The checklist evaluates only form values that the current Task-create contract
already owns:

- trimmed Task Brief `goal`;
- trimmed Task Brief `deliverable`;
- trimmed Task Brief `constraints`;
- the effective two-boolean source policy.

The source policy is either the server-authorized Project default from
`GET /api/projects/{projectId}/tasks/create-options` or a complete
manager-authorized Task override selected in the same form. The checklist never
uses `Project.Description` as a Brief default. A policy with both flags false
is an explicit fail-closed policy and is reported as covered, not absent.

Empty Brief values are advisory gaps only. Each gap has a native button that
focuses its corresponding existing Goal, Deliverable, or Constraints control.
The user may still create the Task with any or all optional Brief values empty.
The checklist cannot alter authorization, source-policy capability, the strict
create body, idempotency, CSRF, server validation, or Task persistence.

There is no claim of outbound Web access, provider selection, file
materialization, source inventory, source-content persistence, execution start,
or runtime output.

## Acceptance mapping

| Issue #354 need | Candidate evidence |
| --- | --- |
| Review major conditions before creation | The form visibly reports a compact covered count and Goal, Deliverable, Constraints, and effective source-policy rows. |
| Go to missing information | Native missing-Brief buttons focus the reusable form controls. |
| Remain non-blocking | Optional empty Brief values leave canonical Create enabled after the required title is valid. |
| Completed values are represented correctly | Trimmed Brief values change from an action to `Covered`; the effective inherited or Task-specific policy is rendered verbatim as enabled/disabled flags. |
| Respect inherited values | The source row reads the server-returned Project policy unless the current server capability permits and the user selects a complete Task override. |

## Recorded local verification

- Focused Task-create page component suite: 11 passed under Node 24.19.0. It
  covers missing-field focus, fail-closed inherited policy, Task-specific
  override projection, 4/4 completion, and optional-empty submit.
- Application and spec TypeScript compilation passed under Node 24.19.0.
- Production Angular build passed. It introduced no Task-create style-budget
  warning; existing repository bundle and unrelated component-style warnings
  remain.
- The focused Project New Task static Playwright scenario passed in both
  Chromium desktop and mobile at a forced 320-pixel viewport. It
  keyboard-activates Add Goal, checks focus, fills all Brief fields, checks the
  4/4 review, retains no-horizontal-overflow and axe coverage, and submits the
  unchanged canonical request shape. Its API responses are mocked.
- The existing manifest-required real-backend MVP0 scenario is extended in
  source to inspect the server-returned effective policy, use the focus action,
  verify 4/4 after filling the Brief, and then verify the persisted canonical
  Task/Brief. It remains in the required real-backend title rather than a
  separate optional smoke.

## Required remaining evidence

- Run the extended manifest-required real-backend Compose/CI scenario against
  PostgreSQL and ASP.NET Core. A mocked browser run cannot prove server
  authorization, CSRF, idempotency, or persistence.
- Review the exact final-head CI evidence after any change to this candidate.
- The checklist does not close Issue #357: current source policy remains
  configuration only until canonical specification promotion and an approved
  Web/provider/egress/runtime contract exist.
