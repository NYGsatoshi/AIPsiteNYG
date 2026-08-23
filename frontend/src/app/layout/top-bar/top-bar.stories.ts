import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

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
  decorators: [
    applicationConfig({
      providers: [provideRouter([])]
    })
  ],
  args: {
    workspace: STORY_ACTIVE_WORKSPACE,
    workspaceOptions: [
      { id: STORY_ACTIVE_WORKSPACE.id, label: STORY_ACTIVE_WORKSPACE.label },
      { id: 'fictional-workspace-2', label: 'Sample Workspace Beta' }
    ],
    workspaceSelectionStatus: 'selected',
    runningProjectCount: 2,
    needsReviewProjectCount: 1,
    canOpenWorkspaceMembers: true,
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

export const SelectionRequired: Story = {
  args: {
    workspace: null,
    workspaceSelectionStatus: 'selectionRequired',
    runningProjectCount: null,
    needsReviewProjectCount: null,
    canOpenWorkspaceMembers: false
  }
};

export const ZeroResearchActivity: Story = {
  args: {
    runningProjectCount: 0,
    needsReviewProjectCount: 0
  }
};

export const NarrowHeader: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' }
  }
};
