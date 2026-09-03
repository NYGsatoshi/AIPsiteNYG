#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check-publication-readiness.py")
SPEC = importlib.util.spec_from_file_location("publication_guard", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load publication-readiness guard")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class WorkflowParserTests(unittest.TestCase):
    def test_block_pull_request_trigger(self) -> None:
        text = """
name: test
on:
  push:
  pull_request:
jobs: {}
"""
        self.assertTrue(guard.workflow_triggers(text, "pull_request"))

    def test_inline_trigger(self) -> None:
        self.assertTrue(
            guard.workflow_triggers("on: [push, pull_request]\njobs: {}\n", "pull_request")
        )

    def test_manual_only_secret_requires_environment(self) -> None:
        text = """
on:
  workflow_dispatch:
jobs:
  licensed:
    runs-on: ubuntu-latest
    environment: licensed
    env:
      VALUE: ${{ secrets.VALUE }}
"""
        self.assertEqual(
            [],
            guard.workflow_errors(
                guard.ROOT / ".github" / "workflows" / "test.yml", text
            ),
        )

    def test_pull_request_secret_is_rejected(self) -> None:
        text = """
on:
  pull_request:
jobs:
  unsafe:
    runs-on: ubuntu-latest
    environment: licensed
    env:
      VALUE: ${{ secrets.VALUE }}
"""
        errors = guard.workflow_errors(
            guard.ROOT / ".github" / "workflows" / "test.yml", text
        )
        self.assertTrue(
            any("pull-request workflow references a secret" in e for e in errors)
        )

    def test_self_hosted_is_rejected(self) -> None:
        text = """
on:
  workflow_dispatch:
jobs:
  unsafe:
    runs-on: [self-hosted, linux]
"""
        errors = guard.workflow_errors(
            guard.ROOT / ".github" / "workflows" / "test.yml", text
        )
        self.assertTrue(any("self-hosted" in e for e in errors))

    def test_pull_request_target_is_rejected(self) -> None:
        text = """
on:
  pull_request_target:
jobs:
  unsafe:
    runs-on: ubuntu-latest
"""
        errors = guard.workflow_errors(
            guard.ROOT / ".github" / "workflows" / "test.yml", text
        )
        self.assertTrue(any("pull_request_target" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
