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
  esbuild: {
    // The app's tsconfig sets `jsx: 'preserve'` so Next owns the transform,
    // which leaves esbuild on the CLASSIC runtime here and makes every .tsx
    // rendered in a test throw "React is not defined" (React 19 ships no
    // global). The email templates are rendered for real in
    // lib/email-previews.test.ts, so tests use the automatic runtime, which is
    // what Next compiles them with in production anyway.
    jsx: 'automatic',
  },
})
