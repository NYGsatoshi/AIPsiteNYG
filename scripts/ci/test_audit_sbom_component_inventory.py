#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("audit_sbom_component_inventory.py")


class SbomComponentInventoryAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sbom = self.root / "sbom.cyclonedx.json"
        self.out = self.root / "component-inventory-warnings.json"

    def tearDown(self):
        self.temp.cleanup()

    def write_components(self, components):
        self.sbom.write_text(
            json.dumps(
                {
                    "bomFormat": "CycloneDX",
                    "specVersion": "1.6",
                    "components": components,
                }
            ),
            encoding="utf-8",
        )

    def run_audit(self):
        return subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--sbom",
                str(self.sbom),
                "--out",
                str(self.out),
            ],
            text=True,
            capture_output=True,
        )

    def report(self):
        return json.loads(self.out.read_text(encoding="utf-8"))

    def test_complete_package_identity_has_no_warning(self):
        self.write_components(
            [
                {
                    "type": "library",
                    "name": "demo-lib",
                    "version": "1.0.0",
                    "purl": "pkg:npm/demo-lib@1.0.0",
                }
            ]
        )
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.report()["warningCount"], 0)

    def test_package_like_component_without_version_is_visible(self):
        self.write_components(
            [
                {
                    "type": "library",
                    "name": "demo-lib",
                    "purl": "pkg:npm/demo-lib",
                }
            ]
        )
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        kinds = {item["kind"] for item in self.report()["warnings"]}
        self.assertIn("missing-version", kinds)

    def test_package_like_component_without_origin_is_visible(self):
        self.write_components(
            [{"type": "library", "name": "demo-lib", "version": "1.0.0"}]
        )
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        kinds = {item["kind"] for item in self.report()["warnings"]}
        self.assertIn("unknown-package-origin", kinds)

    def test_exact_duplicate_identity_is_visible(self):
        component = {
            "type": "library",
            "name": "demo-lib",
            "version": "1.0.0",
            "purl": "pkg:npm/demo-lib@1.0.0",
        }
        self.write_components([component, dict(component)])
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        warnings = self.report()["warnings"]
        duplicate = next(item for item in warnings if item["kind"] == "duplicate-component-identity")
        self.assertEqual(duplicate["occurrences"], 2)

    def test_same_name_version_with_multiple_origins_is_ambiguous(self):
        self.write_components(
            [
                {
                    "type": "library",
                    "name": "demo-lib",
                    "version": "1.0.0",
                    "purl": "pkg:npm/demo-lib@1.0.0",
                },
                {
                    "type": "library",
                    "name": "demo-lib",
                    "version": "1.0.0",
                    "purl": "pkg:generic/demo-lib@1.0.0",
                },
            ]
        )
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        kinds = {item["kind"] for item in self.report()["warnings"]}
        self.assertIn("ambiguous-component-identity", kinds)

    def test_malformed_component_fails_closed(self):
        self.write_components([{"type": "library", "version": "1.0.0"}])
        result = self.run_audit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no name", result.stderr)


if __name__ == "__main__":
    unittest.main()
