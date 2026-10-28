import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error The bounded ESM build plugin is inspected and exercised by the production build.
import { offlineShellPlugin } from './build/offline-shell-plugin.mjs';
import { pdfjsBinaryDataPlugin } from './build/pdfjs-binary-data-plugin.mjs';
import { threeNoticeBanner } from './build/three-notice-banner.mjs';
import { clientSchemasPlugin } from './build/client-schemas-plugin.mjs';

export default defineConfig({
  plugins: [clientSchemasPlugin(), react(), pdfjsBinaryDataPlugin(process.cwd()), offlineShellPlugin()],
  // The Full model's GLB worker bundles three.js, so it carries the same notice.
  worker: { rolldownOptions: { output: { postBanner: threeNoticeBanner(process.cwd()) } } },
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
