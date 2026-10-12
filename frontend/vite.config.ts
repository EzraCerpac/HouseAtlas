import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsBinaryDataPlugin } from './build/pdfjs-binary-data-plugin.mjs';

export default defineConfig({
  plugins: [react(), pdfjsBinaryDataPlugin(process.cwd())],
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        assetFileNames: asset => {
          const names = asset.names ?? [];
          if (names.some(name => name === 'pdf.worker.min.mjs')) return 'assets/pdf.worker.min-[hash].js';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
