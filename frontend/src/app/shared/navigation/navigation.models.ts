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

export type NavigationPlacement = 'primary' | 'pinned';
export type NavigationMoveDirection = 'up' | 'down';

export interface NavigationMoveRequest {
  readonly itemId: string;
  readonly direction: NavigationMoveDirection;
}

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly requiredCapability?: AppCapability;
  readonly placement?: NavigationPlacement;
}

export interface NavigationSections {
  readonly primaryItems: readonly NavigationItem[];
  readonly pinnedItems: readonly NavigationItem[];
}

export function filterNavigationItems(
  items: readonly NavigationItem[],
  capabilities: readonly AppCapability[]
): NavigationItem[] {
  const allowed = new Set(capabilities);
  return items.filter((item) => !item.requiredCapability || allowed.has(item.requiredCapability));
}

export function partitionNavigationItems(items: readonly NavigationItem[]): NavigationSections {
  return {
    primaryItems: items.filter((item) => item.placement !== 'pinned'),
    pinnedItems: items.filter((item) => item.placement === 'pinned')
  };
}
