/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE = '/mealheiro/';

// Strict CSP (ARCHITECTURE §7). Only injected in production builds: the dev server needs inline
// scripts and a websocket for hot reload.
const CSP = [
  "default-src 'self'",
  'connect-src https://api.github.com',
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'mealheiro-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        id: BASE,
        name: 'Mealheiro',
        short_name: 'Mealheiro',
        description: 'Personal spending and savings',
        lang: 'en',
        start_url: `${BASE}?source=pwa`,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f7f5',
        theme_color: '#0f766e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // M5: share a statement from the CGD app straight into Mealheiro (Chrome on Android).
        share_target: {
          action: `${BASE}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: ['application/pdf', '.pdf', 'text/csv', '.csv'] }],
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        importScripts: ['share-target-sw.js'],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    // ECharts (~670 KB) is its own lazily loaded chunk; the app shell stays under this.
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
