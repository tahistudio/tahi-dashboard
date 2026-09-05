import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayoutGrid, Rows } from 'lucide-react'
import {
  SegmentedControl,
  nextSegmentIndex,
  pillStyle,
  segmentTabStop,
  type SegmentedControlOption,
} from '@/components/tahi/segmented-control'
import { SlideSeg } from '@/components/tahi/settings/primitives'

// The repo's Vitest runs in the `node` environment with no DOM and no
// @testing-library (see data-table-expand.test.ts), so these cover the
// server markup the control hydrates from plus the pure rules the
// interactive paths delegate to: keyboard cycling and pill geometry. The
// live half (pill follows a click with no mount slide-in, arrow keys move
// the selection, a disabled option stays unselected) runs in Playwright
// against the /design-system showcase: e2e/segmented-control.spec.ts.
//
// vitest.config.ts sets no jsx runtime, so Vite compiles JSX through the
// classic transform here and a component without its own React namespace
// import (settings/primitives.tsx) needs the global to render. Test-only.
Object.assign(globalThis, { React })

type View = 'list' | 'kanban' | 'workload'

const OPTIONS: SegmentedControlOption<View>[] = [
  { value: 'list', label: 'List', icon: <Rows size={14} aria-hidden="true" /> },
  { value: 'kanban', label: 'Kanban', icon: <LayoutGrid size={14} aria-hidden="true" /> },
  { value: 'workload', label: 'Workload', disabled: true, title: 'Tahi only' },
]

const noop = () => {}

/** Every <button ...> opening tag in document order. */
function buttonTags(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? []
}

function trackTag(html: string): string {
  return html.match(/<div[^>]*class="tahi-seg[^"]*"[^>]*>/)?.[0] ?? ''
}

function pillTag(html: string): string {
  return html.match(/<span[^>]*class="tahi-seg-pill"[^>]*>/)?.[0] ?? ''
}

