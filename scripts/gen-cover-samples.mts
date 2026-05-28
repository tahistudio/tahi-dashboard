import { generateCoverSvg } from '../lib/blog-cover-svg'
import { writeFileSync, mkdirSync } from 'node:fs'

const samples: Array<{ title: string; topic: string }> = [
  { title: 'Is Webflow Secure for Enterprise & SaaS?', topic: 'webflow security enterprise' },
  { title: 'Webflow vs Headless CMS: A Strategic Guide', topic: 'webflow vs headless comparison' },
  { title: 'Why Subscriptions Build Better Partnerships', topic: 'pricing subscription retainer' },
  { title: 'From Figma to Flawless: A Seamless Webflow Handoff', topic: 'design figma handoff' },
  { title: 'Building a Carbon Negative Website with Webflow', topic: 'sustainable carbon green' },
  { title: 'The Top 7 Webflow Agencies of 2028', topic: 'webflow agencies grow scale' },
  { title: 'How to Build Interactive Calculators in Webflow', topic: 'calculator interactive web app' },
  { title: 'Why Most Webflow Agencies Miss the AEO Opportunity', topic: 'seo aeo search rankings' },
]

const outDir = 'C:/Users/Work/Downloads/tahi-cover-samples'
mkdirSync(outDir, { recursive: true })

for (const s of samples) {
  const svg = generateCoverSvg(s)
  const fname = s.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) + '.svg'
  writeFileSync(`${outDir}/${fname}`, svg, 'utf8')
  console.log('wrote', fname)
}
console.log('Done →', outDir)
