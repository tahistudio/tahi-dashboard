/**
 * Dark and feature `<PageChrome>` slides used to render near-invisible
 * text: renderers under this module and the schedule/proposal section
 * renderers hardcoded `#1f2c1a` (near-black) as a text colour regardless
 * of the surrounding slide theme, so a dark or feature-themed slide put
 * near-black text on a near-black background.
 *
 * The fix threads the resolved theme down as two CSS custom properties,
 * `--page-chrome-text` and `--page-chrome-card`, set once by <PageChrome>
 * and consumed by every renderer nested inside it. This file pins the
 * per-theme var values and sweeps the renderer source for regressions:
 * any literal `color: '#1f2c1a'` (as opposed to a `var(--page-chrome-text,
 * #1f2c1a)` fallback, which is fine) is a renderer that forgot to read
 * the theme.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageChrome, SectionHeader } from '@/components/tahi/deliverable'
import { ProposalSectionBlock } from '@/app/p/proposal/[token]/section-blocks'

Object.assign(globalThis, { React })

function styleAttr(html: string, tag = 'section'): string {
  return html.match(new RegExp(`<${tag}[^>]*style="([^"]*)"`))?.[1] ?? ''
}

describe('PageChrome theme vars', () => {
  it('light theme sets both vars to the ink/white pair', () => {
    const html = renderToStaticMarkup(<PageChrome theme="light"><span>x</span></PageChrome>)
    const style = styleAttr(html)
    expect(style).toContain('--page-chrome-text:#1f2c1a')
    expect(style).toContain('--page-chrome-card:#ffffff')
  })

  it('dark theme flips text to white and gives cards a translucent surface, not the light card colour', () => {
    const html = renderToStaticMarkup(<PageChrome theme="dark"><span>x</span></PageChrome>)
    const style = styleAttr(html)
    expect(style).toContain('--page-chrome-text:#ffffff')
    expect(style).toContain('--page-chrome-card:rgba(255, 255, 255, 0.06)')
  })

  it('feature theme also flips text to white with its own card tint', () => {
    const html = renderToStaticMarkup(<PageChrome theme="feature"><span>x</span></PageChrome>)
    const style = styleAttr(html)
    expect(style).toContain('--page-chrome-text:#ffffff')
    expect(style).toContain('--page-chrome-card:rgba(255, 255, 255, 0.08)')
  })

  it('defaults to light when no theme is given', () => {
    const html = renderToStaticMarkup(<PageChrome><span>x</span></PageChrome>)
    expect(styleAttr(html)).toContain('--page-chrome-text:#1f2c1a')
  })
})

describe('SectionHeader reads the ambient theme instead of hardcoding ink', () => {
  it('emits var(--page-chrome-text, ...) on both the title and the body, never a bare ink literal', () => {
    const html = renderToStaticMarkup(
      <SectionHeader eyebrow="EXAMPLE" title="A {{title}}" body="Some body copy." />,
    )
    expect(html).toContain('var(--page-chrome-text')
    expect(html).not.toContain('color:#1f2c1a')
  })
})

describe('no shared-chrome renderer regresses to a hardcoded near-black text colour', () => {
  // Scoped to the two files whose renderers sit directly on <PageChrome>'s
  // background with no card/slab of their own (deliverable/index.tsx,
  // schedule-section-renderers.tsx). section-blocks.tsx also has renderers
  // like Guarantee/RetainerOffer that intentionally paint their own
  // fixed-colour slab regardless of the page theme, so for those hardcoded
  // ink-on-a-fixed-light-tint is correct, so it is checked by rendering
  // the specific renderers that DO need the ambient theme, below.
  const files = [
    'components/tahi/deliverable/index.tsx',
    'components/tahi/schedule-section-renderers.tsx',
  ]

  it('never assigns color: \'#1f2c1a\' directly (a var() fallback to the same hex is fine)', () => {
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      // Matches `color: '#1f2c1a'` / `color: "#1f2c1a"` but not the
      // fallback form `var(--page-chrome-text, #1f2c1a)`.
      const bareLiteral = /color:\s*['"]#1f2c1a['"]/g
      const matches = src.match(bareLiteral) ?? []
      expect(matches, `${rel} still hardcodes a literal ink text colour: ${matches.join(', ')}`).toHaveLength(0)
    }
  })
})

describe('proposal SingleTestimonial and ValueAnchor read the ambient theme', () => {
  // These two renderers sit directly on PageChrome's background (no card
  // of their own for the testimonial; a light dashed "hiring separately"
  // card for the value anchor, whose background must swap with the text
  // colour so they never separate into white-on-white or ink-on-ink).
  it('SingleTestimonial never hardcodes the bare ink literal', () => {
    const html = renderToStaticMarkup(
      <ProposalSectionBlock section={{ id: '1', type: 'testimonial', title: null, subtitle: null, position: 0, data: JSON.stringify({ quote: 'Great work', author: 'Jane' }) }} />,
    )
    expect(html).not.toContain('color:#1f2c1a')
    expect(html).toContain('var(--page-chrome-text')
  })

  it('ValueAnchor pairs its card background and text colour behind the same var so they cannot separate', () => {
    const html = renderToStaticMarkup(
      <ProposalSectionBlock section={{ id: '2', type: 'value_anchor', title: null, subtitle: null, position: 0, data: JSON.stringify({ alternatives: [{ label: 'Dev', lo: 100, hi: 200 }] }) }} />,
    )
    expect(html).not.toContain('color:#1f2c1a')
    expect(html).toContain('var(--page-chrome-card')
    expect(html).toContain('var(--page-chrome-text')
  })
})
