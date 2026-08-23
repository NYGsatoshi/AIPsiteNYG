import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import {
  ADMIN_WORKSPACE,
  ADVISER_WORKSPACE,
  MEMBER_WORKSPACE,
  OWNER_WORKSPACE,
  READ_ONLY_WORKSPACE,
  SYSTEM_ADMIN_WORKSPACE,
} from '../workspaces.mock';
import { WorkspaceCardComponent } from './workspace-card.component';

const meta: Meta<WorkspaceCardComponent> = {
  title: 'Features/Workspaces/WorkspaceCard',
  component: WorkspaceCardComponent,
  decorators: [
    applicationConfig({
      providers: [provideRouter([])],
    }),
  ],
};

export default meta;

type Story = StoryObj<WorkspaceCardComponent>;

export const Owner: Story = { args: { workspace: OWNER_WORKSPACE } };

export const Admin: Story = { args: { workspace: ADMIN_WORKSPACE } };

export const Adviser: Story = { args: { workspace: ADVISER_WORKSPACE } };

export const Member: Story = { args: { workspace: MEMBER_WORKSPACE } };

export const ReadOnly: Story = { args: { workspace: READ_ONLY_WORKSPACE } };

export const SystemAdminAccess: Story = { args: { workspace: SYSTEM_ADMIN_WORKSPACE } };
