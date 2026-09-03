/* eslint-disable -- Isolated CI acceptance script uses explicit HTTP assertions and is not production-bundled. */
import { mkdir, writeFile } from 'node:fs/promises';
import { request } from '@playwright/test';

const baseURL = requiredEnv('PLAYWRIGHT_BASE_URL');
const adminEmail = requiredSyntheticEmail('AIP_MBJ02_ADMIN_EMAIL');
const adminPassword = requiredEnv('AIP_MBJ02_ADMIN_PASSWORD');
const memberEmail = requiredSyntheticEmail('AIP_MBJ02_INVITEE_EMAIL');
const memberPassword = requiredEnv('AIP_MBJ02_INVITEE_PASSWORD');
const memberDisplayName = process.env.AIP_MBJ02_INVITEE_DISPLAY_NAME?.trim() || 'MVP-A AuthZ Member';

const evidence = {
  journey: 'MVP-A AuthZ boundary',
  baseURL,
  steps: [],
  secretMaterialRecorded: false
};

const anonymous = await newApiContext();
try {
  const ready = await anonymous.get('/health/ready');
  record('health-ready', 'GET', '/health/ready', ready.status());
  requireStatus(ready, 200, 'health readiness');

  const anonymousMe = await anonymous.get('/api/auth/me');
  record('anonymous-protected-me', 'GET', '/api/auth/me', anonymousMe.status());
  requireStatus(anonymousMe, 401, 'anonymous protected current-user lookup');

  const anonymousAdmin = await anonymous.get('/api/admin/invites');
  record('anonymous-admin-denied', 'GET', '/api/admin/invites', anonymousAdmin.status());
  requireStatus(anonymousAdmin, 401, 'anonymous admin endpoint denial');
} finally {
  await anonymous.dispose();
}

const admin = await newApiContext();
let workspaceId = '';
let inviteToken = '';
try {
  const loginCsrf = await getCsrf(admin, 'administrator-login-csrf');
  const login = await admin.post('/api/auth/login', {
    data: { email: adminEmail, password: adminPassword },
    headers: { [loginCsrf.headerName]: loginCsrf.token }
  });
  record('administrator-login', 'POST', '/api/auth/login', login.status(), '[credential body redacted]');
  requireStatus(login, 200, 'administrator login');
  const loginBody = await readJson(login, 'administrator login response');
  if (!Array.isArray(loginBody.workspaces) || loginBody.workspaces.length === 0) {
    throw new Error('Administrator login response does not expose a seeded Workspace.');
  }
  workspaceId = requiredString(loginBody.workspaces[0], 'id', 'administrator Workspace');

  const adminList = await admin.get('/api/admin/invites');
  record('administrator-admin-allowed', 'GET', '/api/admin/invites', adminList.status());
  requireStatus(adminList, 200, 'administrator admin endpoint access');

  const missingCsrf = await admin.post('/api/admin/invites', {
    data: {
      workspaceId,
      email: 'mvpa-authz-csrf-probe@example.test',
      role: 3,
      expiresAt: null
    }
  });
  record('administrator-missing-csrf-denied', 'POST', '/api/admin/invites', missingCsrf.status());
  requireStatus(missingCsrf, 403, 'administrator mutation without CSRF');

  const createCsrf = await getCsrf(admin, 'administrator-create-member-csrf');
  const createInvite = await admin.post('/api/admin/invites', {
    data: { workspaceId, email: memberEmail, role: 3, expiresAt: null },
    headers: { [createCsrf.headerName]: createCsrf.token }
  });
  record('administrator-create-member-invite', 'POST', '/api/admin/invites', createInvite.status(), '[invite token redacted]');
  requireStatus(createInvite, 200, 'administrator member invite creation');
  inviteToken = extractInviteToken(await readJson(createInvite, 'administrator member invite response'));
} finally {
  await admin.dispose();
}

