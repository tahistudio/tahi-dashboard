// Bundles src/scanner/index.ts (plus axe-core) into one browser IIFE that the
// worker serves as text at /__qa/scanner.js. Runs before every wrangler deploy
// (wrangler.jsonc "build") and on `npm run dev`.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('src/generated', { recursive: true })
await build({
  entryPoints: ['src/scanner/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  outfile: 'src/generated/scanner.bundle.js',
  legalComments: 'none',
})
