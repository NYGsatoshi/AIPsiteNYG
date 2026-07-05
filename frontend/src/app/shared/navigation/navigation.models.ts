export type AppCapability =
  | 'workspace:view'
  | 'announcements:view'
  | 'projects:view'
  | 'files:view'
  | 'account:view'
  | 'audit:view'
  | 'admin:access'
  | 'invite:read'
  | 'invite:create';

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly requiredCapability?: AppCapability;
}

export function filterNavigationItems(
  items: readonly NavigationItem[],
  capabilities: readonly AppCapability[]
): NavigationItem[] {
  const allowed = new Set(capabilities);
  return items.filter((item) => !item.requiredCapability || allowed.has(item.requiredCapability));
}
