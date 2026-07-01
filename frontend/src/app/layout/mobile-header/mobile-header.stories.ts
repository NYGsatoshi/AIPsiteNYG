import type { Meta, StoryObj } from '@storybook/angular';

import { MobileHeaderComponent } from './mobile-header.component';

const meta: Meta<MobileHeaderComponent> = {
  title: 'Shell/MobileHeader',
  component: MobileHeaderComponent,
  args: {
    workspaceLabel: '検証ワークスペース',
    drawerOpen: false
  }
};

export default meta;

type Story = StoryObj<MobileHeaderComponent>;

export const Closed: Story = {};

export const Open: Story = {
  args: {
    drawerOpen: true
  }
};
