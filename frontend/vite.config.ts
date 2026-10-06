import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Compile scaffolding only; the UI owner will switch this entry to the app.
    lib: {
      entry: fileURLToPath(new URL('../tools/rust-baseline/react-compile.tsx', import.meta.url)),
      formats: ['es'],
      fileName: 'react-compile',
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
  },
});
