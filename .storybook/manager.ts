import { addons } from '@storybook/manager-api';
import { create } from '@storybook/theming/create';
addons.setConfig({
  theme: create({
    base: 'dark',
    brandTitle: 'RAIDE · Komponenttikirjasto',
    colorPrimary: '#87edc4',
    colorSecondary: '#68a8eb',
    appBg: '#0b111a',
    appContentBg: '#111b28',
    textColor: '#e8eef5',
    fontBase: '"IBM Plex Sans", "Segoe UI", sans-serif',
  }),
  sidebar: { showRoots: true },
});
