import type { APIResponse } from '@playwright/test';

import { boundedArtifactJson, redactText } from './redaction.mjs';

export interface SafeResponseOptions {
  label: string;
  expectedStatus: number | number[];
  previewBytes?: number;
}

export async function assertSafeResponse(response: APIResponse, options: SafeResponseOptions): Promise<void> {
  const expected = Array.isArray(options.expectedStatus) ? options.expectedStatus : [options.expectedStatus];
  if (expected.includes(response.status())) {
    return;
  }

  const preview = await safeResponsePreview(response, options.previewBytes ?? 2048);
  throw new Error(
    `${options.label} returned HTTP ${response.status()}, expected ${expected.join(' or ')}. ` +
      `URL=${redactText(response.url())}; response=${preview}`
  );
}

export async function safeResponsePreview(response: APIResponse, maxBytes = 2048): Promise<string> {
  const contentType = response.headers()['content-type'] ?? '';
  const bounded = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 2048;

  try {
    if (contentType.includes('application/json')) {
      return boundedArtifactJson(await response.json(), bounded);
    }

    const text = redactText(await response.text());
    return text.length <= bounded ? text : `${text.slice(0, bounded)}…[TRUNCATED]`;
  } catch {
    return '[response body unavailable]';
  }
}
