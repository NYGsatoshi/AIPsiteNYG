#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative 'workflow-trust-boundaries-lib'

class WorkflowTrustValidator
  private

  # `pull_request` is already an untrusted, read-only execution lane. Checking
  # out its explicit head SHA is valid when credentials are not persisted.
  # Arbitrary ref expressions become a trust-boundary violation only when the
  # job is privileged (write token, secret, or protected environment).
  def validate_checkout_steps(path, job_id, job, untrusted:, workflow_run:)
    steps = job['steps']
    return unless steps&.seq?

    permissions = job['permissions'] || @documents[path]['permissions']
    writes = write_permissions(permissions)
    privileged = !writes.empty? || !secret_nodes(job).empty? || !job['environment'].nil?

    steps.value.each do |step|
      next unless step.map?
      uses = step['uses']
      next unless uses&.scalar? && uses.scalar.to_s.match?(%r{\Aactions/checkout@}i)

      with = step['with']
      persist = with&.map? ? with['persist-credentials'] : nil
      if untrusted && !(persist&.scalar? && persist.scalar.to_s.casecmp('false').zero?)
        add(
          CONTROL_PERMISSION,
          path,
          persist&.line || uses.line,
          "untrusted checkout in job #{job_id} must set persist-credentials: false"
        )
      end

      ref = with&.map? ? with['ref'] : nil
      if privileged && ref&.scalar?
        value = ref.scalar.to_s
        if value.match?(DYNAMIC_EXPR) && value.strip != '${{ github.sha }}'
          add(
            CONTROL_TRUST,
            path,
            ref.line,
            "privileged checkout in job #{job_id} uses an arbitrary/dynamic ref expression"
          )
        end
      end

      if workflow_run && privileged && ref&.scalar? && ref.scalar.to_s.match?(WORKFLOW_RUN_HEAD_EXPR)
        add(
          CONTROL_TRUST,
          path,
          ref.line,
          "privileged workflow_run checkout in job #{job_id} must not checkout triggering head SHA/ref"
        )
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  validator = WorkflowTrustValidator.new(ARGV[0] ? Pathname.new(ARGV[0]) : ROOT)
  findings = validator.validate
  if findings.empty?
    puts 'Workflow trust-boundary validation passed: explicit permissions, write allowlist, untrusted PR, checkout, secret/environment, runner, workflow_run, and reusable-workflow boundaries verified.'
    exit 0
  end

  warn 'Workflow trust-boundary validation failed:'
  findings.each { |finding| warn "- #{finding}" }
  exit 1
end
