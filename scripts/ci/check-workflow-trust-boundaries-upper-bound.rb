#!/usr/bin/env ruby
# frozen_string_literal: true

# Single-maintainer security layer for the workflow trust validator.
#
# The trust registry is intentionally self-contained and does not depend on the
# retired live Governance merge-gate policy. Write-permission allowlists are
# maximum permitted scopes: removing a write permission is a security tightening;
# adding or expanding a write permission remains blocking.
require_relative 'check-workflow-trust-boundaries'

class WorkflowTrustValidator
  private

  def load_policy
    registry = JSON.parse(root.join(TRUST_REGISTRY_PATH).read(encoding: 'UTF-8'))
    unless registry['schema_version'] == 2
      raise JSON::ParserError, "#{TRUST_REGISTRY_PATH} schema_version must be 2"
    end

    constraints = registry['constraints']
    unless constraints.is_a?(Hash) &&
           constraints['persist_credentials'] == false &&
           constraints['pull_request_target'] == 'forbidden' &&
           constraints['untrusted_pr_self_hosted'] == 'forbidden' &&
           constraints['persistent_privileged_self_hosted'] == 'forbidden'
      raise JSON::ParserError, "#{TRUST_REGISTRY_PATH} security constraints are incomplete or weakened"
    end

    writes = registry['write_permissions']
    unless writes.is_a?(Array)
      raise JSON::ParserError, "#{TRUST_REGISTRY_PATH} write_permissions must be an array"
    end

    canonical_writes = writes.map do |entry|
      unless entry.is_a?(Hash) && entry['workflow'].is_a?(String) && entry['permissions'].is_a?(Array)
        raise JSON::ParserError, "#{TRUST_REGISTRY_PATH} write_permissions entries are malformed"
      end
      {
        'workflow' => entry['workflow'],
        'permissions' => entry['permissions']
      }
    end

    {
      'controls' => [
        {
          'id' => CONTROL_PERMISSION,
          'expected' => {
            'persist_credentials' => constraints['persist_credentials'],
            'write_permissions_allowlist' => canonical_writes
          }
        },
        {
          'id' => CONTROL_TRUST,
          'expected' => {
            'pull_request_target' => constraints['pull_request_target']
          }
        },
        {
          'id' => CONTROL_RUNNER,
          'expected' => {
            'untrusted_pr' => constraints['untrusted_pr_self_hosted'],
            'persistent_privileged' => constraints['persistent_privileged_self_hosted']
          }
        }
      ]
    }
  end

  def validate_write_allowlist(path, job_id, writes, events, node)
    return if writes.empty?

    entry = @allowlist.find { |candidate| candidate['workflow'] == path && candidate['jobs'].include?(job_id) }
    if entry.nil?
      add(
        CONTROL_PERMISSION,
        path,
        node.line,
        "job #{job_id} has write permissions #{writes.to_a.sort.join(', ')} but is not allowlisted"
      )
      return
    end

    allowed = Set.new(entry['permissions'])
    extra = writes - allowed
    unless extra.empty?
      add(
        CONTROL_PERMISSION,
        path,
        node.line,
        "job #{job_id} has unallowlisted write permissions: #{extra.to_a.sort.join(', ')}"
      )
    end

    allowed_events = Set.new(entry['events'])
    unexpected_events = events - allowed_events
    unless unexpected_events.empty?
      add(
        CONTROL_PERMISSION,
        path,
        node.line,
        "write-capable job #{job_id} is reachable from events not in policy scope: #{unexpected_events.to_a.sort.join(', ')}"
      )
    end
  end

  def validate_allowlist_usage
    @allowlist.each do |entry|
      path = entry['workflow']
      doc = @documents[path]
      if doc.nil?
        add(CONTROL_PERMISSION, path, 1, 'write-permission allowlist references a missing workflow')
        next
      end

      jobs = doc['jobs']
      next unless jobs&.map?

      entry['jobs'].each do |job_id|
        job = jobs[job_id]
        if job.nil?
          add(
            CONTROL_PERMISSION,
            path,
            jobs.line,
            "write-permission allowlist references missing job #{job_id.inspect}"
          )
          next
        end

        writes = write_permissions(job['permissions'] || doc['permissions'])
        allowed = Set.new(entry['permissions'])
        extra = writes - allowed
        unless extra.empty?
          add(
            CONTROL_PERMISSION,
            path,
            job.line,
            "write-permission allowlist for job #{job_id} is exceeded by: #{extra.to_a.sort.join(', ')}"
          )
        end
        # Missing/removed writes are intentionally accepted: the allowlist is an
        # upper bound and write-scope reduction is security tightening.
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  validator = WorkflowTrustValidator.new(ARGV[0] ? Pathname.new(ARGV[0]) : ROOT)
  findings = validator.validate
  if findings.empty?
    puts 'Workflow trust-boundary validation passed: self-contained security constraints and write-permission upper bounds are intact.'
    exit 0
  end

  warn 'Workflow trust-boundary validation failed:'
  findings.each { |finding| warn "- #{finding}" }
  exit 1
end
