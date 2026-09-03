# Continuous integration

GitHub Actions workflows under `.github/workflows/` are the canonical continuous-integration system for this repository.

The former Azure Pipelines definitions (`azure-pipelines.yml` and `azure-pipelines-wpc02d.yml`) were retired and removed. Repository builds, tests, security checks, migration checks, and browser acceptance gates must not depend on an Azure DevOps service connection or Azure Pipelines execution.

Browser acceptance mocks must track the canonical server command routes. When a feature moves from a legacy direct command to a durable workflow, Playwright must exercise the durable create and transition endpoints rather than preserving the obsolete route in its fixture.

A pull request is ready to merge only after the applicable GitHub Actions checks have completed successfully on its current head commit.
