export interface PublicHttpsSmokeConfiguration {
  readonly baseURL: string;
  readonly email: string;
  readonly password: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly unauthorizedWorkspaceId: string;
  readonly unauthorizedProjectId: string;
  readonly unauthorizedTaskId: string;
  readonly revokedFileId: string;
}

export function readPublicHttpsSmokeConfiguration(
  environment: NodeJS.ProcessEnv
): PublicHttpsSmokeConfiguration;

export function publicHttpsOrigin(value: string): string;

export function isUuid(value: unknown): value is string;
