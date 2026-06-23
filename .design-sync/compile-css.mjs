// Compile app/globals.css (Tailwind v4 entry) into a plain stylesheet that the
// design-system bundle can ship. This is REQUIRED, not optional: the brand
// tokens live inside a Tailwind `@theme {}` block, which browsers ignore until
// Tailwind processes it into real `:root` custom properties. The output also
// carries the utility classes the heavier components (DataTable, FilterBar,
// BoardView, KanbanBoard) use via className.
//
// Run from the repo root:  node .design-sync/compile-css.mjs

import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync, writeFileSync } from 'node:fs'

const INPUT = 'app/globals.css'
const OUTPUT = '.design-sync/compiled.css'

const css = readFileSync(INPUT, 'utf8')
const result = await postcss([tailwind()]).process(css, { from: INPUT, to: OUTPUT })
writeFileSync(OUTPUT, result.css)

const kb = (result.css.length / 1024).toFixed(0)
const hasRootVar = /:root\b[^}]*--color-brand\b/.test(result.css) || /--color-brand:/.test(result.css)
const utilCount = (result.css.match(/^\.[a-z[]/gm) ?? []).length
console.log(`Compiled ${INPUT} -> ${OUTPUT} (${kb} KB)`)
console.log(`brand token emitted to CSS: ${hasRootVar}`)
console.log(`utility-ish rules: ~${utilCount}`)
