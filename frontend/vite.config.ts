import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsBinaryDataPlugin } from './build/pdfjs-binary-data-plugin.mjs';
import { threeNoticeBanner } from './build/three-notice-banner.mjs';

export default defineConfig({
  plugins: [react(), pdfjsBinaryDataPlugin(process.cwd())],
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        postBanner: threeNoticeBanner(process.cwd()),
        // React loads eagerly in its own chunk so the entry stays within the
        // 4,000,000-byte static file budget; heavy readers remain lazy.
        codeSplitting: {
          groups: [{ name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
        assetFileNames: asset => {
          const names = asset.names ?? [];
          if (names.some(name => name === 'pdf.worker.min.mjs')) return 'assets/pdf.worker.min-[hash].js';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
