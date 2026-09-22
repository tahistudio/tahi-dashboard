import { render } from '@react-email/render'
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildSamplePreviews } from '@/lib/email-previews'

const out = 'C:/Users/Work/Projects/tahi-dashboard/.claude/qa/email-previews'
mkdirSync(out, { recursive: true })
const previews = buildSamplePreviews({ to: 'business@tahi.studio', firstName: 'Liam' })
const manifest: Record<string, unknown> = {}
for (const p of previews) {
  const html = await render(p.react, { pretty: false })
  writeFileSync(`${out}/${p.key}.html`, html)
  manifest[p.key] = { template: p.template, subject: p.subject, personalisation: p.personalisation, liveSender: p.liveSender }
  process.stdout.write(`${p.key}\t${html.length}\t${p.subject}\n`)
}
writeFileSync(`${out}/_manifest.json`, JSON.stringify(manifest, null, 2))
