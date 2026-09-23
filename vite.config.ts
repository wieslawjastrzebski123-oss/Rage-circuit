import { defineConfig } from 'vite';

// Relative base ('./') makes the built site work from any sub-path,
// e.g. https://username.github.io/rage-circuit/ on GitHub Pages.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
  },
});
