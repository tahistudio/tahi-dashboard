/**
 * Unit tests for lib/invoice-channel.ts: the two rails, and how a client with
 * no channel of its own resolves against the studio default.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INVOICE_CHANNEL,
  INVOICE_CHANNELS,
  INVOICE_CHANNEL_SETTING_KEY,
  invoiceChannelLabel,
  isInvoiceChannel,
  resolveInvoiceChannel,
} from '@/lib/invoice-channel'

describe('the channel vocabulary', () => {
  it('is exactly two rails, labelled Stripe and Xero', () => {
    expect(INVOICE_CHANNELS.map(c => c.value)).toEqual(['stripe', 'xero'])
    expect(INVOICE_CHANNELS.map(c => c.label)).toEqual(['Stripe', 'Xero'])
  })

  it('recognises only those two', () => {
    expect(isInvoiceChannel('stripe')).toBe(true)
    expect(isInvoiceChannel('xero')).toBe(true)
    // The three-rail draft of this feature is deliberately not vocabulary.
    expect(isInvoiceChannel('xero_bank')).toBe(false)
    expect(isInvoiceChannel('xero_stripe')).toBe(false)
    expect(isInvoiceChannel('manual')).toBe(false)
    expect(isInvoiceChannel('')).toBe(false)
    expect(isInvoiceChannel(null)).toBe(false)
    expect(isInvoiceChannel(undefined)).toBe(false)
    expect(isInvoiceChannel(1)).toBe(false)
  })

  it('names the settings key the studio default is stored under', () => {
    expect(INVOICE_CHANNEL_SETTING_KEY).toBe('invoicing.defaultChannel')
    expect(DEFAULT_INVOICE_CHANNEL).toBe('stripe')
  })
})

describe('resolveInvoiceChannel', () => {
  it('uses the client channel when it has one, whatever the studio default', () => {
    expect(resolveInvoiceChannel('xero', 'stripe')).toBe('xero')
    expect(resolveInvoiceChannel('stripe', 'xero')).toBe('stripe')
  })

  it('falls back to the studio default when the client is unset', () => {
    expect(resolveInvoiceChannel(null, 'xero')).toBe('xero')
    expect(resolveInvoiceChannel(undefined, 'xero')).toBe('xero')
    expect(resolveInvoiceChannel('', 'xero')).toBe('xero')
  })

  it('falls back to stripe when neither side says anything usable', () => {
    expect(resolveInvoiceChannel(null, null)).toBe('stripe')
    expect(resolveInvoiceChannel(null, '')).toBe('stripe')
    expect(resolveInvoiceChannel(null, undefined)).toBe('stripe')
  })

  it('never lets a stale or junk value escape as a channel', () => {
    expect(resolveInvoiceChannel('xero_bank', 'xero')).toBe('xero')
    expect(resolveInvoiceChannel('xero_bank', 'nonsense')).toBe('stripe')
    expect(resolveInvoiceChannel(42, {})).toBe('stripe')
  })
})

describe('invoiceChannelLabel', () => {
  it('labels the two rails', () => {
    expect(invoiceChannelLabel('stripe')).toBe('Stripe')
    expect(invoiceChannelLabel('xero')).toBe('Xero')
  })

  it('reads an unknown value as the default rather than printing it', () => {
    expect(invoiceChannelLabel(null)).toBe('Stripe')
    expect(invoiceChannelLabel('xero_bank')).toBe('Stripe')
  })
})
