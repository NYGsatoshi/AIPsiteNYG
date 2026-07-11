const COMPOSE_PROJECT_NAME_MAX_LENGTH = 63;

export const composeV2Invocation = Object.freeze({
  command: 'docker',
  prefix: ['compose']
});

export const legacyComposeInvocation = Object.freeze({
  command: 'docker-compose',
  prefix: []
});

export function composeProjectName(parts, maxLength = COMPOSE_PROJECT_NAME_MAX_LENGTH) {
  const normalized = parts
    .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-_]+$/, '');

  const fallback = 'aipsite-real-backend-smoke';
  const withinLimit = (normalized || fallback).slice(0, maxLength).replace(/[-_]+$/, '');
  return withinLimit || 'aipsite';
}

export function getComposeProjectName(environment, processId) {
  const override = environment.REAL_BACKEND_SMOKE_COMPOSE_PROJECT_NAME;
  if (typeof override === 'string' && override.trim().length > 0) {
    return composeProjectName([override]);
  }

  return composeProjectName([
    'aipsite-real-backend-smoke',
    environment.GITHUB_RUN_ID,
    environment.GITHUB_RUN_ATTEMPT,
    environment.CI ? 'ci' : 'local',
    processId
  ]);
}

export async function selectComposeInvocation(runVersion) {
  if (await runVersion('docker', ['compose', 'version'])) {
    return composeV2Invocation;
  }

  if (await runVersion('docker-compose', ['version'])) {
    return legacyComposeInvocation;
  }

  throw new Error(
    'Docker Compose is required for the real-backend browser smoke. Install Docker Desktop or Docker Compose v2 so `docker compose version` succeeds; legacy `docker-compose version` is also supported.'
  );
}

export function isStaticAngularServerUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.port === '4173' && (host === '127.0.0.1' || host === 'localhost' || host === '::1');
  } catch {
    return false;
  }
}

export function normalizeExitCode(code) {
  return Number.isInteger(code) && code >= 0 ? code : 1;
}

export function redactSecrets(output) {
  return output
    .replace(/(POSTGRES_PASSWORD\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(AIP_[A-Z0-9_]*PASSWORD\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(Password=)[^;\s\r\n]+/gi, '$1[redacted]')
    .replace(/(Authorization\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:X-CSRF-Token|CSRF(?:Token)?)\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:Invite|Invitation)[A-Za-z-]*Token\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/("(?:password|token|authorization|cookie|csrfToken|inviteToken|invitationToken)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');
}
