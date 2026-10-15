/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * PWA configuration for Phase.
 *
 * The Web App Manifest lives in /public/manifest.json (so it is a plain,
 * editable file) and is linked from index.html. The plugin is therefore told
 * not to generate its own manifest (`manifest: false`) and only builds the
 * Workbox service worker that precaches the app shell for full offline use.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registered manually in src/lib/pwa.ts
      manifest: false,
      includeAssets: ['manifest.json', 'push-sw.js', 'icons/*.png', 'icons/*.svg', 'favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Push-notification handlers (public/push-sw.js).
        importScripts: ['push-sw.js'],
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'phase-google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'phase-google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.{ts,tsx}'],
  },
});