describe('SegmentedControl markup', () => {
  it('renders a tablist with roving tabindex and the active tab selected', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="Requests view" value="kanban" onChange={noop} options={OPTIONS} />,
    )
    const track = trackTag(html)
    expect(track).toContain('role="tablist"')
    expect(track).toContain('aria-label="Requests view"')

    const tabs = buttonTags(html)
    expect(tabs).toHaveLength(3)
    tabs.forEach(tab => expect(tab).toContain('role="tab"'))

    expect(tabs[0]).toContain('aria-selected="false"')
    expect(tabs[0]).toContain('tabindex="-1"')
    expect(tabs[1]).toContain('aria-selected="true"')
    expect(tabs[1]).toContain('data-active="true"')
    expect(tabs[1]).toContain('tabindex="0"')
  })

  it('puts the focus ring class on every option and never an inline box-shadow', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    buttonTags(html).forEach(tab => {
      expect(tab).toContain('tahi-focus-ring')
      expect(tab).not.toMatch(/box-shadow/)
    })
  })

  it('marks a disabled option aria-disabled, out of the tab order, with its title', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    const workload = buttonTags(html)[2]
    expect(workload).toContain('aria-disabled="true"')
    expect(workload).toContain('tabindex="-1"')
    expect(workload).toContain('title="Tahi only"')
    expect(workload).not.toContain(' disabled')
  })

  it('keeps the tab stop on the active option even when that option is disabled', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="radiogroup" ariaLabel="View" value="workload" onChange={noop} options={OPTIONS} />,
    )
    const tabs = buttonTags(html)
    expect(tabs[2]).toContain('aria-checked="true"')
    expect(tabs[2]).toContain('aria-disabled="true"')
    expect(tabs[2]).toContain('tabindex="0"')
    expect(tabs[0]).toContain('tabindex="-1"')
    expect(tabs[1]).toContain('tabindex="-1"')
  })

  it('hides the pill until the first measurement so hydration never jumps', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    const pill = pillTag(html)
    expect(pill).toContain('aria-hidden="true"')
    expect(pill).toContain('data-state="measuring"')
    expect(pill).toContain('visibility:hidden')
  })

  it('uses radio semantics for radiogroup and pressed semantics for group', () => {
    const radio = renderToStaticMarkup(
      <SegmentedControl role="radiogroup" ariaLabel="Size" value="list" onChange={noop} options={OPTIONS} />,
    )
    expect(trackTag(radio)).toContain('role="radiogroup"')
    expect(buttonTags(radio)[0]).toContain('role="radio"')
    expect(buttonTags(radio)[0]).toContain('aria-checked="true"')
    expect(buttonTags(radio)[1]).toContain('aria-checked="false"')

    const group = renderToStaticMarkup(
      <SegmentedControl ariaLabel="Filter" value="kanban" onChange={noop} options={OPTIONS} />,
    )
    expect(trackTag(group)).toContain('role="group"')
    expect(buttonTags(group)[1]).toContain('aria-pressed="true"')
    expect(buttonTags(group)[0]).toContain('aria-pressed="false"')
    expect(buttonTags(group)[0]).not.toContain('role=')
    expect(buttonTags(group)[0]).not.toContain('tabindex="-1"')
  })

  it('carries the name on title and aria-label when the label hides below a breakpoint', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} iconOnlyBelow="lg" />,
    )
    expect(trackTag(html)).toContain('tahi-seg-icon-lg')
    const [list] = buttonTags(html)
    expect(list).toContain('aria-label="List"')
    expect(list).toContain('title="List"')
    expect(html).toContain('class="tahi-seg-label hidden lg:inline"')

    const plain = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    expect(buttonTags(plain)[0]).not.toContain('aria-label=')
    expect(plain).not.toContain('lg:inline')
    expect(plain).toContain('class="tahi-seg-label"')
  })

  it('points a tab at its panel with aria-controls when the option names one', () => {
    const withPanels = OPTIONS.map(o => ({ ...o, panelId: `${o.value}-panel` }))
    const html = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={withPanels} />,
    )
    const tabs = buttonTags(html)
    expect(tabs[0]).toContain('aria-controls="list-panel"')
    expect(tabs[1]).toContain('aria-controls="kanban-panel"')

    const plain = renderToStaticMarkup(
      <SegmentedControl role="tablist" ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    expect(plain).not.toContain('aria-controls')
  })

  it('exposes size, fill and caller classes on the track', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl ariaLabel="Size" value="list" onChange={noop} options={OPTIONS} size="sm" fill className="extra" />,
    )
    const track = trackTag(html)
    expect(track).toContain('tahi-seg-sm')
    expect(track).toContain('tahi-seg-fill')
    expect(track).toContain('extra')
    expect(trackTag(renderToStaticMarkup(
      <SegmentedControl ariaLabel="Size" value="list" onChange={noop} options={OPTIONS} />,
    ))).toContain('tahi-seg-md')
  })

  it('wraps the option icon in the tint slot', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl ariaLabel="View" value="list" onChange={noop} options={OPTIONS} />,
    )
    expect(html.match(/class="tahi-seg-ic"/g)).toHaveLength(2)
  })
})

describe('pillStyle', () => {
  it('hides the pill before it has a measurement', () => {
    expect(pillStyle(null)).toEqual({ visibility: 'hidden' })
  })

  it('follows the active button by offset and width', () => {
    expect(pillStyle({ left: 41, width: 72 })).toEqual({ transform: 'translateX(41px)', width: '72px' })
  })
})

describe('segmentTabStop', () => {
  it('parks the tab stop on the active option', () => {
    expect(segmentTabStop(OPTIONS, 'list')).toBe(0)
    expect(segmentTabStop(OPTIONS, 'kanban')).toBe(1)
  })

  it('keeps it there when the active option is disabled', () => {
    expect(segmentTabStop(OPTIONS, 'workload')).toBe(2)
    const allOff = OPTIONS.map(o => ({ ...o, disabled: true }))
    expect(segmentTabStop(allOff, 'kanban')).toBe(1)
  })

  it('falls back to the first enabled option when no option holds the value', () => {
    const orphan = 'timeline' as View
    expect(segmentTabStop(OPTIONS, orphan)).toBe(0)
    expect(segmentTabStop(OPTIONS.map((o, i) => ({ ...o, disabled: i === 0 })), orphan)).toBe(1)
  })

  it('reports no tab stop when nothing matches and nothing is enabled', () => {
    const allOff = OPTIONS.map(o => ({ ...o, disabled: true }))
    expect(segmentTabStop(allOff, 'timeline' as View)).toBe(-1)
  })
})

