#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf '%s\n' "Usage: $0 <trx-file> [--minimum-total N] [--required-tests FILE] [--label LABEL]" >&2
}

usage_error() {
  printf '%s\n' "$1" >&2
  usage
  exit 2
}

if [[ "$#" -lt 1 ]]; then
  usage
  exit 2
fi

trx_file="$1"
shift
minimum_total=0
required_tests_file=""
label="$trx_file"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --minimum-total)
      [[ "$#" -ge 2 ]] || usage_error "Missing value for --minimum-total."
      minimum_total="$2"
      shift 2
      ;;
    --required-tests)
      [[ "$#" -ge 2 ]] || usage_error "Missing value for --required-tests."
      required_tests_file="$2"
      shift 2
      ;;
    --label)
      [[ "$#" -ge 2 ]] || usage_error "Missing value for --label."
      label="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage_error "Unknown argument: $1"
      ;;
  esac
done

if [[ ! "$minimum_total" =~ ^[0-9]+$ ]]; then
  usage_error "--minimum-total must be a non-negative integer."
fi

extract_attribute() {
  local tag="$1"
  local attribute_name="$2"

  printf '%s\n' "$tag" | awk -v attribute_name="$attribute_name" '
    {
      pattern = attribute_name "[[:space:]]*=[[:space:]]*\"[^\"]*\""
      if (match($0, pattern)) {
        value = substr($0, RSTART, RLENGTH)
        sub("^[^\"]*\"", "", value)
        sub("\"$", "", value)
        print value
        exit
      }
    }
  '
}

extract_counters_tag() {
  awk '
    BEGIN {
      capturing = 0
      tag = ""
    }

    {
      if (!capturing && $0 ~ /<Counters([[:space:]]|>|\/)/) {
        capturing = 1
      }

      if (capturing) {
        tag = tag $0 "\n"
        if (index($0, ">")) {
          print tag
          exit
        }
      }
    }
  ' "$trx_file"
}

extract_executed_test_names() {
  awk '
    function test_name_from_tag(tag, pattern, value) {
      pattern = "testName[[:space:]]*=[[:space:]]*\"[^\"]*\""
      if (match(tag, pattern)) {
        value = substr(tag, RSTART, RLENGTH)
        sub("^[^\"]*\"", "", value)
        sub("\"$", "", value)
        return value
      }

      return ""
    }

    BEGIN {
      capturing = 0
      tag = ""
    }

    {
      if (!capturing) {
        start = index($0, "<UnitTestResult")
        if (start == 0) {
          next
        }

        capturing = 1
        tag = substr($0, start) "\n"
      } else {
        tag = tag $0 "\n"
      }

      if (capturing && index(tag, ">")) {
        test_name = test_name_from_tag(tag)
        if (test_name != "") {
          print test_name
        }

        capturing = 0
        tag = ""
      }
    }
  ' "$trx_file"
}

errors=()
missing_tests=()
required_test_count=0
total="N/A"
executed="N/A"
passed="N/A"
failed="N/A"
not_executed="N/A"

write_summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '### TRX verification: %s\n\n' "$label"
      printf '%s\n' "- TRX path: \`$trx_file\`"
      printf '%s\n' "- total: $total"
      printf '%s\n' "- executed: $executed"
      printf '%s\n' "- passed: $passed"
      printf '%s\n' "- failed: $failed"
      printf '%s\n' "- notExecuted: $not_executed"
      printf '%s\n' "- required test count: $required_test_count"
      printf '%s\n' "- missing required test count: ${#missing_tests[@]}"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [[ ! -f "$trx_file" ]]; then
  errors+=("TRX file does not exist: $trx_file")
else
  counters_tag="$(extract_counters_tag)"
  if [[ -z "$counters_tag" ]]; then
    errors+=("TRX Counters element is missing: $trx_file")
  else
    counter_names=(
      total
      executed
      passed
      failed
      error
      timeout
      aborted
      inconclusive
      notRunnable
      notExecuted
      disconnected
      warning
      completed
      inProgress
      pending
      passedButRunAborted
    )

    declare -A counters=()
    for counter_name in "${counter_names[@]}"; do
      counter_value="$(extract_attribute "$counters_tag" "$counter_name")"
      if [[ -z "$counter_value" ]]; then
        errors+=("TRX Counters attribute is missing: $counter_name")
      elif [[ ! "$counter_value" =~ ^[0-9]+$ ]]; then
        errors+=("TRX Counters attribute is not a non-negative integer: $counter_name=$counter_value")
      else
        counters["$counter_name"]="$counter_value"
      fi
    done

    total="${counters[total]:-N/A}"
    executed="${counters[executed]:-N/A}"
    passed="${counters[passed]:-N/A}"
    failed="${counters[failed]:-N/A}"
    not_executed="${counters[notExecuted]:-N/A}"

    if [[ "${#errors[@]}" -eq 0 ]]; then
      if (( 10#${counters[total]} < 10#$minimum_total )); then
        errors+=("TRX total is below the required minimum: ${counters[total]} < $minimum_total")
      fi

      if (( 10#${counters[executed]} != 10#${counters[total]} )); then
        errors+=("TRX executed does not equal total: ${counters[executed]} != ${counters[total]}")
      fi

      if (( 10#${counters[passed]} != 10#${counters[total]} )); then
        errors+=("TRX passed does not equal total: ${counters[passed]} != ${counters[total]}")
      fi

      non_zero_failures=(
        failed
        error
        timeout
        aborted
        inconclusive
        notRunnable
        notExecuted
        disconnected
        warning
        completed
        inProgress
        pending
        passedButRunAborted
      )
      for counter_name in "${non_zero_failures[@]}"; do
        if (( 10#${counters[$counter_name]} > 0 )); then
          errors+=("TRX $counter_name is non-zero: ${counters[$counter_name]}")
        fi
      done
    fi
  fi

  if [[ -n "$required_tests_file" ]]; then
    if [[ ! -f "$required_tests_file" ]]; then
      errors+=("Required test manifest does not exist: $required_tests_file")
    else
      executed_test_names="$(extract_executed_test_names)"
      while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
        required_test_name="$(printf '%s' "$manifest_line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        if [[ -z "$required_test_name" || "$required_test_name" == \#* ]]; then
          continue
        fi

        required_test_count=$((required_test_count + 1))
        if ! printf '%s\n' "$executed_test_names" | grep -F -- "$required_test_name" >/dev/null; then
          missing_tests+=("$required_test_name")
        fi
      done < "$required_tests_file"

      if [[ "$required_test_count" -eq 0 ]]; then
        errors+=("Required test manifest contains no active test names.")
      fi

      if [[ "${#missing_tests[@]}" -gt 0 ]]; then
        errors+=("One or more required tests were not present in executed TRX testName values.")
      fi
    fi
  fi
fi

write_summary

if [[ "${#missing_tests[@]}" -gt 0 ]]; then
  printf '%s\n' "Missing required executed test names:" >&2
  printf '  %s\n' "${missing_tests[@]}" >&2
fi

if [[ "${#errors[@]}" -gt 0 ]]; then
  printf '%s\n' "TRX verification failed for $label:" >&2
  printf '  %s\n' "${errors[@]}" >&2
  exit 1
fi

printf '%s\n' "TRX verification passed for $label."
