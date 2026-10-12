import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        assetFileNames: asset => asset.names?.some(name => name === 'pdf.worker.min.mjs')
          ? 'assets/pdf.worker.min-[hash].js'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
