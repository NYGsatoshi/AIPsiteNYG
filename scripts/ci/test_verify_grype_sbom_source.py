#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_grype_sbom_source.py")


class GrypeSbomSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sbom = self.root / "sbom.cyclonedx.json"
        self.report = self.root / "grype.json"
        self.image_name = "sha256"
        self.image_id = "4700d46abad8d47e"
        self.manifest_digest = "214aa06a9c0be037932f65073b784153c0f1cb4f1144da932a273cd9c3e59185"
        self.write_sbom()
        self.write_report("sbom-file", str(self.sbom))

    def tearDown(self):
        self.temp.cleanup()

    def write_sbom(self, *, component: object | None = None):
        if component is None:
            component = {
                "bom-ref": self.image_id,
                "type": "container",
                "name": self.image_name,
                "version": self.manifest_digest,
            }
        self.sbom.write_text(
            json.dumps(
                {
                    "bomFormat": "CycloneDX",
                    "specVersion": "1.6",
                    "metadata": {"component": component},
                    "components": [{}],
                }
            ),
            encoding="utf-8",
        )

    def write_report(self, source_type, target):
        self.report.write_text(
            json.dumps(
                {
                    "matches": [],
                    "source": {"type": source_type, "target": target},
                    "descriptor": {"name": "grype", "version": "0.118.0"},
                }
            ),
            encoding="utf-8",
        )

    def write_reconstructed_image_report(self, **overrides):
        target = {
            "userInput": self.image_name,
            "imageID": self.image_id,
            "manifestDigest": self.manifest_digest,
        }
        target.update(overrides)
        self.write_report("image", target)

    def run_verify(self):
        return subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--report",
                str(self.report),
                "--sbom",
                str(self.sbom),
            ],
            text=True,
            capture_output=True,
        )

    def test_exact_sbom_file_source_passes(self):
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reconstructed_image_source_matching_sbom_root_passes(self):
        self.write_reconstructed_image_report()
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_different_sbom_target_fails(self):
        other = self.root / "other.json"
        other.write_text("{}", encoding="utf-8")
        self.write_report("sbom-file", str(other))
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source mismatch", result.stderr)

    def test_unrelated_image_source_fails(self):
        self.write_reconstructed_image_report(imageID="different-image")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root identity", result.stderr)

    def test_manifest_digest_mismatch_fails(self):
        self.write_reconstructed_image_report(manifestDigest="different-manifest")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root identity", result.stderr)

    def test_image_source_requires_complete_container_root_identity(self):
        self.write_sbom(component={"type": "container", "name": self.image_name})
        self.write_reconstructed_image_report()
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root identity is incomplete", result.stderr)

    def test_missing_source_metadata_fails(self):
        self.report.write_text(json.dumps({"matches": []}), encoding="utf-8")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source metadata", result.stderr)

    def test_unsupported_source_type_fails(self):
        self.write_report("directory", str(self.root))
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supported canonical SBOM source shape", result.stderr)


if __name__ == "__main__":
    unittest.main()
