import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'app',
  base: './',
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve('dist'),
    emptyOutDir: true,
  },
});
