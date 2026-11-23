import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './components';
const meta: Meta = {
  title: 'Peruskomponentit/Myöhästymistunniste',
  component: 'raide-delay-badge',
  argTypes: {
    value: {
      name: 'Aikaero (min)',
      control: { type: 'number', min: -60, max: 180 },
      description:
        'Aikataulun ja ennusteen tai toteuman erotus minuutteina. null tarkoittaa puuttuvaa tietoa.',
    },
    cancelled: {
      name: 'Peruttu',
      control: 'boolean',
      description: 'Peruminen ohittaa aikaeron esityksen.',
    },
  },
  args: { value: 8, cancelled: false },
  render: (args) =>
    html`<raide-delay-badge .value=${args.value} .cancelled=${args.cancelled}></raide-delay-badge>`,
};
export default meta;
type Story = StoryObj;
export const Myohassa: Story = { name: 'Myöhässä', args: { value: 12 } };
export const Aikataulussa: Story = { name: 'Aikataulussa', args: { value: 0 } };
export const Etuajassa: Story = { name: 'Etuajassa', args: { value: -2 } };
export const EiEnnustetta: Story = { name: 'Ei ennustetta', args: { value: null } };
export const Peruttu: Story = { name: 'Peruttu', args: { cancelled: true } };
