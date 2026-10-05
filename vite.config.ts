import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: 'app',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: resolve(__dirname, 'app/index.html'), kitdemo: resolve(__dirname, 'app/kitdemo.html') },
    },
  },
  server: {
    port: 3003,
  },
});
