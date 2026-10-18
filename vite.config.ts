import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { fileURLToPath } from 'node:url';

// This app's own deployed origin. The OneLyf shell loads remoteEntry.js and
// this app's chunks inside the shell's page. Without an absolute `base`, Vite
// emits relative asset URLs that resolve against the shell's origin and 404.
// Production pins `base` to the Vercel project that actually serves Mockwave
// (https://mockwave.vercel.app/). onelyf.net/mockwave is not rewritten, so a
// base there returns the shell's HTML for every asset. Preview deploys pin
// their own Vercel URL so a preview does not cross-load production assets.
// Dev stays on `/` so the local server works standalone.
const DEPLOYED_ORIGIN =
  process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/`
    : 'https://mockwave.vercel.app/';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? DEPLOYED_ORIGIN : '/',
  plugins: [
    react(),
    // Exposes the app as a mountable remote. RemoteApp.tsx (not main.tsx) is
    // the entry: it loads styles and does not call initTheme. The shell owns
    // [data-theme] on <html>.
    federation({
      name: 'mockwave',
      filename: 'remoteEntry.js',
      exposes: { './RemoteApp': './src/RemoteApp.tsx' },
      shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
      dts: false,
    }),
  ],
  root: 'app',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Vite 8 defaults to the oxc minifier, which mis-hoists a module-federation
    // bootstrap binding into a temporal-dead-zone reference and white-screens
    // a reloaded bundle. esbuild still minifies and keeps that binding valid.
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        kitdemo: fileURLToPath(new URL('./app/kitdemo.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 3003,
  },
}));
