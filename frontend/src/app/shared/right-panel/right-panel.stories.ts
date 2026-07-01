import type { Meta, StoryObj } from '@storybook/angular';

import { DEFAULT_AUTH_SESSION } from '../../core/auth/auth-session.facade';
import { DEFAULT_ACTIVE_WORKSPACE } from '../../core/workspace/active-workspace.facade';
import { RightPanelComponent } from './right-panel.component';

const meta: Meta<RightPanelComponent> = {
  title: 'Shell/RightPanel',
  component: RightPanelComponent,
  args: {
    session: DEFAULT_AUTH_SESSION,
    workspace: DEFAULT_ACTIVE_WORKSPACE,
    mode: 'collapsed'
  }
};

export default meta;

type Story = StoryObj<RightPanelComponent>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: {
    mode: 'expanded'
  }
};
