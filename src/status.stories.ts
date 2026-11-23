import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './components';
const meta: Meta = {
  title: 'Peruskomponentit/Tietolähteen tila',
  component: 'raide-data-status',
  argTypes: {
    mode: { name: 'Aineiston tila', control: 'select', options: ['live', 'recorded'] },
    status: { name: 'Yhteystila', control: 'select', options: ['loading', 'ready', 'error'] },
  },
  args: { mode: 'live', status: 'ready' },
  render: (a) => html`<raide-data-status .mode=${a.mode} .status=${a.status}></raide-data-status>`,
};
export default meta;
type Story = StoryObj;
export const Reaaliaikainen: Story = { name: 'Reaaliaikainen' };
export const Tallenne: Story = { name: 'Tallenne', args: { mode: 'recorded' } };
export const Yhteyshairio: Story = { name: 'Yhteyshäiriö', args: { status: 'error' } };
export const Yhdistetaan: Story = { name: 'Yhdistetään', args: { status: 'loading' } };
