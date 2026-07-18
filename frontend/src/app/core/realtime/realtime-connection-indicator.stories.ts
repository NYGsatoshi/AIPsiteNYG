import type { Meta, StoryObj } from '@storybook/angular';

import { RealtimeConnectionIndicatorComponent } from './realtime-connection-indicator.component';

const meta: Meta<RealtimeConnectionIndicatorComponent> = {
  title: 'Core/Realtime connection indicator',
  component: RealtimeConnectionIndicatorComponent
};

export default meta;
type Story = StoryObj<RealtimeConnectionIndicatorComponent>;

export const Connected: Story = { args: { state: 'Connected', enabled: true } };
export const Reconnecting: Story = { args: { state: 'Reconnecting', enabled: true } };
export const Degraded: Story = { args: { state: 'Degraded', enabled: true } };
export const Offline: Story = { args: { state: 'Offline', enabled: true } };
