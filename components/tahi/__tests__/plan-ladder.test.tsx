/**
 * The Services plan ladder, in the shell.
 *
 * The repo's Vitest runs in the `node` environment with no DOM and no
 * @testing-library (see invoice-detail.test.tsx), so this covers the server
 * markup the page hydrates from: the ladder on its own in both of its states,
 * and the whole Services page rendered through the real component with SWR
 * answering from a `fallback` map.
 *
 * What it guards is the CB1 port. The ladder is the one place on a client
 * surface that talks about plans the client is not on, so the rules that keep
 * it honest are the ones worth a test:
 *
 *   no price, no Start, nothing on a rung to click
 *   a figure only on the rung the client stands on
 *   the nudge appears only when their own usage earns it
 *   the plan rows leave the catalogue grid once the ladder tells that story
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SWRConfig } from 'swr'
import { PlanLadder, PlanLadderSkeleton } from '@/components/tahi/portal/services/plan-ladder'
import { ladder, planPressure, rungLive } from '@/lib/plan-ladder'
import { PortalServices } from '@/components/tahi/portal/services/portal-services'

const NOOP = () => {}

function renderLadder(planKey: string, opts: {
  trackCount?: number | null
  avgTurnaroundDays?: number | null
  openCount?: number | null
  orgName?: string
} = {}): string {
  const view = ladder(planKey)
  if (!view) throw new Error(`no ladder for ${planKey}`)
  return renderToStaticMarkup(
    <PlanLadder
      view={view}
      live={rungLive({ trackCount: opts.trackCount, avgTurnaroundDays: opts.avgTurnaroundDays })}
      pressure={planPressure({ trackCount: opts.trackCount, openCount: opts.openCount })}
      orgName={opts.orgName}
      onTalk={NOOP}
    />,
  )
}

describe('the ladder itself', () => {
  it('shows the rung below, the rung they stand on, and the rung above', () => {
    const html = renderLadder('maintain', { trackCount: 1 })
    expect(html).toContain('One step down')
    expect(html).toContain('You are here')
    expect(html).toContain('One step up')
    expect(html).toContain('Tune')
    expect(html).toContain('Maintain')
    expect(html).toContain('Scale')
    expect(html).not.toContain('Launch')
  })

  it('marks only the client\'s own rung as current', () => {
    const html = renderLadder('scale', { trackCount: 2 })
    expect(html.match(/aria-current="true"/g) ?? []).toHaveLength(1)
  })

  it('never prints a price, a Start or an order path', () => {
    const html = renderLadder('scale', { trackCount: 2, openCount: 5 })
    expect(html).not.toContain('$')
    expect(html).not.toContain('per month')
    expect(html).not.toMatch(/>\s*(Start|Upgrade|Buy|Choose|Order|Get started)/i)
  })

  it('puts the client\'s own figures on their rung and words on the neighbours', () => {
    const html = renderLadder('scale', { trackCount: 2, avgTurnaroundDays: 6 })
    expect(html).toContain('2 tracks, building at the same time.')
    expect(html).toContain('6 days from asked to delivered, averaged over your own work.')
    // The neighbours keep their studio written sentences.
    expect(html).toContain('One track, always moving.')
    expect(html).toContain('More than two things at once')
  })

  it('keeps the rung\'s words when nothing has been delivered to measure', () => {
    const html = renderLadder('scale', { trackCount: 2, avgTurnaroundDays: null })
    expect(html).toContain('When one is delivered, the next in your queue pulls in on its own.')
    expect(html).not.toContain('averaged over your own work')
  })

  it('names the client when the page knows who they are', () => {
    expect(renderLadder('maintain', { orgName: 'Giant Group' }))
      .toContain('what either would mean for Giant Group')
    expect(renderLadder('maintain')).toContain('what either would mean for you')
  })

  it('gives the lowest and highest plans two rungs, not a filler third', () => {
    const low = renderLadder('tune', { trackCount: 1 })
    expect(low).not.toContain('One step down')
    expect(low).toContain('One step up')
    const high = renderLadder('launch', { trackCount: 3 })
    expect(high).toContain('One step down')
    expect(high).not.toContain('One step up')
  })

  it('keeps hourly and one off projects named but off the ladder', () => {
    expect(renderLadder('maintain')).toContain('Two kinds of work sit off this ladder entirely')
  })
})

describe('the upsell is a consequence, not a fixture', () => {
  it('says out loud that nothing is pushing when nothing is', () => {
    const html = renderLadder('scale', { trackCount: 2, openCount: 2 })
    expect(html).toContain('Nothing in your numbers says you are pushing against Scale')
    expect(html).not.toContain('Talk about moving up')
  })

  it('appears, quoting the number that put it there, when the queue overflows', () => {
    const html = renderLadder('scale', { trackCount: 2, openCount: 5 })
    expect(html).toContain('You have been sitting right on the edge of Scale')
    expect(html).toContain('There are 5 things waiting and 2 tracks to pull them onto')
    expect(html).toContain('Talk about moving up')
    expect(html).toContain('a conversation changes nothing on your bill')
  })

  it('asks about how it is running, not about moving up, at the top of the ladder', () => {
    const html = renderLadder('launch', { trackCount: 2, openCount: 6 })
    expect(html).toContain('Talk about how this is running')
    expect(html).not.toContain('Talk about moving up')
  })

  it('disables the ask while an admin is only looking', () => {
    const view = ladder('scale')!
    const html = renderToStaticMarkup(
      <PlanLadder
        view={view}
        live={rungLive({ trackCount: 2 })}
        pressure={planPressure({ trackCount: 2, openCount: 4 })}
        readOnly
        readOnlyReason="Read only while viewing as a client"
        onTalk={NOOP}
      />,
    )
    expect(html).toContain('disabled')
    expect(html).toContain('Read only while viewing as a client')
  })
})

describe('first paint', () => {
  it('claims the ladder\'s shape rather than leaving a hole', () => {
    const html = renderToStaticMarkup(<PlanLadderSkeleton />)
    expect(html).toContain('tahi-shimmer')
    expect(html).toContain('md:grid-cols-3')
  })
})

// ── The whole page ───────────────────────────────────────────────────────────

const SUBSCRIPTION = {
  clientType: 'retainer' as const,
  subscription: {
    planType: 'scale',
    planLabel: 'Scale',
    monthlyRate: 2000,
    currency: 'GBP',
    customRate: true,
    trackCount: 2,
    nextInvoiceDate: '2026-10-01',
    createdAt: '2026-04-30T00:00:00.000Z',
    addonDetails: [],
  },
  plans: [
    { id: 'maintain', name: 'Maintain' },
    { id: 'scale', name: 'Scale' },
  ],
}

const SERVICES = {
  items: [
    { id: 's-1', name: 'Maintain', description: 'PLAN ROW COPY, already told by the ladder.', category: 'service', isRecurring: 1 },
    { id: 's-2', name: 'Scale', description: 'PLAN ROW COPY, already told by the ladder.', category: 'service', isRecurring: 1 },
    { id: 's-3', name: 'Lottie animation', description: 'A moving mark for the hero.', category: 'addon', isRecurring: 0 },
  ],
}

function renderPage(capacity: Record<string, unknown>, subscription: unknown = SUBSCRIPTION): string {
  return renderToStaticMarkup(
    <SWRConfig value={{
      fallback: {
        '/api/portal/services': SERVICES,
        '/api/portal/subscription': subscription,
        '/api/portal/capacity': capacity,
      },
    }}>
      <PortalServices />
    </SWRConfig>,
  )
}

describe('the Services page with the ladder mounted', () => {
  it('renders the ladder under the plan card and above the catalogue', () => {
    const html = renderPage({ tracks: [], queue: [], delivered: [] })
    const plan = html.indexOf('Your plan')
    const rungs = html.indexOf('Your plan, and what is either side of it')
    const catalogue = html.indexOf('What we take on')
    expect(plan).toBeGreaterThanOrEqual(0)
    expect(rungs).toBeGreaterThan(plan)
    expect(catalogue).toBeGreaterThan(rungs)
  })

  it('drops the plan rows from the catalogue so nothing is told twice', () => {
    const html = renderPage({ tracks: [], queue: [], delivered: [] })
    expect(html).not.toContain('PLAN ROW COPY')
    expect(html).toContain('A moving mark for the hero.')
  })

  it('leaves the catalogue whole for a client with no ladder to stand on', () => {
    const html = renderPage({ tracks: [], queue: [], delivered: [] }, {
      clientType: 'retainer',
      subscription: { ...SUBSCRIPTION.subscription, planType: 'custom' },
      plans: SUBSCRIPTION.plans,
    })
    expect(html).not.toContain('Your plan, and what is either side of it')
    expect(html).toContain('PLAN ROW COPY')
  })

  it('shows no ladder at all to a project client', () => {
    const html = renderPage({}, { clientType: 'project', subscription: null, plans: [] })
    expect(html).not.toContain('Your plan, and what is either side of it')
  })

  it('reads the real queue, so the nudge fires on their own numbers', () => {
    const html = renderPage({
      tracks: [
        { id: 't-1', currentRequest: { id: 'r-1' } },
        { id: 't-2', currentRequest: { id: 'r-2' } },
      ],
      queue: [{ id: 'r-3' }, { id: 'r-4' }],
      delivered: [],
    })
    expect(html).toContain('There are 4 things waiting and 2 tracks to pull them onto')
  })

  it('stays calm when the queue fits on the tracks', () => {
    const html = renderPage({
      tracks: [{ id: 't-1', currentRequest: { id: 'r-1' } }, { id: 't-2', currentRequest: null }],
      queue: [],
      delivered: [],
    })
    expect(html).toContain('Nothing in your numbers says you are pushing against Scale')
  })
})
