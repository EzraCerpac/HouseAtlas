/** Example-only production pass: builds frontend/example into dist/example
 * after the app's own build. It is a separate pass so the app's inputs, chunk
 * graph, startup files and offline shell stay byte-identical. It has no
 * offline-shell plugin, so nothing here enters the app's precache or service
 * worker. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsBinaryDataPlugin } from '../build/pdfjs-binary-data-plugin.mjs';
import { threeNoticeBanner } from '../build/three-notice-banner.mjs';
import { clientSchemasPlugin } from '../build/client-schemas-plugin.mjs';

const frontend = fileURLToPath(new URL('..', import.meta.url));
/** The Rust host loads only these file types, each at most 4,000,000 bytes. */
const HOST_TYPES = ['html', 'js', 'css', 'woff2', 'webmanifest', 'png'];
function hostLimits(): Plugin {
  return {
    name: 'houseatlas-example-host-limits', apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        const size = file.type === 'chunk' ? Buffer.byteLength(file.code)
          : typeof file.source === 'string' ? Buffer.byteLength(file.source) : file.source.byteLength;
        if (!HOST_TYPES.includes(file.fileName.split('.').at(-1) ?? '') || size > 4_000_000)
          this.error(`The Rust host refuses this example file: ${file.fileName} (${size} bytes)`);
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/example/',
  publicDir: false,
  plugins: [clientSchemasPlugin(), react(), pdfjsBinaryDataPlugin(frontend), hostLimits()],
  worker: { rolldownOptions: { output: { postBanner: threeNoticeBanner(frontend) } } },
  build: {
    outDir: resolve(frontend, 'dist/example'),
    emptyOutDir: false,
    sourcemap: false,
    rolldownOptions: {
      output: {
        postBanner: threeNoticeBanner(frontend),
        assetFileNames: asset => (asset.names ?? []).some(name => name === 'pdf.worker.min.mjs')
          ? 'assets/pdf.worker.min-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
