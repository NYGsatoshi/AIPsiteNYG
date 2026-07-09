import type { Meta, StoryObj } from '@storybook/angular';

import type { WorkspaceSummary } from '../../core/workspace/active-workspace.facade';
import { TopBarComponent } from './top-bar.component';

const STORY_ACTIVE_WORKSPACE: WorkspaceSummary = {
  id: 'fictional-workspace-1',
  label: 'Sample Workspace Alpha',
  description: 'Storybook workspace mock'
};

const meta: Meta<TopBarComponent> = {
  title: 'Shell/TopBar',
  component: TopBarComponent,
  args: {
    workspace: STORY_ACTIVE_WORKSPACE,
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
