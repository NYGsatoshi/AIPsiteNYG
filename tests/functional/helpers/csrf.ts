import type { APIRequestContext, APIResponse } from '@playwright/test';

import { assertSafeResponse } from './safe-response';

export interface CsrfToken {
  token: string;
  headerName: string;
}

type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

export async function getCsrfToken(api: APIRequestContext): Promise<CsrfToken> {
  const response = await api.get('/api/security/csrf-token');
  await assertSafeResponse(response, { label: 'CSRF token request', expectedStatus: 200 });

  const body = (await response.json()) as Record<string, unknown>;
  const token = requireString(body.token ?? body.Token, 'CSRF token');
  const headerName = requireString(body.headerName ?? body.HeaderName, 'CSRF header name');
  return { token, headerName };
}

export async function csrfAwareRequest(
  api: APIRequestContext,
  method: string,
  url: string,
  options: FetchOptions = {}
): Promise<APIResponse> {
  const normalizedMethod = method.trim().toUpperCase();
  const headers = normalizeHeaders(options.headers);

  if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(normalizedMethod)) {
    const csrf = await getCsrfToken(api);
    headers[csrf.headerName] = csrf.token;
  }

  return api.fetch(url, {
    ...options,
    method: normalizedMethod,
    headers
  });
}

function normalizeHeaders(headers: FetchOptions['headers']): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers } as Record<string, string>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing from the response.`);
  }
  return value;
}
