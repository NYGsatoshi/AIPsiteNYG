#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] if "__file__" in globals() else Path.cwd()
SCRIPT = ROOT / "scripts" / "ci" / "release_supply_chain.py"
SPEC = importlib.util.spec_from_file_location("release_supply_chain", SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def digest_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReleaseSupplyChainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.digest = "sha256:" + ("a" * 64)
        self.subject = f"ghcr.io/nygsatoshi/aipsitenyg@{self.digest}"
        self.sha = "b" * 40
        self.cdx = self.root / "sbom.cyclonedx.json"
        self.spdx = self.root / "sbom.spdx.json"
        self.provenance = self.root / "provenance.json"
        self.metadata = self.root / "metadata.json"
        self.cdx.write_text(
            json.dumps(
                {
                    "bomFormat": "CycloneDX",
                    "specVersion": "1.6",
                    "version": 1,
                    "components": [{"type": "library", "name": "curl"}],
                }
            ),
            encoding="utf-8",
        )
        self.spdx.write_text(
            json.dumps(
                {
                    "spdxVersion": "SPDX-2.3",
                    "SPDXID": "SPDXRef-DOCUMENT",
                    "name": "test",
                    "packages": [{"name": "curl", "SPDXID": "SPDXRef-Package-curl"}],
                }
            ),
            encoding="utf-8",
        )
        self.metadata.write_text(
            json.dumps(
                {
                    "schema": release.SBOM_EVIDENCE_SCHEMA,
                    "sourceKind": "image",
                    "repositoryCommit": self.sha,
                    "imageOrReleaseDigest": self.digest,
                    "formats": {
                        "cyclonedx-json": {
                            "file": self.cdx.name,
                            "sha256": digest_file(self.cdx),
                        },
                        "spdx-json": {
                            "file": self.spdx.name,
                            "sha256": digest_file(self.spdx),
                        },
                    },
                }
            ),
            encoding="utf-8",
        )

    def test_good_digest_and_sbom_binding_succeeds(self) -> None:
        digest, cdx_hash, spdx_hash = release.validate_sbom_binding(
            subject=self.subject,
            repository_sha=self.sha,
            metadata_path=self.metadata,
            cyclonedx_path=self.cdx,
            spdx_path=self.spdx,
        )
        self.assertEqual(self.digest, digest)
        self.assertEqual(digest_file(self.cdx), cdx_hash)
        self.assertEqual(digest_file(self.spdx), spdx_hash)

    def test_different_release_digest_fails(self) -> None:
        other_subject = "ghcr.io/nygsatoshi/aipsitenyg@sha256:" + ("c" * 64)
        with self.assertRaises(release.ReleaseEvidenceError):
            release.validate_sbom_binding(
                subject=other_subject,
                repository_sha=self.sha,
                metadata_path=self.metadata,
                cyclonedx_path=self.cdx,
                spdx_path=self.spdx,
            )

    def test_sbom_payload_from_other_artifact_fails(self) -> None:
        self.cdx.write_text('{"bomFormat":"CycloneDX","components":[]}', encoding="utf-8")
        with self.assertRaises(release.ReleaseEvidenceError):
            release.validate_sbom_binding(
                subject=self.subject,
                repository_sha=self.sha,
                metadata_path=self.metadata,
                cyclonedx_path=self.cdx,
                spdx_path=self.spdx,
            )

    def test_attestation_subject_mismatch_fails(self) -> None:
        statement = {
            "_type": "https://in-toto.io/Statement/v0.1",
            "predicateType": release.PREDICATE_TYPES["cyclonedx"],
            "subject": [{"name": "image", "digest": {"sha256": "c" * 64}}],
            "predicate": json.loads(self.cdx.read_text(encoding="utf-8")),
        }
        with self.assertRaises(release.ReleaseEvidenceError):
            release.verify_statement_values(
                statement=statement,
                subject_digest=self.digest,
                predicate_type="cyclonedx",
                expected_predicate=json.loads(self.cdx.read_text(encoding="utf-8")),
            )


    def test_provenance_subject_mismatch_fails(self) -> None:
        provenance = {
            "buildDefinition": {"buildType": "https://example.invalid/workflow"},
            "runDetails": {"builder": {"id": "https://example.invalid/workflow"}},
        }
        statement = {
            "_type": "https://in-toto.io/Statement/v0.1",
            "predicateType": release.PREDICATE_TYPES["slsaprovenance1"],
            "subject": [{"name": "image", "digest": {"sha256": "c" * 64}}],
            "predicate": provenance,
        }
        with self.assertRaises(release.ReleaseEvidenceError):
            release.verify_statement_values(
                statement=statement,
                subject_digest=self.digest,
                predicate_type="slsaprovenance1",
                expected_predicate=provenance,
            )

    def test_attestation_predicate_mismatch_fails(self) -> None:
        statement = {
            "_type": "https://in-toto.io/Statement/v0.1",
            "predicateType": release.PREDICATE_TYPES["cyclonedx"],
            "subject": [{"name": "image", "digest": {"sha256": "a" * 64}}],
            "predicate": {"bomFormat": "CycloneDX", "components": []},
        }
        with self.assertRaises(release.ReleaseEvidenceError):
            release.verify_statement_values(
                statement=statement,
                subject_digest=self.digest,
                predicate_type="cyclonedx",
                expected_predicate=json.loads(self.cdx.read_text(encoding="utf-8")),
            )

    def test_unsigned_or_missing_statement_fails(self) -> None:
        with self.assertRaises(release.ReleaseEvidenceError):
            release.verify_statement_values(
                statement={},
                subject_digest=self.digest,
                predicate_type="cyclonedx",
                expected_predicate=json.loads(self.cdx.read_text(encoding="utf-8")),
            )

    def test_rego_policy_pins_subject_and_exact_predicate(self) -> None:
        predicate = json.loads(self.cdx.read_text(encoding="utf-8"))
        policy = release.build_rego_policy(
            subject_digest=self.digest,
            predicate_type="cyclonedx",
            predicate=predicate,
        )
        self.assertIn("a" * 64, policy)
        self.assertIn(release.PREDICATE_TYPES["cyclonedx"], policy)
        self.assertIn("input.predicate == expected_predicate", policy)

    def test_evidence_rejects_token_or_private_key_material(self) -> None:
        with self.assertRaises(release.ReleaseEvidenceError):
            release.scan_forbidden_evidence({"githubToken": "not-even-a-real-token"})
        with self.assertRaises(release.ReleaseEvidenceError):
            release.scan_forbidden_evidence(
                {"material": "-----BEGIN PRIVATE KEY-----\nredacted"}
            )

    def test_release_workflow_does_not_grant_oidc_to_pr_paths(self) -> None:
        workflow = (
            ROOT / ".github" / "workflows" / "release-supply-chain.yml"
        ).read_text(encoding="utf-8")
        self.assertNotIn("pull_request_target:", workflow)
        self.assertNotIn("pull_request:", workflow)
        sign_marker = "  sign-release-subject:\n"
        verify_marker = "  verify-release-subject:\n"
        promote_marker = "  promote-release-tag:\n"
        self.assertIn(sign_marker, workflow)
        self.assertIn(verify_marker, workflow)
        self.assertIn(promote_marker, workflow)
        sign_block = workflow.split(sign_marker, 1)[1].split(verify_marker, 1)[0]
        verify_block = workflow.split(verify_marker, 1)[1].split(promote_marker, 1)[0]
        publish_block = workflow.split("  publish-release-image:\n", 1)[1].split(
            sign_marker, 1
        )[0]
        promote_block = workflow.split(promote_marker, 1)[1]
        self.assertIn("id-token: write", sign_block)
        self.assertNotIn("id-token: write", publish_block)
        self.assertNotIn("id-token: write", verify_block)
        self.assertNotIn("id-token: write", promote_block)


if __name__ == "__main__":
    unittest.main()
