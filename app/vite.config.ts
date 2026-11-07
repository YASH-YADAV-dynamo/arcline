import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  // /gt/* -> GeckoTerminal, same as the Caddy route in production (deploy/Caddyfile).
  server: {
    allowedHosts: true,
    cors: true,
    proxy: { '/gt': { target: 'https://api.geckoterminal.com', changeOrigin: true, rewrite: (p) => p.slice(3) } },
  },
  preview: {
    proxy: { '/gt': { target: 'https://api.geckoterminal.com', changeOrigin: true, rewrite: (p) => p.slice(3) } },
  },
})
