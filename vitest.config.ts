import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: [
      'e2e/**',
      '**/node_modules/**',
      '.claude/**',
      'mcp-server/**',
      'workers/**',
      // Ship Studio plugins are self-contained packages with their own
      // vitest + jsdom deps (run via their own config); don't sweep them
      // into the app's test run (mirrors mcp-server / workers above).
      '.shipstudio/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
