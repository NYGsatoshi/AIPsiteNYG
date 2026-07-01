import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app';

const meta: Meta<AppComponent> = {
  title: 'Shell/AppComponent',
  component: AppComponent,
  decorators: [
    applicationConfig({
      providers: [provideRouter([])]
    })
  ]
};

export default meta;

type Story = StoryObj<AppComponent>;

export const Placeholder: Story = {};
