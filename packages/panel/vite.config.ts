import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The JavaScript is bundled here so the stylesheets reach the shadow root as strings; `tsc -b`
// writes the declarations. weasel is bundled too, so an app on another weasel installs no second
// copy; blits and React stay imports, so the panel shares the app's.
const external = (id: string) =>
  id === '@msb235/blits' ||
  id === 'react' ||
  id.startsWith('react/') ||
  id.startsWith('react-dom');

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)), formats: ['es'], fileName: 'index' },
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { external },
  },
});
