import { mkdir, writeFile } from 'node:fs/promises';
import { request } from '@playwright/test';

const HTTP_OK = Number('200'),
  HTTP_UNAUTHORIZED = Number('401'),
  HTTP_FORBIDDEN = Number('403'),
  EMPTY_COUNT = Number('0'),
  JSON_INDENT = Number('2'),
  requiredEnv = (name) => {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required for MVP-A AuthZ boundary acceptance.`);
    }
    return value;
  },
  requiredSyntheticEmail = (name) => {
    const value = requiredEnv(name);
    if (!value.toLowerCase().endsWith('@example.test')) {
      throw new Error(`${name} must use the synthetic @example.test domain.`);
    }
    return value;
  },
  baseURL = requiredEnv('PLAYWRIGHT_BASE_URL'),
  adminEmail = requiredSyntheticEmail('AIP_MBJ02_ADMIN_EMAIL'),
  adminPassword = requiredEnv('AIP_MBJ02_ADMIN_PASSWORD'),
  memberEmail = requiredSyntheticEmail('AIP_MBJ02_INVITEE_EMAIL'),
  memberPassword = requiredEnv('AIP_MBJ02_INVITEE_PASSWORD'),
  memberDisplayName = process.env.AIP_MBJ02_INVITEE_DISPLAY_NAME?.trim() || 'MVP-A AuthZ Member',
  evidence = {
    baseURL,
    journey: 'MVP-A AuthZ boundary',
    secretMaterialRecorded: false,
    steps: []
  },
  record = (name, route, response) => {
    evidence.steps.push({
      method: route.method,
      name,
      path: route.path,
      status: response.status()
    });
  },
  requireStatus = (response, expected, label) => {
    if (response.status() !== expected) {
      throw new Error(`${label} returned HTTP ${response.status()}, expected ${expected}.`);
    }
  },
  readJson = async (response, label) => {
    try {
      return await response.json();
    } catch {
      throw new Error(`${label} is not valid JSON.`);
    }
  },
  requiredString = (value, property, label) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`${label} is not an object.`);
    }
    const result = value[property];
    if (typeof result !== 'string' || result.length === EMPTY_COUNT) {
      throw new Error(`${label} is missing required string property '${property}'.`);
    }
    return result;
  },
  newApiContext = () => request.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-Tenant-Slug': 'default' }
  }),
  getCsrf = async (api, name) => {
    const response = await api.get('/api/security/csrf-token'),
      body = await readJson(response, `${name} response`);
    record(name, { method: 'GET', path: '/api/security/csrf-token' }, response);
    requireStatus(response, HTTP_OK, `${name} response`);
    return {
      headerName: requiredString(body, 'headerName', `${name} response`),
      token: requiredString(body, 'token', `${name} response`)
    };
  },
  extractInviteToken = (invite) => {
    const inviteUrl = requiredString(invite, 'inviteUrl', 'invite response'),
      token = new URL(inviteUrl, baseURL).searchParams.get('token');
    if (!token) {
      throw new Error('Invite response URL does not contain a token.');
    }
    return token;
  },
  verifyAnonymous = async () => {
    const anonymous = await newApiContext();
    try {
      const ready = await anonymous.get('/health/ready'),
        anonymousMe = await anonymous.get('/api/auth/me'),
        anonymousAdmin = await anonymous.get('/api/admin/invites');
      record('health-ready', { method: 'GET', path: '/health/ready' }, ready);
      requireStatus(ready, HTTP_OK, 'health readiness');
      record('anonymous-protected-me', { method: 'GET', path: '/api/auth/me' }, anonymousMe);
      requireStatus(anonymousMe, HTTP_UNAUTHORIZED, 'anonymous protected current-user lookup');
      record('anonymous-admin-denied', { method: 'GET', path: '/api/admin/invites' }, anonymousAdmin);
      requireStatus(anonymousAdmin, HTTP_UNAUTHORIZED, 'anonymous admin endpoint denial');
    } finally {
      await anonymous.dispose();
    }
  },
  loginAdministrator = async (admin) => {
    const loginCsrf = await getCsrf(admin, 'administrator-login-csrf'),
      login = await admin.post('/api/auth/login', {
        data: { email: adminEmail, password: adminPassword },
        headers: { [loginCsrf.headerName]: loginCsrf.token }
      }),
      loginBody = await readJson(login, 'administrator login response');
    record('administrator-login', { method: 'POST', path: '/api/auth/login' }, login);
    requireStatus(login, HTTP_OK, 'administrator login');
    if (!Array.isArray(loginBody.workspaces) || loginBody.workspaces.length === EMPTY_COUNT) {
      throw new Error('Administrator login response does not expose a seeded Workspace.');
    }
    {
      const [workspace] = loginBody.workspaces;
      return requiredString(workspace, 'id', 'administrator Workspace');
    }
  },
  createMemberInvite = async (admin, workspaceId) => {
    {
      const adminList = await admin.get('/api/admin/invites');
      record('administrator-admin-allowed', { method: 'GET', path: '/api/admin/invites' }, adminList);
      requireStatus(adminList, HTTP_OK, 'administrator admin endpoint access');
    }
    {
      const missingCsrf = await admin.post('/api/admin/invites', {
        data: {
          email: 'mvpa-authz-csrf-probe@example.test',
          expiresAt: null,
          role: 3,
          workspaceId
        }
      });
      record('administrator-missing-csrf-denied', { method: 'POST', path: '/api/admin/invites' }, missingCsrf);
      requireStatus(missingCsrf, HTTP_FORBIDDEN, 'administrator mutation without CSRF');
    }
    {
      const createCsrf = await getCsrf(admin, 'administrator-create-member-csrf'),
        createInvite = await admin.post('/api/admin/invites', {
          data: { email: memberEmail, expiresAt: null, role: 3, workspaceId },
          headers: { [createCsrf.headerName]: createCsrf.token }
        }),
        inviteBody = await readJson(createInvite, 'administrator member invite response');
      record('administrator-create-member-invite', { method: 'POST', path: '/api/admin/invites' }, createInvite);
      requireStatus(createInvite, HTTP_OK, 'administrator member invite creation');
      return extractInviteToken(inviteBody);
    }
  },
  verifyMember = async (workspaceId, inviteToken) => {
    const member = await newApiContext();
    try {
      {
        const acceptCsrf = await getCsrf(member, 'member-accept-csrf'),
          accept = await member.post('/api/invites/accept', {
            data: { displayName: memberDisplayName, password: memberPassword, token: inviteToken },
            headers: { [acceptCsrf.headerName]: acceptCsrf.token }
          });
        record('member-accept-invite', { method: 'POST', path: '/api/invites/accept' }, accept);
        requireStatus(accept, HTTP_OK, 'member invite acceptance');
      }
      {
        const me = await member.get('/api/auth/me'),
          memberAdminRead = await member.get('/api/admin/invites');
        record('member-session-active', { method: 'GET', path: '/api/auth/me' }, me);
        requireStatus(me, HTTP_OK, 'member current-user lookup');
        record('member-admin-read-denied', { method: 'GET', path: '/api/admin/invites' }, memberAdminRead);
        requireStatus(memberAdminRead, HTTP_FORBIDDEN, 'non-admin admin endpoint read denial');
      }
      {
        const memberMutationCsrf = await getCsrf(member, 'member-admin-mutation-csrf'),
          memberAdminMutation = await member.post('/api/admin/invites', {
            data: {
              email: 'mvpa-authz-non-admin-probe@example.test',
              expiresAt: null,
              role: 3,
              workspaceId
            },
            headers: { [memberMutationCsrf.headerName]: memberMutationCsrf.token }
          });
        record('member-admin-mutation-denied', { method: 'POST', path: '/api/admin/invites' }, memberAdminMutation);
        requireStatus(memberAdminMutation, HTTP_FORBIDDEN, 'non-admin admin endpoint mutation denial');
      }
      {
        const logoutCsrf = await getCsrf(member, 'member-logout-csrf'),
          logout = await member.post('/api/auth/logout', {
            data: {},
            headers: { [logoutCsrf.headerName]: logoutCsrf.token }
          });
        record('member-logout', { method: 'POST', path: '/api/auth/logout' }, logout);
        requireStatus(logout, HTTP_OK, 'member logout');
      }
      {
        const afterLogout = await member.get('/api/auth/me');
        record('revoked-session-denied', { method: 'GET', path: '/api/auth/me' }, afterLogout);
        requireStatus(afterLogout, HTTP_UNAUTHORIZED, 'logged-out session denial');
      }
    } finally {
      await member.dispose();
    }
  },
  writeEvidence = async () => {
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/mvp-a-authz-boundary.json',
      `${JSON.stringify(evidence, null, JSON_INDENT)}\n`,
      'utf8'
    );
  },
  run = async () => {
    await verifyAnonymous();
    const admin = await newApiContext();
    try {
      const workspaceId = await loginAdministrator(admin),
        inviteToken = await createMemberInvite(admin, workspaceId);
      await verifyMember(workspaceId, inviteToken);
    } finally {
      await admin.dispose();
    }
    await writeEvidence();
    process.stdout.write(
      'MVP-A AuthZ boundary acceptance passed: anonymous 401, admin allow, non-admin 403, CSRF denial, and logout invalidation were verified against the real backend.\n'
    );
  };

await run();
