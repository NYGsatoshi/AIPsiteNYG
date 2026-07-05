import type { AuthCurrentTenant, AuthCurrentUser } from './auth-session.facade';

export interface CurrentUserResponseDto {
  readonly userId?: unknown;
  readonly displayName?: unknown;
  readonly email?: unknown;
  readonly systemRole?: unknown;
  readonly status?: unknown;
}

export interface LoginResponseDto extends CurrentUserResponseDto {
  readonly expiresAt?: unknown;
}

export interface AuthStatusResponseDto {
  readonly isAuthenticated?: unknown;
  readonly user?: CurrentUserResponseDto | null;
}

export interface CurrentTenantResponseDto {
  readonly tenantId?: unknown;
  readonly tenantSlug?: unknown;
  readonly isAvailable?: unknown;
  readonly isPlatformScope?: unknown;
  readonly displayName?: unknown;
  readonly status?: unknown;
  readonly currentUserRole?: unknown;
  readonly appMode?: unknown;
  readonly allowTenantSwitching?: unknown;
}

export interface TenantResponseDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly slug?: unknown;
  readonly displayName?: unknown;
  readonly primaryDomain?: unknown;
  readonly status?: unknown;
  readonly planId?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly deletedAt?: unknown;
}

export interface AuthStatusViewModel {
  readonly isAuthenticated: boolean;
  readonly user: AuthCurrentUser | null;
}

export function mapCurrentUserResponse(dto: CurrentUserResponseDto): AuthCurrentUser {
  return {
    userId: requiredString(dto.userId, 'userId'),
    displayName: stringValue(dto.displayName),
    email: stringValue(dto.email),
    systemRole: enumValue(dto.systemRole),
    status: enumValue(dto.status)
  };
}

export function mapAuthStatusResponse(dto: AuthStatusResponseDto): AuthStatusViewModel {
  const isAuthenticated = dto.isAuthenticated === true && dto.user !== null && dto.user !== undefined;

  return {
    isAuthenticated,
    user: isAuthenticated ? mapCurrentUserResponse(dto.user as CurrentUserResponseDto) : null
  };
}

export function mapCurrentTenantResponse(dto: CurrentTenantResponseDto): AuthCurrentTenant {
  return {
    tenantId: requiredString(dto.tenantId, 'tenantId'),
    tenantSlug: nullableString(dto.tenantSlug),
    isAvailable: dto.isAvailable === true,
    isPlatformScope: dto.isPlatformScope === true,
    displayName: nullableString(dto.displayName),
    status: nullableEnumValue(dto.status),
    currentUserRole: nullableEnumValue(dto.currentUserRole),
    appMode: enumOrNumberValue(dto.appMode),
    allowTenantSwitching: dto.allowTenantSwitching === true
  };
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new Error(`Auth API response did not include ${fieldName}.`);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function enumValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return '';
}

function nullableEnumValue(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return null;
}

function enumOrNumberValue(value: unknown): string | number {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  return '';
}
