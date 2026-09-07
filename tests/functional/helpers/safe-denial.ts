import type { APIResponse } from '@playwright/test';

export interface SafeDenialOptions {
  label: string;
  expectedStatus: number | number[];
  forbiddenMarkers?: readonly string[];
  maxBodyBytes?: number;
}

const DEFAULT_INTERNAL_MARKERS = [
  'npgsql.',
  'microsoft.entityframeworkcore',
  'system.data.',
  'stacktrace',
  'storagekey',
  'storage_key',
  'connectionstrings__',
  'connection string',
  '/app/storage/',
  '/srv/',
  '/var/lib/postgresql',
] as const;

export async function assertSafeDenial(
  response: APIResponse,
  options: SafeDenialOptions,
): Promise<{ status: number; bodyBytes: number }> {
  const expected = Array.isArray(options.expectedStatus) ? options.expectedStatus : [options.expectedStatus];
  const status = response.status();
  if (!expected.includes(status)) {
    throw new Error(`${options.label} returned HTTP ${status}; expected ${expected.join(' or ')}.`);
  }

  const body = await boundedResponseBody(response, options.maxBodyBytes ?? 8192, options.label);
  const normalized = body.toLowerCase();
  const forbidden = [...DEFAULT_INTERNAL_MARKERS, ...(options.forbiddenMarkers ?? [])];

  for (const marker of forbidden) {
    if (marker && normalized.includes(marker.toLowerCase())) {
      throw new Error(`${options.label} disclosed a forbidden protected/internal marker.`);
    }
  }

  return { status, bodyBytes: Buffer.byteLength(body, 'utf8') };
}

async function boundedResponseBody(response: APIResponse, maxBytes: number, label: string): Promise<string> {
  const body = await response.body();
  if (body.byteLength > maxBytes) {
    throw new Error(`${label} returned an unexpectedly large denial body (${body.byteLength} bytes).`);
  }
  return body.toString('utf8');
}
