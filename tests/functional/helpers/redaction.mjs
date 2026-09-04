const SENSITIVE_KEY_PATTERN =
  /authorization|proxy.?authorization|cookie|set-cookie|password|passwd|secret|token|csrf|license|credential|signature|access.?key|private.?key|connection.?string|storage.?key|api.?key/i;

const SENSITIVE_ASSIGNMENT_NAME =
  '(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|api[_-]?key|storage[_-]?key|sig|signature|credential|awsaccesskeyid|googleaccessid|x-amz-credential|x-amz-signature|x-amz-security-token|x-goog-credential|x-goog-signature)';

const STRING_REDACTIONS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]'],
  [/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/giu, '$1: [REDACTED]'],
  [/\/\/[^/\s:@]+:[^@\s/]+@/gu, '//[REDACTED]@'],
  [new RegExp(`\\b(${SENSITIVE_ASSIGNMENT_NAME})\\s*[:=]\\s*[^&;\\s]+`, 'giu'), '$1=[REDACTED]'],
  [new RegExp(`([?&#](?:${SENSITIVE_ASSIGNMENT_NAME})=)[^&#\\s]+`, 'giu'), '$1[REDACTED]']
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
