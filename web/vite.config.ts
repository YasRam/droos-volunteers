import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// BASE_PATH is set by the GitHub Pages workflow (e.g. /droos-volunteers/); '/' elsewhere.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo-mark.png', 'resala.png'],
      manifest: {
        name: 'نشاط دروس التقوية',
        short_name: 'دروس التقوية',
        description: 'متابعة متطوعين نشاط دروس التقوية — فرع إسكندرية',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#00838f',
        background_color: '#f4f7f8',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Phone notifications: push + notificationclick handlers (public/push-sw.js)
        importScripts: ['push-sw.js'],
        // Big files that only some people open load on demand (then stay cached), so the first visit stays light
        globIgnores: ['**/exceljs*.js', '**/Stats-*.js', '**/en-*.js', '**/templates/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'assets', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
