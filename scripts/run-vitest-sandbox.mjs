import { readFileSync } from 'node:fs'
import { startVitest } from 'vitest/node'
import ts from 'typescript'

// Use worker threads and the TypeScript compiler when the sandbox cannot spawn
// esbuild or Vite's Windows realpath helper. Test code and assertions are unchanged.
const context = await startVitest('test', process.argv.slice(2), {
  root: process.cwd(),
  config: false,
  watch: false,
  pool: 'threads',
  maxWorkers: 2,
  minWorkers: 1,
  environment: 'node',
  globals: true,
  exclude: ['e2e/**', '**/node_modules/**', '.claude/**', 'mcp-server/**', 'workers/**', 'apps/recorder-tray/**', '.shipstudio/**'],
}, {
  esbuild: false,
  keepProcessEnv: true,
  resolve: { preserveSymlinks: true, alias: { '@': process.cwd() } },
  plugins: [{
    name: 'sandbox-typescript',
    enforce: 'pre',
    configResolved(config) {
      // Preserve runtime environment reads so vi.stubEnv exercises real branches.
      for (const key of Object.keys(config.define ?? {})) {
        if (/^(global\.|globalThis\.)?process\.env\./.test(key)) delete config.define[key]
      }
      for (const environment of Object.values(config.environments ?? {})) {
        environment.keepProcessEnv = true
        for (const key of Object.keys(environment.define ?? {})) {
          if (/^(global\.|globalThis\.)?process\.env\./.test(key)) delete environment.define[key]
        }
      }
    },
    load(id) {
      const file = id.split('?')[0]
      if (!/\.[cm]?tsx?$/.test(file) || file.includes('node_modules')) return null
      return {
        code: ts.transpileModule(readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }).outputText,
        map: null,
      }
    },
  }],
})
await context?.close()
