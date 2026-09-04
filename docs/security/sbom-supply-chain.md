# SEC-09 Syft SBOM supply-chain evidence

The `SBOM Security` workflow generates two distinct software-bill-of-materials views. Pull requests generate a repository/source view after NuGet restore. Trusted `main` and manual runs additionally build the licensed production Dockerfile and scan the final runtime image. A source dependency list is never treated as a substitute for the image scan.

## Pinned toolchain

Syft is pinned to `1.51.0`. `scripts/ci/install-syft.sh` downloads the Linux amd64 release archive and rejects it unless its SHA-256 is exactly `2a2e837a2c8d59ec9af5472ee22d3b04ee463c4e44476ecf993fd1e5ab6ebc7f`. The workflow does not use a moving `latest` tag.

## Evidence set

Each view contains:

- `sbom.cyclonedx.json`;
- `sbom.spdx.json`;
- `components.normalized.json`;
- `metadata.json`.

The image view additionally contains `image.digest`, the Docker content-addressed image ID (`sha256:...`) used for both image scans.

`metadata.json` records the repository commit, GitHub Actions run identity, Syft version, format/schema versions, generation time, component counts, output hashes, and the image digest where applicable. `verify_sbom.py verify-hashes` recomputes the recorded SHA-256 values before artifact upload.

## Completeness and leak checks

The source lane requires packages from all material dependency families: root npm (`@playwright/test`), frontend npm (`@angular/core`), and NuGet (`Microsoft.EntityFrameworkCore`). The image lane requires the Debian runtime package `curl` and independently checks that `AipPortal.Web.dll` and `AipPortal.Web.deps.json` exist in the final image.

A dynamically generated fake secret marker must not appear in either SBOM. The trusted image lane also rejects the protected Syncfusion license value if it appears in either generated JSON document. Build secrets are mounted with BuildKit secret mounts and are not passed as Docker build arguments.

## Reproducibility policy

Raw SBOM metadata can contain timestamps, document namespaces, UUIDs, and ordering that are not stable across runs. The machine projection therefore retains only component identity fields (`type`, `name`, `version`, package URL) plus duplicate occurrence counts, sorted deterministically. The trusted image lane scans the same immutable image digest twice and fails if these normalized projections differ.

SBOM generation, JSON validation, structural schema validation, required-package checks, leak checks, hash verification, and image reproducibility checks are blocking steps. Signing and attestations are deliberately outside SEC-09 and belong to SEC-11.
