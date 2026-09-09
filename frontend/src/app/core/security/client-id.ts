let localSequence = 0;

/**
 * Generates an opaque UUID from Web Crypto only. Security-sensitive callers
 * (for example idempotency keys) must fail closed rather than silently falling
 * back to predictable pseudo-randomness.
 */
export function createCryptographicUuid(): string {
  const uuid = tryCreateCryptographicUuid();
  if (!uuid) {
    throw new Error('Web Crypto is required to generate a security-sensitive client identifier.');
  }
  return uuid;
}

/**
 * Generates a browser-local presentation identifier. These IDs are not
 * capabilities, secrets, or idempotency tokens, so a timestamp + monotonic
 * sequence is an acceptable last-resort uniqueness fallback when Web Crypto is
 * unavailable (for example in constrained test environments).
 */
export function createLocalOpaqueId(prefix: string): string {
  const uuid = tryCreateCryptographicUuid();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }

  localSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${localSequence.toString(36)}`;
}

function tryCreateCryptographicUuid(): string | null {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    return null;
  }
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi.getRandomValues !== 'function') {
    return null;
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
