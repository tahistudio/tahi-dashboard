/**
 * Two of the T3.4/T3.5 public-viewer bugs, both in proposal-viewer.tsx:
 *
 * 1. At 375px, three variant tabs clipped inside an `overflow: hidden`,
 *    `flexWrap: nowrap` strip with no scroll affordance, so the third
 *    package was permanently unreachable on a phone.
 * 2. A failed accept/decline/question submit called the browser's
 *    `alert()`, the one thing CLAUDE.md's "app dialog pattern" rule bans
 *    on the most expensive page the studio owns.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VariantTabStrip } from '@/app/p/proposal/[token]/proposal-viewer'

Object.assign(globalThis, { React })

const VARIANTS = [
  { id: 'v1', name: 'Starter', tagline: null, oneOffAmount: 0, monthlyAmount: 500, currency: 'USD', scopeHtml: null, pricingNotesHtml: null, timelineScheduleId: null, ctaLabel: null, isFeatured: 0, position: 0 },
  { id: 'v2', name: 'Growth', tagline: null, oneOffAmount: 0, monthlyAmount: 1500, currency: 'USD', scopeHtml: null, pricingNotesHtml: null, timelineScheduleId: null, ctaLabel: null, isFeatured: 1, position: 1 },
  { id: 'v3', name: 'Scale', tagline: null, oneOffAmount: 0, monthlyAmount: 4000, currency: 'USD', scopeHtml: null, pricingNotesHtml: null, timelineScheduleId: null, ctaLabel: null, isFeatured: 0, position: 2 },
]

function trackStyle(html: string): string {
  return html.match(/<div[^>]*role="tablist"[^>]*style="([^"]*)"/)?.[1] ?? ''
}

describe('VariantTabStrip at 375px', () => {
  it('scrolls instead of clipping: overflow-x auto, not overflow hidden', () => {
    const html = renderToStaticMarkup(
      <VariantTabStrip variants={VARIANTS} activeVariantId="v1" onSelect={() => {}} />,
    )
    const style = trackStyle(html)
    expect(style).toContain('overflow-x:auto')
    expect(style).not.toContain('overflow:hidden')
  })

  it('gives every tab a scroll-snap stop so the third package settles into view', () => {
    const html = renderToStaticMarkup(
      <VariantTabStrip variants={VARIANTS} activeVariantId="v1" onSelect={() => {}} />,
    )
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? []
    expect(tabs).toHaveLength(3)
    tabs.forEach(tab => expect(tab).toContain('scroll-snap-align:start'))
  })

  it('renders all three packages regardless of viewport (no tab is dropped from markup)', () => {
    const html = renderToStaticMarkup(
      <VariantTabStrip variants={VARIANTS} activeVariantId="v1" onSelect={() => {}} />,
    )
    expect(html).toContain('Starter')
    expect(html).toContain('Growth')
    expect(html).toContain('Scale')
  })

  it('keeps each tab at the existing 2.75rem minimum touch target', () => {
    const html = renderToStaticMarkup(
      <VariantTabStrip variants={VARIANTS} activeVariantId="v2" onSelect={() => {}} />,
    )
    const tabs = html.match(/<button[^>]*role="tab"[^>]*style="([^"]*)"/g) ?? []
    tabs.forEach(tab => expect(tab).toContain('min-height:2.75rem'))
  })
})

describe('proposal-viewer.tsx has no raw browser alert() on the accept flow', () => {
  it('uses the toast pattern instead of window.alert', () => {
    const src = readFileSync(
      join(process.cwd(), 'app', 'p', 'proposal', '[token]', 'proposal-viewer.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/[^.]\balert\(/)
    expect(src).toContain('showToast(')
    expect(src).toContain("from '@/components/tahi/toast'")
  })
})
