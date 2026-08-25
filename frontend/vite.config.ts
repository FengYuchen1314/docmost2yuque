import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src-vue/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'src/**'],
    server: { deps: { inline: [/vuetify/] } },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/actuator': 'http://127.0.0.1:8080',
    },
  },
  build: {
    // Public source maps expose the complete client source from the production
    // web image. Enable them only in a private debugging build if needed.
    sourcemap: false,
  },
})
