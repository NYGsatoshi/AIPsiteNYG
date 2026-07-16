# Syncfusion adapter foundation (v0.4 PR02)

Status: `PENDING_VENDOR_CONFIRMATION`

This foundation keeps complex UI contracts owned by AIPsite. Feature code uses
the contracts in `frontend/src/app/shared/ui/contracts/`; only future code in
`frontend/src/app/shared/ui/adapters/syncfusion/` or
`frontend/src/app/shared/vendor/syncfusion/` may import Syncfusion packages.

## Current safe behavior

- Every complex adapter resolves to its AIPsite fallback shell.
- `frontend.syncfusionGrid` and `frontend.syncfusionUploader` default to
  `false`; there is deliberately no duplicate `frontend.syncfusionAdapters`
  runtime key because the canonical amendment names the two per-adapter keys.
- A pending, missing, or placeholder license configuration fails closed. It
  neither initializes a vendor package nor logs the supplied value.
- No production, school-shared, or public deployment may enable a Syncfusion
  implementation while this status remains pending.

## License/configuration contract

The only secret name is `SYNCFUSION_LICENSE_KEY`. It is supplied through the
local developer secret store, CI secret store, and deployment secret store;
the repository, `.env.example`, fixtures, snapshots, logs, evidence, and PR
body must not contain a real value.

At a future approved deployment boundary, the host may provide the browser
bootstrap configuration `window.__AIP_SYNCFUSION_RUNTIME__` with
`licenseStatus: 'verified'` and the runtime key sourced from that secret. The
single entry point is `AipSyncfusionLicenseBootstrapService.bootstrap()`. Its
result contains only activation state and never returns the key. Registration
is allowed only after vendor eligibility is confirmed and a vendor adapter
registrar is supplied from the approved adapter boundary.

Before enabling either rollout key, record the confirmed Community/education
or commercial license basis for the actual organization and intended
deployment. This document does not assert eligibility.

## Deferred vendor implementation

`BLOCKED: SYNCFUSION_LICENSE_CONFIRMATION`

The actual Syncfusion package dependencies, registrar, lazy vendor factories,
and Syncfusion-backed implementations for Data Grid, Dialog, File Uploader,
Date/Time Picker, Kanban, Gantt, Tree Grid, and Scheduler remain blocked.
Their public AIPsite contracts and fallback shells are present now, so feature
screens remain unchanged and AG Grid remains active.
