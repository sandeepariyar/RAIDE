import type { StorybookConfig } from '@storybook/web-components-vite';
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  staticDirs: [{ from: '../public/fonts', to: '/fonts' }],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/web-components-vite', options: {} },
  core: { disableTelemetry: true },
  typescript: { check: false },
};
export default config;
