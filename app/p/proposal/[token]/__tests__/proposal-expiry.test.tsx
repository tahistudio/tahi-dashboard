/**
 * "An expired proposal is still acceptable at the old number" (T3.4/T3.5
 * client risk). `isProposalExpired` is the pure predicate the viewer uses
 * to decide whether to keep offering accept/decline/question; the
 * server-side expiry enforcement on the accept route is a different
 * slice's work (S2), this only covers the client stopping short of
 * offering the stale price once the date has passed or the row already
 * carries `status: 'expired'`.
 */
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isProposalExpired, VariantsSection } from '@/app/p/proposal/[token]/proposal-viewer'

Object.assign(globalThis, { React })

describe('isProposalExpired', () => {
  const now = new Date('2026-06-01T00:00:00Z').getTime()

  it('is false for a proposal with no expiry date', () => {
    expect(isProposalExpired({ status: 'shared', expiresAt: null }, null, now)).toBe(false)
  })

  it('is false while the expiry date is still in the future', () => {
    expect(isProposalExpired({ status: 'shared', expiresAt: '2026-07-01' }, null, now)).toBe(false)
  })

  it('is true once the expiry date has passed', () => {
    expect(isProposalExpired({ status: 'shared', expiresAt: '2026-05-01' }, null, now)).toBe(true)
  })

  it('is true when the server has already flipped status to expired, even with no date', () => {
    expect(isProposalExpired({ status: 'expired', expiresAt: null }, null, now)).toBe(true)
  })

  it('is false once the visitor has already accepted or declined, regardless of the date', () => {
    expect(isProposalExpired({ status: 'expired', expiresAt: '2026-05-01' }, 'accepted', now)).toBe(false)
    expect(isProposalExpired({ status: 'shared', expiresAt: '2026-05-01' }, 'declined', now)).toBe(false)
  })
})

const VARIANT = {
  id: 'v1', name: 'Growth', tagline: null, oneOffAmount: 0, monthlyAmount: 1500,
  currency: 'USD', scopeHtml: null, pricingNotesHtml: null, timelineScheduleId: null,
  ctaLabel: null, isFeatured: 1, position: 0,
}

describe('VariantsSection expired state', () => {
  it('hides the accept / decline / question controls and explains why', () => {
    const html = renderToStaticMarkup(
      <VariantsSection
        variants={[VARIANT]}
        activeVariantId="v1"
        activeVariant={VARIANT}
        onSelect={() => {}}
        onDecision={() => {}}
        submitted={null}
        isPreview={false}
        questionAcked={false}
        expired
      />,
    )
    expect(html).toContain('This proposal has expired')
    expect(html).not.toContain('Accept Growth')
    expect(html).not.toContain('Decline')
    expect(html).not.toContain('Ask a question')
  })

  it('shows the normal accept / decline / question controls when not expired', () => {
    const html = renderToStaticMarkup(
      <VariantsSection
        variants={[VARIANT]}
        activeVariantId="v1"
        activeVariant={VARIANT}
        onSelect={() => {}}
        onDecision={() => {}}
        submitted={null}
        isPreview={false}
        questionAcked={false}
        expired={false}
      />,
    )
    expect(html).not.toContain('This proposal has expired')
    expect(html).toContain('Accept Growth')
    expect(html).toContain('Decline')
  })
})
