import type { Meta, StoryObj } from '@storybook/angular';

import { AccountRailComponent } from './account-rail.component';

const meta: Meta<AccountRailComponent> = {
  title: 'Shell/AccountRail',
  component: AccountRailComponent,
  args: {
    displayName: '制作班メンバーA',
    supportingUsers: ['通知確認ユーザー', '検証 一号', '架空 二号']
  }
};

export default meta;

type Story = StoryObj<AccountRailComponent>;

export const Default: Story = {};
