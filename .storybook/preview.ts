import '../src/style.css';
import type { Preview } from '@storybook/web-components';
const preview: Preview = {
  parameters: {
    backgrounds: { default: 'RAIDE', values: [{ name: 'RAIDE', value: '#0b111a' }] },
    controls: { expanded: true },
    a11y: { element: '#storybook-root' },
    options: { storySort: { order: ['Peruskomponentit', 'Tietonäkymät'] } },
  },
};
export default preview;
