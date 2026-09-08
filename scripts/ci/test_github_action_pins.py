#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from github_action_pins import validate_repository


PIN = "a" * 40
OTHER_PIN = "b" * 40


class GithubActionPinsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".github/workflows").mkdir(parents=True)
        (self.root / "governance").mkdir(parents=True)
        self.policy = self.root / "governance/github-actions-allowlist.json"
        self.policy.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "requiredWorkflows": [".github/workflows/required.yml"],
                    "actions": {
                        "actions/checkout": {
                            "sha": PIN,
                            "version": "v7",
                            "purpose": "checkout",
                            "privilegedAllowed": True,
                        },
                        "owner/reusable": {
                            "sha": PIN,
                            "version": "v1",
                            "purpose": "reusable workflow fixture",
                            "privilegedAllowed": True,
                            "path": ".github/workflows/check.yml",
                        },
                        "vendor/unprivileged": {
                            "sha": PIN,
                            "version": "v2",
                            "purpose": "unprivileged fixture",
                            "privilegedAllowed": False,
                        },
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_workflow(self, name: str, body: str) -> None:
        (self.root / ".github/workflows" / name).write_text(body, encoding="utf-8")

    def errors(self) -> list[str]:
        errors, _ = validate_repository(self.root, self.policy)
        return errors

    def test_reviewed_full_sha_passes_required_workflow(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.assertEqual(self.errors(), [])

    def test_mutable_major_tag_fails_protected_workflow(self) -> None:
        self.write_workflow(
            "required.yml",
            """name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n""",
        )
        self.assertTrue(any("full immutable SHA" in error for error in self.errors()))

    def test_branch_ref_fails_protected_workflow(self) -> None:
        self.write_workflow(
            "required.yml",
            """name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main # v7\n""",
        )
        self.assertTrue(any("full immutable SHA" in error for error in self.errors()))

    def test_short_sha_fails_protected_workflow(self) -> None:
        self.write_workflow(
            "required.yml",
            """name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@123abc # v7\n""",
        )
        self.assertTrue(any("full immutable SHA" in error for error in self.errors()))

    def test_unreviewed_full_sha_fails(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{OTHER_PIN} # v7\n""",
        )
        self.assertTrue(any("does not match reviewed allowlist SHA" in error for error in self.errors()))

    def test_unknown_action_repository_fails_even_unprotected(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.write_workflow(
            "helper.yml",
            """name: helper\non: workflow_dispatch\njobs:\n  helper:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: unknown/example@v1\n""",
        )
        self.assertTrue(any("is not allowlisted" in error for error in self.errors()))

    def test_missing_version_comment_fails_protected_workflow(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN}\n""",
        )
        self.assertTrue(any("requires version comment" in error for error in self.errors()))

    def test_local_action_does_not_require_allowlist_entry(self) -> None:
        self.write_workflow(
            "required.yml",
            """name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/local-check\n""",
        )
        self.assertEqual(self.errors(), [])

    def test_external_reusable_workflow_is_pinned(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  reusable:\n    uses: owner/reusable/.github/workflows/check.yml@{PIN} # v1\n""",
        )
        self.assertEqual(self.errors(), [])

    def test_reusable_workflow_path_must_match_allowlist(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  reusable:\n    uses: owner/reusable/.github/workflows/other.yml@{PIN} # v1\n""",
        )
        self.assertTrue(
            any("does not match reviewed allowlist path" in error for error in self.errors())
        )

    def test_secret_bearing_workflow_is_automatically_protected(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.write_workflow(
            "secret.yml",
            """name: secret\non: workflow_dispatch\njobs:\n  privileged:\n    runs-on: ubuntu-latest\n    environment: protected\n    env:\n      TOKEN: ${{ secrets.TEST_TOKEN }}\n    steps:\n      - uses: actions/checkout@v7\n""",
        )
        self.assertTrue(any("secret.yml" in error and "full immutable SHA" in error for error in self.errors()))

    def test_write_permission_workflow_is_automatically_protected(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.write_workflow(
            "write.yml",
            """name: write\non: workflow_dispatch\npermissions:\n  contents: write\njobs:\n  write:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n""",
        )
        self.assertTrue(any("write.yml" in error and "full immutable SHA" in error for error in self.errors()))

    def test_unprivileged_allowlisted_action_may_stay_mutable_outside_protected_scope(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.write_workflow(
            "helper.yml",
            """name: helper\non: workflow_dispatch\npermissions:\n  contents: read\njobs:\n  helper:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: vendor/unprivileged@v2\n""",
        )
        self.assertEqual(self.errors(), [])

    def test_unprivileged_action_is_rejected_if_workflow_becomes_protected(self) -> None:
        self.write_workflow(
            "required.yml",
            f"""name: required\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@{PIN} # v7\n""",
        )
        self.write_workflow(
            "helper.yml",
            f"""name: helper\non: workflow_dispatch\npermissions:\n  contents: write\njobs:\n  helper:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: vendor/unprivileged@{PIN} # v2\n""",
        )
        self.assertTrue(any("not approved for protected workflows" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
