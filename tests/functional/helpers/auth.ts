import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { csrfAwareRequest } from './csrf';
import { assertSafeResponse } from './safe-response';

export interface FunctionalCredentials {
  email: string;
  password: string;
}

export async function loginViaApi(api: APIRequestContext, credentials: FunctionalCredentials): Promise<Record<string, unknown>> {
  const response = await csrfAwareRequest(api, 'POST', '/api/auth/login', {
    data: { email: credentials.email, password: credentials.password }
  });
  await assertSafeResponse(response, { label: 'Functional API login', expectedStatus: 200 });
  return (await response.json()) as Record<string, unknown>;
}

export async function logoutViaApi(api: APIRequestContext): Promise<void> {
  const response = await csrfAwareRequest(api, 'POST', '/api/auth/logout', { data: {} });
  await assertSafeResponse(response, { label: 'Functional API logout', expectedStatus: 200 });
}

export async function readCurrentSession(api: APIRequestContext): Promise<Record<string, unknown>> {
  const response = await api.get('/api/auth/me');
  await assertSafeResponse(response, { label: 'Functional current session', expectedStatus: 200 });
  return (await response.json()) as Record<string, unknown>;
}

export async function loginViaUi(page: Page, credentials: FunctionalCredentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workspaces(?:[/?#]|$)/u);
}

export async function expectLoggedOut(page: Page): Promise<void> {
  await page.goto('/workspaces');
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/u);
}
