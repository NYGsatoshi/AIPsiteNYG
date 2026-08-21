# WPC-Final02 Test, Coverage, and CI Audit

Status: implementation candidate. Final acceptance requires the hosted checks for the
exact pull-request head described in the merge gate below.

## 1. Fixed audit baseline

| Repository | Ref | SHA |
|---|---|---|
| `NYGsatoshi/AIPsiteNYG` | `main` | `31a5d2986d8a83c31fbaee22a679042a17b4335c` |
| `NYGsatoshi/AIPsiteNYGspec` | `main` | `90240d50fc01cb45022fa587da8b3889a152cc254` |

The implementation baseline already contains WPC-02A through WPC-02F and the
WPC-02E-2 response-boundary adoption. This audit does not infer completion from
routes, entities, or historical documents; it uses the current test assembly,
workflow definitions, frontend specifications, and a retained hosted TRX
artifact.

## 2. Inherited evidence

The most recent retained backend artifact inspected before this change was:

- pull-request head: `04ba4afb2ab0e4c5bbd8a11159a2861dfc2b76ab`
- GitHub Actions run: `32457165854`
- artifact: `backend-test-results`
- PostgreSQL service: PostgreSQL 18, configured by the normal `CI` workflow
- TRX counters: `total=1034`, `executed=1034`, `passed=1034`
- non-passing counters: all zero, including `failed`, `error`, `timeout`,
  `aborted`, and `notExecuted`

This is an inherited baseline only. It is not acceptance evidence for the
WPC-Final02 pull-request head.

## 3. Findings

### 3.1 Backend acceptance coverage existed but was not governed as one WPC set

The current backend suite contains WPC-02A through WPC-02F tests. WPC-02B,
WPC-02C, and WPC-02D also have dedicated PostgreSQL workflows and required-test
manifests. WPC-02A, WPC-02E, and WPC-02F were executed by the full backend run,
but there was no single durable contract that:

1. enumerated the complete A-F acceptance surface;
2. failed when a scoped test was removed or renamed;
3. failed when a new scoped test was added without being reviewed into the
   final acceptance set; and
4. proved the dedicated B/C/D manifests remained included in the final set.

### 3.2 WPC-02F had one untested current-Workspace rejection branch

The existing `wpc-02f-notification-navigation.spec.ts` already directly
covers:

- Artifact open through the server-authoritative endpoint;
- Message open through the canonical Conversation route;
- rejection of a mismatched Message ID; and
- an `Unavailable` protected target remaining unread.

The remaining branch was narrower: the backend may return an otherwise
canonical `Opened` route and Workspace context, while that Workspace is no
longer present in `AuthSessionFacade.currentUser().workspaces`. Production code
fails closed in `switchToAuthorizedWorkspace`, but the dedicated WPC-02F
frontend suite did not directly pin that membership-revocation case.

### 3.3 The existing CI topology is already the correct execution authority

The normal `CI / build-test` job already:

- provisions PostgreSQL 18;
- exports both application and test connection strings;
- applies migrations;
- rejects pending EF model changes;
- runs the complete solution test assembly; and
- verifies the TRX has no failed, skipped/not-executed, aborted, or incomplete
  results.

The frontend job already runs the Angular production build, the complete unit
suite, architecture checks, licensed build, Storybook build, and the Linux
Docker Playwright smoke suite. Adding six more near-identical WPC workflows
would duplicate restore/build work without improving the authority of the
evidence.

## 4. Remediation

### 4.1 Canonical A-F required-test manifest

`scripts/ci/wpc-final02-required-tests.txt` records 67 unique backend test
methods:

| Scope | Required methods | Primary evidence |
|---|---:|---|
| WPC-02A | 12 | PostgreSQL migration/governance and archived Workspace authorization |
| WPC-02B | 4 | PostgreSQL CapabilityGrant and Workspace `general` |
| WPC-02C | 15 | canonical create contract, authorization, idempotency, audit, and rollback |
| WPC-02D | 14 | activation contract, workflow precedence, serialization, and atomicity |
| WPC-02E | 21 | canonical projection, response architecture, export redaction, and revocation |
| WPC-02F | 1 | PostgreSQL current-authorized Artifact/Message notification open |
| **Total** | **67** | one reviewed WPC-Final02 acceptance surface |

