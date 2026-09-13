// Compile docs/superpowers/plans/2026-09-14-design-review-for-liam.md from a
// design-pass-build workflow journal. Usage:
//   node scripts/design-review-compile.mjs <journal.jsonl> [out.md]
// The journal holds one {type:'result'} line per finished agent. Designers
// return {module, filesWritten, previewPath, pageKeys, covered, leftOut,
// openQuestions}; critics return {module, overall, pages:[{pageKey, verdict,
// issues, screenshots}]}; the wiring agent returns plain text. The latest
// result per module wins (the revision replaces the first design, the
// re-critique replaces the first critique).
import fs from 'node:fs'

const [journalPath, outPath = 'docs/superpowers/plans/2026-09-14-design-review-for-liam.md'] = process.argv.slice(2)
if (!journalPath) { console.error('usage: node scripts/design-review-compile.mjs <journal.jsonl> [out.md]'); process.exit(1) }

const PROJECT = 'https://claude.ai/design/p/57bf60cf-5e6d-450f-9e2f-e25c8d12fd66'
const norm = (m) => String(m || '').toLowerCase().replace(/\s*\(.*$/, '').replace(/^studio-/, '').replace(/^studio /, '').trim()
const ALIASES = { 'home': 'overview', 'studio-home': 'overview', 'settings': 'settings', 'studio-settings': 'settings' }
const key = (m) => ALIASES[norm(m)] || norm(m)

const designs = new Map(), critiques = new Map(), critiqueHistory = new Map()
let wiring = null
for (const line of fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)) {
  let e; try { e = JSON.parse(line) } catch { continue }
  if (e.type !== 'result') continue
  const r = (e.result && e.result.result) || e.result || e.value
  if (!r) continue
  if (typeof r === 'string') { wiring = r; continue }
  if (r.filesWritten) designs.set(key(r.module), r)
  else if (r.pages && r.overall) {
    const k = key(r.module)
    critiques.set(k, r)
    critiqueHistory.set(k, [...(critiqueHistory.get(k) || []), r.overall])
  }
}

const fileLink = (p) => `${PROJECT}?file=${encodeURIComponent(p).replace(/%20/g, '+')}`
const lines = []
lines.push('# Design pass review for Liam (2026-09-14, overnight)')
lines.push('')
lines.push('Every dashboard surface was designed in Claude Design from the requirement documents under docs/superpowers/design/requirements, by an opus designer, then screenshot-critiqued at 1440 and 375 in light and dark by a sonnet critic, then revised once where the critic said FIX or REDO. Nothing is ported. Tick a module once you have looked at it; mark it SHIP (port as is), FIX (list what to change) or REDO.')
lines.push('')
lines.push(`Project: ${PROJECT} (open a file with ?file=<name>; the app shell is "Tahi App Shell.html", audience and device through the Tweaks pill). Preview pages per module are listed below; open them the same way.`)
lines.push('')
const modules = [...designs.keys()].sort()
lines.push('## Summary')
lines.push('')
lines.push('| | Module | Pages | First verdict | Final verdict |')
lines.push('|---|---|---|---|---|')
for (const m of modules) {
  const d = designs.get(m); const hist = critiqueHistory.get(m) || []
  lines.push(`| [ ] | ${m} | ${d.pageKeys.length} | ${hist[0] || 'not critiqued'} | ${hist[hist.length - 1] || 'not critiqued'} |`)
}
lines.push('')
for (const m of modules) {
  const d = designs.get(m); const c = critiques.get(m)
  lines.push(`## ${m}`)
  lines.push('')
  lines.push(`- Preview: ${fileLink(d.previewPath)}`)
  lines.push(`- Files: ${d.filesWritten.map(f => `${f.path} (${Math.round(f.bytes / 1024)} KB)`).join(', ')}`)
  lines.push(`- Pages: ${d.pageKeys.join(', ')}`)
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + ' (more in the journal)' : t }
  lines.push(`- Covered: ${clip(d.covered, 600)}`)
  if (d.leftOut && !/^(nothing|none)/i.test(d.leftOut.trim())) lines.push(`- Left out: ${clip(d.leftOut, 500)}`)
  if (c) {
    lines.push(`- Critic: ${c.overall}${(critiqueHistory.get(m) || []).length > 1 ? ` (first pass ${critiqueHistory.get(m)[0]})` : ''}`)
    const notShip = c.pages.filter(p => p.verdict !== 'SHIP')
    if (notShip.length) {
      lines.push('- Still open after the revision:')
      for (const p of notShip) for (const i of p.issues.slice(0, 6)) lines.push(`  - ${p.pageKey} (${p.verdict}): ${i}`)
    }
  }
  if (d.openQuestions && d.openQuestions.length) {
    lines.push('- Questions for you:')
    for (const q of d.openQuestions) lines.push(`  - ${q}`)
  }
  lines.push('')
}
lines.push('## Shell wiring')
lines.push('')
lines.push(wiring ? wiring.replace(/https:\/\/[^\s)]*claudeusercontent[^\s)]*/g, '[serve url removed]') : 'The wiring step did not return; the new modules may not be in the shell yet.')
lines.push('')
let out = lines.join('\n')
out = out.replace(/ [—–] /g, ', ').replace(/[—–]/g, '-')
fs.writeFileSync(outPath, out)
console.log(`wrote ${outPath}: ${modules.length} modules, ${critiques.size} critiqued, wiring ${wiring ? 'present' : 'missing'}`)
