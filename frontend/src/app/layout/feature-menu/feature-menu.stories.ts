import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { provideRouter } from '@angular/router';

import { partitionNavigationItems } from '../../shared/navigation/navigation.models';
import { DEFAULT_NAVIGATION_ITEMS } from '../app-shell/app-shell.facade';
import { FeatureMenuComponent } from './feature-menu.component';

const defaultSections = partitionNavigationItems(DEFAULT_NAVIGATION_ITEMS);
const permissionFilteredSections = partitionNavigationItems(
  DEFAULT_NAVIGATION_ITEMS.filter((item) => item.id !== 'audit')
);

const meta: Meta<FeatureMenuComponent> = {
  title: 'Shell/FeatureMenu',
  component: FeatureMenuComponent,
  args: {
    navigationItems: defaultSections.primaryItems,
    pinnedItems: defaultSections.pinnedItems
  },
  decorators: [
    applicationConfig({
      providers: [provideRouter([])]
    })
  ]
};

export default meta;

type Story = StoryObj<FeatureMenuComponent>;

export const Default: Story = {};

export const PermissionFiltered: Story = {
  args: {
    navigationItems: permissionFilteredSections.primaryItems,
    pinnedItems: permissionFilteredSections.pinnedItems
  }
};

export const CollapsedRail: Story = {
  args: {
    collapsible: true,
    collapsed: true
  }
};
