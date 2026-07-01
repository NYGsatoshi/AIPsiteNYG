import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { provideRouter } from '@angular/router';

import { DEFAULT_NAVIGATION_ITEMS } from '../app-shell/app-shell.facade';
import { FeatureMenuComponent } from './feature-menu.component';

const meta: Meta<FeatureMenuComponent> = {
  title: 'Shell/FeatureMenu',
  component: FeatureMenuComponent,
  args: {
    navigationItems: DEFAULT_NAVIGATION_ITEMS
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
    navigationItems: DEFAULT_NAVIGATION_ITEMS.filter((item) => item.id !== 'audit')
  }
};
