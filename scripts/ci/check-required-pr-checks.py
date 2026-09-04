#!/usr/bin/env python3
"""GOV-06 required-check validator entry point."""
from required_check_contract import *  # noqa: F401,F403
from required_check_contract import run_cli

if __name__ == "__main__":
    raise SystemExit(run_cli())
