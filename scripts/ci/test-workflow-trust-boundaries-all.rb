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

  def test_privileged_broad_write_fails_when_scope_is_not_allowlisted
    allow = [{
      'workflow' => '.github/workflows/invalid-privileged-broad-write.yml',
      'permissions' => ['contents:write'],
      'events' => ['workflow_dispatch'],
      'jobs' => ['mutate'],
      'reason' => 'negative fixture allows only the narrow write scope actually justified'
    }]
    result = validate('invalid-privileged-broad-write.yml', allowlist: allow)
    assert_includes messages(result), 'unallowlisted write permissions: issues:write'
    assert_includes messages(result), CONTROL_PERMISSION
  end

  def test_privileged_self_hosted_runner_fails
    allow = [{
      'workflow' => '.github/workflows/invalid-privileged-self-hosted.yml',
      'permissions' => ['contents:write'],
      'events' => ['workflow_dispatch'],
      'jobs' => ['mutate'],
      'reason' => 'negative fixture isolates privileged runner routing policy'
    }]
    result = validate('invalid-privileged-self-hosted.yml', allowlist: allow)
    assert_includes messages(result), 'must not use a self-hosted runner'
    assert_includes messages(result), CONTROL_RUNNER
  end

  def test_unknown_event_fails_closed
    result = validate('invalid-unclassified-event.yml')
    assert_includes messages(result), 'has no GOV-04 trust classification'
    assert_includes messages(result), CONTROL_TRUST
  end
end