describe('nextSegmentIndex', () => {
  it('moves right and left between enabled options', () => {
    expect(nextSegmentIndex(OPTIONS, 0, 'ArrowRight')).toBe(1)
    expect(nextSegmentIndex(OPTIONS, 1, 'ArrowLeft')).toBe(0)
  })

  it('cycles past the ends and skips disabled options', () => {
    expect(nextSegmentIndex(OPTIONS, 1, 'ArrowRight')).toBe(0)
    expect(nextSegmentIndex(OPTIONS, 0, 'ArrowLeft')).toBe(1)
  })

  it('jumps to the first and last enabled option on Home and End', () => {
    expect(nextSegmentIndex(OPTIONS, 1, 'Home')).toBe(0)
    expect(nextSegmentIndex(OPTIONS, 0, 'End')).toBe(1)
  })

  it('ignores keys it does not own and a strip with nothing enabled', () => {
    expect(nextSegmentIndex(OPTIONS, 0, 'Enter')).toBeNull()
    expect(nextSegmentIndex(OPTIONS, 0, 'ArrowDown')).toBeNull()
    const allOff = OPTIONS.map(o => ({ ...o, disabled: true }))
    expect(nextSegmentIndex(allOff, 0, 'ArrowRight')).toBeNull()
    expect(nextSegmentIndex(allOff, 0, 'Home')).toBeNull()
  })

  it('stays put when the current option is the only enabled one', () => {
    const onlyList = OPTIONS.map((o, i) => ({ ...o, disabled: i !== 0 }))
    expect(nextSegmentIndex(onlyList, 0, 'ArrowRight')).toBe(0)
  })
})

describe('stylesheet contract', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

  it('turns the pill transition off under prefers-reduced-motion', () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1])
    const pillBlock = blocks.find(b => b.includes('.tahi-seg-pill'))
    expect(pillBlock).toBeDefined()
    expect(pillBlock).toMatch(/transition:\s*none/)
  })

  it('only transitions the pill once the component has marked it ready', () => {
    const rule = css.match(/\.tahi-seg-pill\[data-state="ready"\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/transform 360ms var\(--ease-out\)/)
    expect(rule).toMatch(/width 360ms var\(--ease-out\)/)
    const base = css.match(/\n\.tahi-seg-pill\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(base).not.toMatch(/transition/)
  })

  it('keeps a disabled active option as legible as an enabled one', () => {
    const rule = css.match(/\.tahi-seg-b\[data-active="true"\]\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/color:\s*var\(--color-text\)/)
    expect(rule).toMatch(/opacity:\s*1/)
    // It ties with the :hover rule (one class plus two simple selectors on
    // both sides), so it only wins by coming after it.
    expect(css.indexOf('.tahi-seg-b[data-active="true"][aria-disabled="true"]'))
      .toBeGreaterThan(css.indexOf('.tahi-seg-b[aria-disabled="true"]:hover'))
  })

  it('lets fill columns shrink below a long label instead of widening the track', () => {
    const fill = css.match(/\n\.tahi-seg-fill\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(fill).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/)
    const button = css.match(/\.tahi-seg-fill \.tahi-seg-b\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(button).toMatch(/min-width:\s*0/)
    const label = css.match(/\.tahi-seg-fill \.tahi-seg-label\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('SlideSeg wrapper', () => {
  it('maps opts onto the shared control and keeps its tablist behaviour', () => {
    const html = renderToStaticMarkup(
      <SlideSeg
        role="tablist"
        optRole="tab"
        ariaLabel="Subject class"
        value="clients"
        onChange={noop}
        opts={[
          { v: 'team', label: 'Team members', icon: <Rows size={16} aria-hidden="true" /> },
          { v: 'clients', label: 'Clients' },
        ]}
      />,
    )
    expect(trackTag(html)).toContain('role="tablist"')
    expect(trackTag(html)).toContain('aria-label="Subject class"')
    const tabs = buttonTags(html)
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toContain('role="tab"')
    expect(tabs[1]).toContain('aria-selected="true"')
    expect(html).toContain('class="tahi-seg-ic"')
  })

  it('defaults to a plain group when no role is given', () => {
    const html = renderToStaticMarkup(
      <SlideSeg ariaLabel="Portal role" value="member" onChange={noop} opts={[{ v: 'admin', label: 'Admin' }, { v: 'member', label: 'Member' }]} />,
    )
    expect(trackTag(html)).toContain('role="group"')
    expect(buttonTags(html)[1]).toContain('aria-pressed="true"')
  })
})
