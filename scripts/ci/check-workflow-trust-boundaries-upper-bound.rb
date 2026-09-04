#!/usr/bin/env ruby
# frozen_string_literal: true

# Single-maintainer compatibility layer for the GOV-04 workflow trust validator.
#
# Write-permission allowlists are maximum permitted scopes, not requirements that
# a workflow must continue to exercise. Removing a previously allowed write is a
# security tightening and must not fail CI. Any newly added/unallowlisted write
# remains a blocking violation.
require_relative 'check-workflow-trust-boundaries'

class WorkflowTrustValidator
  private

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
        # upper bound. This covers retired privileged lanes without weakening the
        # check for write-scope expansion.
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  validator = WorkflowTrustValidator.new(ARGV[0] ? Pathname.new(ARGV[0]) : ROOT)
  findings = validator.validate
  if findings.empty?
    puts 'Workflow trust-boundary validation passed: write permissions remain within allowlisted upper bounds and untrusted workflow boundaries are intact.'
    exit 0
  end

  warn 'Workflow trust-boundary validation failed:'
  findings.each { |finding| warn "- #{finding}" }
  exit 1
end
