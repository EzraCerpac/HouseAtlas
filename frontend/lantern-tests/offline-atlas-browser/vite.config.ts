import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { assetsDir: 'fixture-assets', sourcemap: false,
  rolldownOptions: { input: 'lantern-tests/offline-atlas-browser/index.html' } } });
