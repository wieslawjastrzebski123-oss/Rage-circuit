import { defineConfig } from 'vite';

// Relative base ('./') makes the built site work from any sub-path,
// e.g. https://username.github.io/rage-circuit/ on GitHub Pages.
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: './',
  // shown in the menu footer so it's obvious which version is running
  define: { __BUILD_STAMP__: JSON.stringify(stamp) },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
  },
});