const member = await newApiContext();
try {
  const acceptCsrf = await getCsrf(member, 'member-accept-csrf');
  const accept = await member.post('/api/invites/accept', {
    data: { token: inviteToken, displayName: memberDisplayName, password: memberPassword },
    headers: { [acceptCsrf.headerName]: acceptCsrf.token }
  });
  record('member-accept-invite', 'POST', '/api/invites/accept', accept.status(), '[invite token and password redacted]');
  requireStatus(accept, 200, 'member invite acceptance');

  const me = await member.get('/api/auth/me');
  record('member-session-active', 'GET', '/api/auth/me', me.status());
  requireStatus(me, 200, 'member current-user lookup');

  const memberAdminRead = await member.get('/api/admin/invites');
  record('member-admin-read-denied', 'GET', '/api/admin/invites', memberAdminRead.status());
  requireStatus(memberAdminRead, 403, 'non-admin admin endpoint read denial');

  const memberMutationCsrf = await getCsrf(member, 'member-admin-mutation-csrf');
  const memberAdminMutation = await member.post('/api/admin/invites', {
    data: {
      workspaceId,
      email: 'mvpa-authz-non-admin-probe@example.test',
      role: 3,
      expiresAt: null
    },
    headers: { [memberMutationCsrf.headerName]: memberMutationCsrf.token }
  });
  record('member-admin-mutation-denied', 'POST', '/api/admin/invites', memberAdminMutation.status());
  requireStatus(memberAdminMutation, 403, 'non-admin admin endpoint mutation denial');

  const logoutCsrf = await getCsrf(member, 'member-logout-csrf');
  const logout = await member.post('/api/auth/logout', {
    data: {},
    headers: { [logoutCsrf.headerName]: logoutCsrf.token }
  });
  record('member-logout', 'POST', '/api/auth/logout', logout.status());
  requireStatus(logout, 200, 'member logout');

  const afterLogout = await member.get('/api/auth/me');
  record('revoked-session-denied', 'GET', '/api/auth/me', afterLogout.status());
  requireStatus(afterLogout, 401, 'logged-out session denial');
} finally {
  await member.dispose();
}

await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/mvp-a-authz-boundary.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8'
);
console.log('MVP-A AuthZ boundary acceptance passed: anonymous 401, admin allow, non-admin 403, CSRF denial, and logout invalidation were verified against the real backend.');

async function newApiContext() {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-Tenant-Slug': 'default' }
  });
}

async function getCsrf(api, name) {
  const response = await api.get('/api/security/csrf-token');
  record(name, 'GET', '/api/security/csrf-token', response.status(), '[CSRF token redacted]');
  requireStatus(response, 200, `${name} response`);
  const body = await readJson(response, `${name} response`);
  return {
    token: requiredString(body, 'token', `${name} response`),
    headerName: requiredString(body, 'headerName', `${name} response`)
  };
}

function extractInviteToken(invite) {
  const inviteUrl = requiredString(invite, 'inviteUrl', 'invite response');
  const token = new URL(inviteUrl, baseURL).searchParams.get('token');
  if (!token) throw new Error('Invite response URL does not contain a token.');
  return token;
}

function record(name, method, path, status, bodyPreview) {
  evidence.steps.push({ name, method, path, status, ...(bodyPreview ? { bodyPreview } : {}) });
}

function requireStatus(response, expected, label) {
  if (response.status() !== expected) {
    throw new Error(`${label} returned HTTP ${response.status()}, expected ${expected}.`);
  }
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function requiredString(value, property, label) {
  const result = value && typeof value === 'object' ? value[property] : undefined;
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`${label} is missing required string property '${property}'.`);
  }
  return result;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for MVP-A AuthZ boundary acceptance.`);
  return value;
}

function requiredSyntheticEmail(name) {
  const value = requiredEnv(name);
  if (!value.toLowerCase().endsWith('@example.test')) {
    throw new Error(`${name} must use the synthetic @example.test domain.`);
  }
  return value;
}
