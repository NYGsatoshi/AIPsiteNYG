# A-07 File Boundary Failure Log

Issue: A-07 - [MVP-A][P0][FileBoundary] Verify file, attachment, download, and grant boundary baseline

Date: 2026-06-29

Result: Needs verification

This failure log does not imply production approval, MVP-A Go, production readiness, or acceptance of unrelated MVP-A blockers.

## Summary

No confirmed unauthorized file-body exposure was observed in the final automated A-07 verification pass. The targeted file/storage/tenant-boundary test slice passed 32/32, and the full backend suite passed 134/134.

One source-level metadata exposure risk was found and fixed: file and artifact-version metadata responses returned internal storage identifiers (`storageKey`, `storedFileName`, and artifact `filePath`) to authorized callers. The API response DTOs no longer return those fields, and regression tests verify that authorized file metadata and denied file responses do not disclose storage identifiers.

The remaining A-07 limitations are verification blockers or implementation gaps, not observed file-body leaks in the tested paths.

## Resolved During A-07

### Storage Identifier Metadata Exposure

Failure area: metadata / storage path leakage

Endpoint or code area: file metadata responses, upload responses, artifact-version metadata responses

Actor: authorized synthetic user

Expected result: API metadata responses should not expose internal storage path/key values or stored server filenames.

Actual result before fix: `AttachmentResponse`, `FileObjectResponse`, and `ArtifactVersionResponse` included internal storage identifiers.

Sanitized response summary: no real storage paths or file values were copied. Source inspection showed DTO fields for storage identifiers.

Sanitized log summary: no runtime log body was captured.

Data exposure risk: yes, metadata-only internal path/key exposure to authorized callers.

Required fix: remove storage identifier fields from API response DTOs and update constructors.

Whether this blocks MVP-A: yes until fixed, because storage paths are private file metadata.

Status: Resolved

Evidence: `dotnet build --no-restore` passed with 0 warnings/errors; targeted A-07 tests passed 32/32; full backend tests passed 134/134.

### Private Download Cache Headers

Failure area: download cache behavior

Endpoint or code area: `FilesController`, `AttachmentsController`, `ArtifactsController`

Actor: authorized synthetic user

Expected result: private file downloads should not be cacheable by shared or unsafe caches.

Actual result before fix: download actions returned `File(...)` without explicit private no-store headers.

Sanitized response summary: no file body copied.

Sanitized log summary: no runtime log body captured.

Data exposure risk: unknown / contextual.

Required fix: add `Cache-Control: no-store, max-age=0`, `Pragma: no-cache`, and `Expires: 0` before returning file streams.

Whether this blocks MVP-A: Needs verification after fix in broader runtime, but the direct HTTP regression now passes.

Status: Resolved for tested file endpoint; broader attachment/artifact live matrix Needs verification.

Evidence: `FileDownloadResponsesUsePrivateCacheHeaders` passed in the targeted test slice.

### Denied File Access Audit Logging

Failure area: audit/log coverage

Endpoint or code area: `FileService.GetAsync`, `FileService.DownloadAsync`, `FileService.GetFileObjectAsync`

Actor: authenticated synthetic user without file access

Expected result: denied file metadata/download attempts should be auditable without logging file body, filename, storage key, token, cookie, signed URL, or message body.

Actual result before fix: successful file actions were audited, but denied file metadata/download attempts did not have explicit metadata-only audit entries in the inspected service path.

Sanitized response summary: denied responses were generic.

Sanitized log summary: no file body or path values copied.

Data exposure risk: no observed data exposure; audit coverage gap.

Required fix: add metadata-only denied access audit entries.

Whether this blocks MVP-A: Needs verification until a broader audit matrix is run.

Status: Improved; full runtime log matrix remains Needs verification.

Evidence: source change in `FileService`; backend suite passed 134/134.

## Remaining Verification Blockers

### Fresh Runtime File Smoke

Failure area: upload/download/metadata live runtime

Endpoint or code area: file and attachment APIs on a fresh app baseline

Actor: approved synthetic admin, normal user, non-member, project member, and conversation participant

Expected result: direct runtime evidence for upload, allowed download, denied download, denied metadata, and path traversal filename handling.

Actual result: not executed against a fresh running app in this pass.

Sanitized response summary: no live file response body captured.

Sanitized log summary: no live runtime log captured.

Data exposure risk: unknown.

Required fix: resolve P0-001 with the smallest approved local/dev/test bootstrap path, then rerun A-07 runtime smoke without disabling auth.

Whether this blocks MVP-A: yes for A-07 acceptance.

Status: Needs verification

### Attachment And Conversation Body Matrix

Failure area: attachment / conversation participant boundary

Endpoint or code area: `/api/attachments/{id}`, `/api/attachments/{id}/download`, conversation-owned attachments

Actor: participant, non-participant, removed participant

Expected result: only authorized participants can read attachment metadata/body; removed participants cannot read past conversation attachments unless explicitly allowed by policy.

Actual result: source authorization exists, but explicit endpoint/body tests for all actors were not completed in this pass.

Sanitized response summary: no body captured.

Sanitized log summary: no body captured.

Data exposure risk: unknown.

Required fix: add explicit synthetic HTTP tests for attachment body access by participant, non-participant, and removed participant.

Whether this blocks MVP-A: yes for complete A-07 acceptance.

Status: Needs verification

### Explicit Grant / Revoked Grant Model

Failure area: grant boundary

Endpoint or code area: file grant/access model

Actor: explicit grantee, non-grantee, revoked grantee, expired grantee

Expected result: grants can be created/revoked/expired and revoked or expired grants cannot download file bodies.

Actual result: no separate file-grant entity or grant-expiration model was identified in this pass.

Sanitized response summary: no response body captured.

Sanitized log summary: no log captured.

Data exposure risk: unknown / feature gap.

Required fix: document whether MVP-A relies only on project/conversation/channel owner scope or requires explicit file grants. If explicit grants are required, implement and test revoke/expiry boundaries.

Whether this blocks MVP-A: Needs product classification; keep A-07 as Needs verification until resolved.

Status: Needs verification

### Object Storage / Signed URL / CDN

Failure area: signed URL and object storage boundary

Endpoint or code area: object-storage providers and direct download URL handling

Actor: any authenticated or unauthorized user

Expected result: private file bodies are not exposed by permanent public URLs, logs, evidence, or unsafe signed URL handling.

Actual result: local storage returns no signed URL; object-storage providers are unsupported in this repo state and were not live-verified.

Sanitized response summary: no signed URL copied.

Sanitized log summary: no signed URL copied.

Data exposure risk: unknown for future object-storage implementation.

Required fix: verify only after a non-production object-storage adapter exists.

Whether this blocks MVP-A: Blocked for object-storage evidence; not an observed local-storage leak.

Status: Blocked

## No Observed P0 File-Body Leak In Final Automated Tests

The final automated test pass did not show these P0 leak examples in the tested synthetic paths:

- anonymous user reading protected file body;
- cross-tenant user reading another tenant's seeded file metadata or body through a wrong tenant context;
- outsider reading seeded project file body;
- file ID probing returning another file's filename, storage key, storage path, or body in denied responses;
- traversal-looking upload filename becoming a storage path;
- file storage key escaping the configured local storage root.

This statement is limited to the tested synthetic paths and does not mark A-07 Accepted.
