/**
 * <GanttCardStack>, the narrow-viewport (<720px) alternative to
 * <GanttGrid> used by the public schedule viewer's GanttSection. The
 * fixed-width grid (64rem minWidth, a lone overflow-x-auto) is a
 * pinch-scroll strip on a phone; below the breakpoint the section swaps
 * to a card per row instead, matching RiskRegisterSection's existing
 * "stack as cards on mobile" pattern.
 */
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttCardStack, type GanttRow } from '@/components/tahi/gantt-grid'

Object.assign(globalThis, { React })

const rows: GanttRow[] = [
  { id: 'h1', rowType: 'section_header', label: 'MAIN BUILD PHASES', owner: null, startWeek: null, endWeek: null, riskFlag: 0, position: 0 },
  { id: 't1', rowType: 'task', label: 'Discovery', owner: 'joint', startWeek: 1, endWeek: 2, riskFlag: 0, position: 1 },
  { id: 't2', rowType: 'task', label: 'Build', owner: 'tahi', startWeek: 3, endWeek: 6, riskFlag: 1, position: 2 },
  { id: 'g1', rowType: 'gate', label: 'Sitemap gate', owner: null, startWeek: 3, endWeek: 3, riskFlag: 0, position: 3 },
  { id: 't3', rowType: 'task', label: 'No dates yet', owner: 'client', startWeek: null, endWeek: null, riskFlag: 0, position: 4 },
]

describe('GanttCardStack', () => {
  it('never renders a table (that is the desktop grid, not the mobile stack)', () => {
    const html = renderToStaticMarkup(<GanttCardStack rows={rows} numberOfWeeks={6} />)
    expect(html).not.toContain('role="table"')
    expect(html).not.toContain('role="row"')
  })

  it('renders one card per row, plus the section-header band, with the phase label on each', () => {
    const html = renderToStaticMarkup(<GanttCardStack rows={rows} numberOfWeeks={6} />)
    expect(html).toContain('MAIN BUILD PHASES')
    expect(html).toContain('Discovery')
    expect(html).toContain('Build')
    expect(html).toContain('Sitemap gate')
  })

  it('labels a gate row "Gate" instead of an owner pill', () => {
    const html = renderToStaticMarkup(<GanttCardStack rows={[rows[3]]} numberOfWeeks={6} />)
    expect(html).toContain('>Gate<')
  })

  it('shows the week range for a row with a valid range, and a placeholder for one without', () => {
    const html = renderToStaticMarkup(<GanttCardStack rows={rows} numberOfWeeks={6} />)
    expect(html).toContain('Weeks 1 to 2')
    expect(html).toContain('Weeks 3 to 6')
    expect(html).toContain('No timeline set')
  })

  it('renders an empty state instead of an empty card list', () => {
    const html = renderToStaticMarkup(<GanttCardStack rows={[]} numberOfWeeks={6} />)
    expect(html).toContain('No rows yet')
  })
})
