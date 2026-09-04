const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|set-cookie|password|passwd|secret|token|csrf|license|connection.?string|storage.?key|api.?key/i;

const STRING_REDACTIONS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]'],
  [/\b(password|passwd|pwd)\s*=\s*[^;\s]+/giu, '$1=[REDACTED]'],
  [/\b(token|secret|api[_-]?key|storage[_-]?key)\s*=\s*[^&;\s]+/giu, '$1=[REDACTED]'],
  [/([?&](?:token|secret|api[_-]?key|storage[_-]?key)=)[^&#\s]+/giu, '$1[REDACTED]']
];

export function redactForArtifact(value) {
  return redact(value, new WeakSet());
}

export function redactText(value) {
  let output = String(value);
  for (const [pattern, replacement] of STRING_REDACTIONS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function boundedArtifactJson(value, maxLength = 4096) {
  const normalizedMax = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 4096;
  const serialized = JSON.stringify(redactForArtifact(value), null, 2);
  if (serialized.length <= normalizedMax) {
    return serialized;
  }
  return `${serialized.slice(0, normalizedMax)}\n…[TRUNCATED]`;
}

function redact(value, seen) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, seen));
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(entry, seen);
  }
  return output;
}
