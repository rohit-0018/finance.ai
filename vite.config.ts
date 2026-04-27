import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'icon-192.svg',
        'icon-512.svg',
        'icon-maskable.svg',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: '@paperai',
        short_name: 'paperai',
        description: 'AI-powered research knowledge hub + Life OS',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        background_color: '#ffffff',
        theme_color: '#6366f1',
        orientation: 'any',
        categories: ['productivity', 'education', 'utilities'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-512.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          {
            name: 'Thoughts',
            short_name: 'Thoughts',
            description: 'Quick brain dump',
            url: '/thoughts',
          },
          {
            name: 'Today',
            short_name: 'Today',
            description: 'Life · Today',
            url: '/life',
          },
          {
            name: 'Feed',
            short_name: 'Feed',
            description: 'Paper feed',
            url: '/',
          },
        ],
      },
      workbox: {
        // App shell + assets are precached. Network-first for navigations so
        // users pick up the latest build, stale-while-revalidate for static
        // assets so the app boots fast offline. API calls always hit network.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: ({ request }) =>
              ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https?:\/\/[^/]+\/(rest|auth|storage|realtime)\/v\d/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  envPrefix: ['VITE_', 'OPENAI_'],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
