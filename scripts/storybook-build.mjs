// Some managed build environments do not expose network interface enumeration.
// Static Storybook builds do not need interface addresses; retain normal behaviour elsewhere.
import os from 'node:os';
try {
  os.networkInterfaces();
} catch {
  os.networkInterfaces = () => ({});
}
const entry = new URL('../node_modules/storybook/bin/index.cjs', import.meta.url);
process.argv = [
  process.argv[0],
  entry.pathname,
  'build',
  '--output-dir',
  'dist/komponentit',
  '--quiet',
  '--disable-telemetry',
];
await import(entry.href);
