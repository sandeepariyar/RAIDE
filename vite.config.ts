import { defineConfig } from 'vite';

// The existing RAIDE Site is hosted at the domain root. GitHub Pages uses /RAIDE/.
export default defineConfig({
  base: process.env.RAIDE_BASE_PATH || '/',
});
