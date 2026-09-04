#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative 'test-workflow-trust-boundaries-all'
require_relative 'check-workflow-trust-boundaries-upper-bound'

class WorkflowTrustBoundaryTests
  def test_allowlisted_write_permission_may_be_removed
    allow = [{
      'workflow' => '.github/workflows/valid-retired-write-lane.yml',
      'permissions' => ['statuses:write'],
      'events' => ['workflow_run', 'workflow_dispatch'],
      'jobs' => ['evaluate'],
      'reason' => 'compatibility entry retained while the privileged status publisher is retired'
    }]

    assert_empty validate('valid-retired-write-lane.yml', allowlist: allow)
  end
end
