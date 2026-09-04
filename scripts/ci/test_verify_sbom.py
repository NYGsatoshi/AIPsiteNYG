#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_sbom.py")
REPO_SHA = "a" * 40
IMAGE_DIGEST = "sha256:" + "b" * 64


def cdx(components):
    return {"bomFormat": "CycloneDX", "specVersion": "1.6", "components": components}


def spdx(packages):
    return {
        "spdxVersion": "SPDX-2.3",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": "test",
        "documentNamespace": "https://example.invalid/test",
        "packages": packages,
    }


class VerifySbomTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_pair(self, cdx_doc, spdx_doc, prefix=""):
        cdx_path = self.root / f"{prefix}sbom.cyclonedx.json"
        spdx_path = self.root / f"{prefix}sbom.spdx.json"
        cdx_path.write_text(json.dumps(cdx_doc), encoding="utf-8")
        spdx_path.write_text(json.dumps(spdx_doc), encoding="utf-8")
        return cdx_path, spdx_path

    def run_validate(self, cdx_path, spdx_path, *, kind="source", forbidden=None, prefix=""):
        metadata = self.root / f"{prefix}metadata.json"
        normalized = self.root / f"{prefix}normalized.json"
        cmd = [
            "python3", str(SCRIPT), "validate",
            "--cyclonedx", str(cdx_path),
            "--spdx", str(spdx_path),
            "--kind", kind,
            "--repository-sha", REPO_SHA,
            "--run-identity", "unit-test/1/1",
            "--syft-version", "1.51.0",
            "--metadata-out", str(metadata),
            "--normalized-out", str(normalized),
            "--require-package", "@angular/core",
            "--require-package", "Microsoft.EntityFrameworkCore",
        ]
        if kind == "image":
            cmd += ["--identity-digest", IMAGE_DIGEST]
        if forbidden:
            cmd += ["--forbid-value", forbidden]
        result = subprocess.run(cmd, text=True, capture_output=True)
        return result, metadata, normalized

    def valid_documents(self, reverse=False):
        cdx_components = [
            {"type": "library", "name": "@angular/core", "version": "21.2.19", "purl": "pkg:npm/%40angular/core@21.2.19"},
            {"type": "library", "name": "Microsoft.EntityFrameworkCore", "version": "10.0.11", "purl": "pkg:nuget/Microsoft.EntityFrameworkCore@10.0.11"},
            {"type": "library", "name": "@angular/core", "version": "21.2.19", "purl": "pkg:npm/%40angular/core@21.2.19"},
        ]
        spdx_packages = [
            {"name": "@angular/core", "versionInfo": "21.2.19", "externalRefs": [{"referenceType": "purl", "referenceLocator": "pkg:npm/%40angular/core@21.2.19"}]},
            {"name": "Microsoft.EntityFrameworkCore", "versionInfo": "10.0.11", "externalRefs": [{"referenceType": "purl", "referenceLocator": "pkg:nuget/Microsoft.EntityFrameworkCore@10.0.11"}]},
            {"name": "@angular/core", "versionInfo": "21.2.19", "externalRefs": [{"referenceType": "purl", "referenceLocator": "pkg:npm/%40angular/core@21.2.19"}]},
        ]
        if reverse:
            cdx_components.reverse()
            spdx_packages.reverse()
        return cdx(cdx_components), spdx(spdx_packages)

    def test_valid_sbom_records_and_reverifies_hashes(self):
        cdx_path, spdx_path = self.write_pair(*self.valid_documents())
        result, metadata, _ = self.run_validate(cdx_path, spdx_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        verify = subprocess.run(
            ["python3", str(SCRIPT), "verify-hashes", "--metadata", str(metadata)],
            text=True, capture_output=True,
        )
        self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_empty_component_set_fails(self):
        cdx_path, spdx_path = self.write_pair(cdx([]), spdx([]))
        result, _, _ = self.run_validate(cdx_path, spdx_path)
        self.assertNotEqual(result.returncode, 0)

    def test_malformed_json_fails(self):
        cdx_path, spdx_path = self.write_pair(*self.valid_documents())
        cdx_path.write_text("{", encoding="utf-8")
        result, _, _ = self.run_validate(cdx_path, spdx_path)
        self.assertNotEqual(result.returncode, 0)

    def test_forbidden_secret_value_fails(self):
        marker = "SEC09_FAKE_SECRET_12345"
        cdx_doc, spdx_doc = self.valid_documents()
        cdx_doc["metadata"] = {"properties": [{"name": "bad", "value": marker}]}
        cdx_path, spdx_path = self.write_pair(cdx_doc, spdx_doc)
        result, _, _ = self.run_validate(cdx_path, spdx_path, forbidden=marker)
        self.assertNotEqual(result.returncode, 0)

    def test_hash_tampering_fails_reverification(self):
        cdx_path, spdx_path = self.write_pair(*self.valid_documents())
        result, metadata, _ = self.run_validate(cdx_path, spdx_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        cdx_path.write_text(cdx_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        verify = subprocess.run(
            ["python3", str(SCRIPT), "verify-hashes", "--metadata", str(metadata)],
            text=True, capture_output=True,
        )
        self.assertNotEqual(verify.returncode, 0)

    def test_normalized_projection_is_order_stable_with_duplicates(self):
        first_cdx, first_spdx = self.write_pair(*self.valid_documents(), prefix="first-")
        second_cdx, second_spdx = self.write_pair(*self.valid_documents(reverse=True), prefix="second-")
        first, _, first_norm = self.run_validate(first_cdx, first_spdx, prefix="first-")
        second, _, second_norm = self.run_validate(second_cdx, second_spdx, prefix="second-")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first_norm.read_bytes(), second_norm.read_bytes())

    def test_image_requires_immutable_digest(self):
        cdx_path, spdx_path = self.write_pair(*self.valid_documents())
        metadata = self.root / "metadata.json"
        normalized = self.root / "normalized.json"
        result = subprocess.run([
            "python3", str(SCRIPT), "validate",
            "--cyclonedx", str(cdx_path), "--spdx", str(spdx_path),
            "--kind", "image", "--repository-sha", REPO_SHA,
            "--run-identity", "unit-test/1/1", "--syft-version", "1.51.0",
            "--metadata-out", str(metadata), "--normalized-out", str(normalized),
        ], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
