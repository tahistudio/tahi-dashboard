/**
 * lib/stripe-status.ts: the one Stripe-to-dashboard invoice status decision.
 *
 * A dummy invoice was written off locally, and the next morning's Stripe
 * sync cron read the still-open Stripe invoice and flipped it straight back
 * to 'sent', putting a dead invoice back on the daily brief. The importer
 * had no notion that a local write-off or a local paid should never be
 * walked backwards by a Stripe read, the same gap `lib/xero-status.ts` (see
 * NEVER_OVERWRITTEN_BY there) already closed for Xero. These tests pin the
 * mirrored rule for Stripe: a local 'paid' is terminal and a local
 * 'written_off' only yields to 'paid', never to anything that re-opens the
 * bill.
 */
import { describe, it, expect } from 'vitest'
import { mapStripeStatus, decideStripeStatus } from '@/lib/stripe-status'

describe('mapStripeStatus', () => {
  it('maps every Stripe invoice status', () => {
    expect(mapStripeStatus('draft')).toBe('draft')
    expect(mapStripeStatus('open')).toBe('sent')
    expect(mapStripeStatus('paid')).toBe('paid')
    expect(mapStripeStatus('void')).toBe('written_off')
    expect(mapStripeStatus('uncollectible')).toBe('written_off')
  })

  it('falls back to draft for an unknown or missing status', () => {
    expect(mapStripeStatus('pending_review')).toBe('draft')
    expect(mapStripeStatus('')).toBe('draft')
    expect(mapStripeStatus(null)).toBe('draft')
    expect(mapStripeStatus(undefined)).toBe('draft')
  })
})

describe('decideStripeStatus', () => {
  it('never demotes a written-off invoice back to something owed (the bug)', () => {
    // The dummy invoice: written off locally, still 'open' in Stripe.
    expect(decideStripeStatus('written_off', 'open')).toBeNull()
    expect(decideStripeStatus('written_off', 'draft')).toBeNull()
  })

  it('never demotes a paid invoice back to something owed', () => {
    expect(decideStripeStatus('paid', 'open')).toBeNull()
    expect(decideStripeStatus('paid', 'draft')).toBeNull()
  })

  it('never demotes a paid invoice with a written-off reading either', () => {
    // Mirrors "a Xero void never demotes a local paid row": a Stripe void or
    // uncollectible does not undo money that already landed.
    expect(decideStripeStatus('paid', 'void')).toBeNull()
    expect(decideStripeStatus('paid', 'uncollectible')).toBeNull()
  })

  it('still lets a Stripe paid promote a local sent to paid', () => {
    expect(decideStripeStatus('sent', 'paid')).toBe('paid')
  })

  it('lets a Stripe paid through from anywhere, including a write-off', () => {
    // Terminal, always allowed: Stripe seeing money is real money.
    expect(decideStripeStatus('written_off', 'paid')).toBe('paid')
    expect(decideStripeStatus('draft', 'paid')).toBe('paid')
    expect(decideStripeStatus(null, 'paid')).toBe('paid')
  })

  it('still maps a Stripe void or uncollectible invoice to written_off', () => {
    expect(decideStripeStatus('sent', 'void')).toBe('written_off')
    expect(decideStripeStatus('sent', 'uncollectible')).toBe('written_off')
    expect(decideStripeStatus('draft', 'void')).toBe('written_off')
  })

  it('never lets local-only refinements of sent get flattened by a Stripe open', () => {
    // Stripe cannot know the client viewed the invoice, that it aged past
    // due, or that it arrived through the ManyRequests 'pending' word.
    expect(decideStripeStatus('viewed', 'open')).toBeNull()
    expect(decideStripeStatus('overdue', 'open')).toBeNull()
    expect(decideStripeStatus('pending', 'open')).toBeNull()
  })

  it('still promotes a draft to sent', () => {
    expect(decideStripeStatus('draft', 'open')).toBe('sent')
  })

  it('treats a mapped draft as create-only', () => {
    expect(decideStripeStatus('sent', 'draft')).toBeNull()
    expect(decideStripeStatus('viewed', 'draft')).toBeNull()
    expect(decideStripeStatus('overdue', 'draft')).toBeNull()
    expect(decideStripeStatus('pending', 'draft')).toBeNull()
    expect(decideStripeStatus('paid', 'draft')).toBeNull()
    expect(decideStripeStatus('written_off', 'draft')).toBeNull()
  })

  it('writes nothing when the mapped status already agrees with the local one', () => {
    expect(decideStripeStatus('sent', 'open')).toBeNull()
    expect(decideStripeStatus('paid', 'paid')).toBeNull()
    expect(decideStripeStatus('written_off', 'void')).toBeNull()
    expect(decideStripeStatus('draft', 'draft')).toBeNull()
  })

  it('copes with a row that has no local status yet', () => {
    expect(decideStripeStatus(null, 'open')).toBe('sent')
    expect(decideStripeStatus(undefined, 'draft')).toBe('draft')
  })
})
