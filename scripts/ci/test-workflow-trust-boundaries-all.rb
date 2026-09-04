#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative 'test-workflow-trust-boundaries'

class WorkflowTrustBoundaryTests
  def test_privileged_dynamic_checkout_fails
    allow = [{
      'workflow' => '.github/workflows/invalid-privileged-dynamic-checkout.yml',
      'permissions' => ['contents:write'],
      'events' => ['workflow_dispatch'],
      'jobs' => ['mutate'],
      'reason' => 'negative fixture exercises privileged checkout ref boundary'
    }]
    result = validate('invalid-privileged-dynamic-checkout.yml', allowlist: allow)
    assert_includes messages(result), 'privileged checkout'
    assert_includes messages(result), 'arbitrary/dynamic ref expression'
  end
end
