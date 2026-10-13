import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signStripeCustomerLinkPreview, verifyStripeCustomerLinkPreview } from '@/lib/stripe-customer-link'

const secret = 'sk_live_QA_ONLY_customer_link_signing_secret'
const preview = { client: { id: 'org-a', stripeCustomerId: null }, customer: { id: 'cus_QA' } }

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-13T00:00:00.000Z') }))
afterEach(() => vi.useRealTimers())

describe('signed Stripe customer link previews', () => {
  it('accepts the issued approval for the same caller and current preview', async () => {
    const token = await signStripeCustomerLinkPreview(secret, 'user_liam', preview)
    expect(token).toMatch(/^\d{13}\.[0-9a-f]{64}$/)
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', preview, token)).toBe(true)
  })

  it('refuses a different actor, changed preview or changed signing key', async () => {
    const token = await signStripeCustomerLinkPreview(secret, 'user_liam', preview)
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_staci', preview, token)).toBe(false)
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', { ...preview, client: { id: 'org-b' } }, token)).toBe(false)
    expect(await verifyStripeCustomerLinkPreview('different_key', 'user_liam', preview, token)).toBe(false)
  })

  it('expires after ten minutes, including the exact expiry boundary', async () => {
    const token = await signStripeCustomerLinkPreview(secret, 'user_liam', preview)
    vi.advanceTimersByTime(10 * 60 * 1000 - 1)
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', preview, token)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', preview, token)).toBe(false)
  })

  it('refuses an approval issued too far in the future', async () => {
    const token = await signStripeCustomerLinkPreview(secret, 'user_liam', preview)
    vi.setSystemTime(new Date(Date.now() - 1))
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', preview, token)).toBe(false)
  })

  it.each([null, 1, '', 'forged', `${Date.now() + 60_000}.${'0'.repeat(64)}`, '9999999999999.' + 'f'.repeat(64)])('refuses malformed or forged tokens: %j', async token => {
    expect(await verifyStripeCustomerLinkPreview(secret, 'user_liam', preview, token)).toBe(false)
  })
})
