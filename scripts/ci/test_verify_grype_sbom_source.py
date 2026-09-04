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
        self.sbom.write_text(
            json.dumps({"bomFormat": "CycloneDX", "specVersion": "1.6", "components": [{}]}),
            encoding="utf-8",
        )
        self.write_report("sbom-file", str(self.sbom))

    def tearDown(self):
        self.temp.cleanup()

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

    def test_non_sbom_source_fails(self):
        self.write_report("image", {"imageID": "sha256:" + "a" * 64})
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical SBOM", result.stderr)

    def test_different_sbom_target_fails(self):
        other = self.root / "other.json"
        other.write_text("{}", encoding="utf-8")
        self.write_report("sbom-file", str(other))
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source mismatch", result.stderr)

    def test_missing_source_metadata_fails(self):
        self.report.write_text(json.dumps({"matches": []}), encoding="utf-8")
        result = self.run_verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source metadata", result.stderr)


if __name__ == "__main__":
    unittest.main()
