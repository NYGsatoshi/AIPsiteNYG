import type { Meta, StoryObj } from '@storybook/angular';

import { DEFAULT_ACTIVE_WORKSPACE } from '../../core/workspace/active-workspace.facade';
import { TopBarComponent } from './top-bar.component';

const meta: Meta<TopBarComponent> = {
  title: 'Shell/TopBar',
  component: TopBarComponent,
  args: {
    workspace: DEFAULT_ACTIVE_WORKSPACE,
    searchValue: '',
    sessionStatus: 'active',
    rightPanelMode: 'collapsed'
  }
};

export default meta;

type Story = StoryObj<TopBarComponent>;

export const Default: Story = {};

export const SessionExpired: Story = {
  args: {
    sessionStatus: 'expired'
  }
};
