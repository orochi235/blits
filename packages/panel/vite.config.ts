import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The JavaScript is bundled here so the stylesheets reach the shadow root as strings; `tsc -b`
// writes the declarations. Everything the package depends on stays an import.
const external = (id: string) =>
  id === '@msb235/blits' ||
  id === 'react' ||
  id.startsWith('react/') ||
  id.startsWith('react-dom') ||
  (id.startsWith('@weasel-js/') && !id.includes('.css'));

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)), formats: ['es'], fileName: 'index' },
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { external },
  },
});
