import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Forward any request starting with /auth or /api to the backend
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    strictPort: true,
    allowedHosts: ['interactomes.scicore.unibas.ch'],
    hmr: false,
   /*
    hmr: {
      host: 'interactomes.scicore.unibas.ch',
      //hmr: { host: 'interactomes.scicore.unibas.ch', protocol: 'wss', clientPort: 443 } for https
      protocol: 'ws',
      clientPort: 80,
    },*/
  },
  preview: {
    allowedHosts: ['interactomes.scicore.unibas.ch'],
  }
})
