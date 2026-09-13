/**
 * The client portal home's "Waiting on you" tile used to drop to a separate
 * LIGHT card (`.pfh-quiet`, with its own leaf badge) the instant a client had
 * nothing waiting, so the one surface meant to stay fixed-dark in both themes
 * flipped light on an empty account. This pins the empty state to the SAME
 * `.pfh-tile` dark forest panel used by every other state (loading,
 * populated), with the small leaf badge dropped entirely and the calm copy
 * plus text link swapped in as the body.
 */
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WaitingOnYou } from '@/components/tahi/portal/home/waiting-on-you'

describe('WaitingOnYou empty state', () => {
  it('renders on the same dark pfh-tile panel, never the old light pfh-quiet card', () => {
    const html = renderToStaticMarkup(<WaitingOnYou items={[]} isFirstRun onStart={() => {}} />)
    expect(html).toContain('pfh-tile')
    expect(html).not.toContain('pfh-quiet"')
    expect(html).not.toContain('pfh-quiet ')
    expect(html).toContain('Waiting on you')
    expect(html).toContain('All quiet in the studio.')
  })

  it('drops the leaf badge entirely: no pfh-quiet-leaf badge renders beside the copy', () => {
    const html = renderToStaticMarkup(<WaitingOnYou items={[]} onStart={() => {}} />)
    expect(html).not.toContain('pfh-quiet-leaf')
  })

  it('shows the first-request link for a first run with zero requests ever', () => {
    const html = renderToStaticMarkup(
      <WaitingOnYou items={[]} isFirstRun onStart={() => {}} hasOpenRequests={false} />,
    )
    expect(html).toContain('Make your first request')
  })

  it('keeps the text link away from a client who already has an open request in flight', () => {
    const html = renderToStaticMarkup(<WaitingOnYou items={[]} onStart={() => {}} hasOpenRequests />)
    expect(html).not.toContain('Make your first request')
    expect(html).not.toContain('Start a request')
  })

  it('still shows the read-only lens footer on the empty tile, same as the populated one', () => {
    const html = renderToStaticMarkup(
      <WaitingOnYou items={[]} onStart={() => {}} ro previewName="Acme Co" />,
    )
    expect(html).toContain('You are reading this as Acme Co')
  })
})
