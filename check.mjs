import { readFileSync } from 'node:fs'
const dir = 'C:/Users/Work/Projects/tahi-dashboard/.claude/qa/email-previews'
const manifest = JSON.parse(readFileSync(`${dir}/_manifest.json`, 'utf8'))
const strip = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
for (const [key, m] of Object.entries(manifest)) {
  const html = readFileSync(`${dir}/${key}.html`, 'utf8')
  const text = strip(html)
  const issues = []
  if (/[\u2013\u2014]/.test(html)) issues.push('DASH: ' + JSON.stringify(html.match(/.{0,30}[\u2013\u2014].{0,30}/g)))
  const addr = text.match(/\b(Street|Road|\bAve\b|Avenue|T[āa]maki|Auckland|\b\d{4}\b(?![\d-]))/g)
  if (addr) issues.push('ADDRESS?: ' + JSON.stringify([...new Set(addr)]) + ' ctx=' + JSON.stringify(text.match(/.{0,25}(Street|Road|Ave\b|Avenue|T[āa]maki|Auckland).{0,25}/g)))
  if (!text.includes('Tahi Studio, Whanganui, New Zealand')) issues.push('NO FOOTER LINE')
  if (!/#1E2A1B/i.test(html)) issues.push('NO FOREST NAV')
  if (!/tahi-logo\.png/.test(html)) issues.push('NO WORDMARK IMG')
  if (!/#425F39/i.test(html)) issues.push('NO BRAND-DARK BUTTON COLOUR')
  if (/undefined|\$\{|\[object Object\]|NaN\b|Invalid Date/.test(text)) issues.push('UNRESOLVED: ' + JSON.stringify(text.match(/.{0,30}(undefined|\$\{|\[object Object\]|NaN\b|Invalid Date).{0,30}/g)))
  for (const [label, val] of Object.entries(m.personalisation)) {
    if (!text.includes(val) && !html.includes(val)) issues.push(`MISSING ${label}: ${JSON.stringify(val)}`)
  }
  const aud = text.match(/Internal\. Clients never receive this email\.|This is an automated message\.|Sent to [^ ]+ because you have a Tahi account\.|Sent to you because you have a Tahi account\./)
  const navLabel = (html.match(/<p[^>]*color:#93C98A[^>]*>([^<]*)<\/p>/i) || [])[1]
  const kicker = (text.match(/Tahi (?:Client portal|[^ ]+ ?[^ ]*) /) || [])[0]
  console.log(`${key}\t[${m.template}] aud="${aud ? aud[0] : 'NONE'}" nav="${navLabel ?? '?'}"`)
  for (const i of issues) console.log('   ! ' + i)
}
