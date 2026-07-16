import { type Meta, type StoryObj } from '@storybook/angular';

import { AipDataGridComponent, AipDialogComponent, AipFileUploaderComponent } from './aip-adapter-shells.components';

const dataGridContract = {
  ariaLabel: 'Member list',
  columns: [],
  page: 1,
  pageSize: 25,
  presentation: 'desktop' as const,
  rowIdentity: (row: object) => JSON.stringify(row),
  rows: [],
  state: 'ready' as const
};
const dialogContract = { ariaLabel: 'Confirm action', closeOnEscape: true, destructive: false, presentation: 'desktop' as const, state: 'ready' as const, title: 'Confirm' };
const uploaderContract = { ariaLabel: 'Upload files', files: [], multiple: true, presentation: 'desktop' as const, state: 'ready' as const };

const meta: Meta = {
  title: 'Shared/UI adapters/Complex fallback shells',
  render: () => ({
    moduleMetadata: { imports: [AipDataGridComponent, AipDialogComponent, AipFileUploaderComponent] },
    props: { dataGridContract, dialogContract, uploaderContract },
    template: `
      <main style="display:grid;gap:var(--aip-space-3);max-width:720px;padding:var(--aip-space-4)">
        <aip-data-grid [contract]="dataGridContract" />
        <aip-dialog [contract]="dialogContract" state="conflict" />
        <aip-file-uploader [contract]="uploaderContract" presentation="narrow" state="loading" />
      </main>
    `
  })
};

export default meta;
type Story = StoryObj;

export const DarkCompact: Story = {};
export const LightComfortable: Story = {
  decorators: [(story) => {
    document.documentElement.dataset['aipTheme'] = 'light';
    document.documentElement.dataset['aipDensity'] = 'comfortable';
    return story();
  }]
};