Parameterized theories produced 83 concrete WPC result cases in the inherited
TRX. The manifest intentionally records stable method identities rather than
individual theory display names.

### 4.2 Backend coverage contract

`WpcFinal02CoverageContractTests` is discovered by the existing full backend
run and enforces:

- exactly 67 unique active manifest entries;
- exact equality between the manifest and every executable xUnit method carrying
  `Scope=WPC02A` through `Scope=WPC02F`;
- inclusion of every existing WPC-02B/C/D dedicated-manifest method; and
- preservation of `PostgreSqlFactAttribute` plus
  `Category=PostgreSQLIntegration` for provider-authoritative entries.

This makes silent deletion, renaming, trait removal, provider-test weakening,
or unreviewed scope expansion fail the normal CI test job.

### 4.3 WPC-02F current-Workspace regression

The existing `wpc-02f-notification-navigation.spec.ts` is extended with one
focused case:

1. the notification list carries a protected Artifact target;
2. the backend returns `Opened`, the exact canonical Artifact route, and a
   Workspace ID;
3. that Workspace is absent from the current user's authorized Workspace set;
4. the client does not switch Workspace;
5. the client does not navigate; and
6. the notification remains unread and reports the target as unavailable.

This complements, rather than duplicates, the existing Artifact, Message,
mismatched-ID, and unavailable-target cases.

## 5. CI execution model

No additional duplicate acceptance workflow is introduced.

The existing jobs provide the gates:

| Gate | WPC-Final02 use |
|---|---|
| `CI / build-test` | discovers the coverage contract and all A-F backend tests against PostgreSQL 18 |
| strict backend TRX verification | rejects failed and not-executed/skipped results |
| WPC-02B/C/D PostgreSQL workflows | retain their narrower provider-specific acceptance gates |
| `CI / frontend-test` | discovers the amended WPC-02F Angular spec and runs build/unit/architecture/Storybook/Playwright checks |
| security and dependency jobs | remain independent release guards |

## 6. Reproduction commands

Backend:

```bash
dotnet restore AipPortal.slnx
dotnet build AipPortal.slnx --configuration Release --no-restore
dotnet test AipPortal.slnx \
  --configuration Release \
  --no-build \
  --logger "trx;LogFileName=backend-tests.trx"
```

Provider-authoritative execution requires:

```bash
export POSTGRES_TEST_CONNECTION_STRING='<disposable PostgreSQL 18 connection string>'
export ConnectionStrings__DefaultConnection="$POSTGRES_TEST_CONNECTION_STRING"
```

Frontend:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run build-storybook
npm run test:ui:angular:docker
```

A local backend run without `POSTGRES_TEST_CONNECTION_STRING` is not
PostgreSQL acceptance evidence, even when non-provider tests pass.

## 7. Merge gate

WPC-Final02 is mergeable only when all of the following are true for one exact
pull-request head:

1. normal backend CI passes with PostgreSQL 18 configured;
2. the WPC-Final02 coverage contract passes;
3. no backend TRX result is failed, skipped/not-executed, aborted, or incomplete;
4. WPC-02B/C/D dedicated PostgreSQL jobs pass;
5. the WPC-02F current-Workspace rejection regression passes;
6. Angular production/licensed builds, architecture checks, Storybook, and
   Linux Docker Playwright smoke pass; and
7. no unrelated production or migration changes are present.

## 8. Residual observability note

The backend job publishes a TRX artifact with per-test identities. The Angular
job currently fails on unit-test regressions but does not publish an equivalent
durable per-test result artifact. This does not prevent the amended WPC-02F test
from gating CI, but it limits post-run per-test evidence retention. Adding a
stable Angular JUnit artifact is an observability enhancement; it should be
handled without replacing the existing full frontend gate.
