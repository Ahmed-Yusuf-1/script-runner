import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite builds three bundles: main (Node), preload (bridge), renderer (UI).
// externalizeDepsPlugin keeps node_modules deps (like playwright/electron) external
// so they're required at runtime rather than bundled into the main process.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
  },
});
