/**
 * lib/stripe-import.ts: the Stripe pay link has to survive the import.
 *
 * A retainer client's recurring invoice reaches the dashboard through this
 * path, not through stripe-create, so if the hosted invoice URL is dropped
 * here the most common bill a client would try to pay from the portal arrives
 * with no Pay now CTA on the list row and no Pay CTA on the detail page.
 *
 * The fake D1 is the same chainable recorder the route tests use: only the
 * chain is thenable, and every call is recorded so the values actually written
 * can be asserted rather than inferred from a return value.
 */
import { describe, it, expect } from 'vitest'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'

type QueryRecord = { calls: Array<{ method: string; args: unknown[] }> }

function makeChain(result: unknown, record: QueryRecord): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        record.calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)
    return makeChain(queue.length ? queue.shift() : [], record)
  }
  return {
    handle: {
      select: (...args: unknown[]) => entry('select', args),
      insert: (...args: unknown[]) => entry('insert', args),
      update: (...args: unknown[]) => entry('update', args),
      delete: (...args: unknown[]) => entry('delete', args),
    },
    queries,
  }
}

function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

const STRIPE_INVOICE: StripeInvoiceLike = {
  id: 'in_test_1',
  number: 'INV-0001',
  status: 'open',
  customer: 'cus_1',
  currency: 'nzd',
  hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_1',
  subtotal: 150000,
  total: 150000,
  created: 1_760_000_000,
}

type Db = Parameters<typeof importStripeInvoice>[0]

describe('importStripeInvoice', () => {
  it('persists the hosted pay link on a newly imported invoice', async () => {
    // no local row, then the org matched by stripeCustomerId
    const { handle, queries } = makeDb([[], [{ id: 'org-a', stripeCustomerId: 'cus_1' }]])

    const res = await importStripeInvoice(handle as unknown as Db, STRIPE_INVOICE)
    expect(res).toMatchObject({ created: true, orgId: 'org-a' })

    const values = argOf(byEntry(queries, 'insert')[0], 'values') as {
      stripeHostedInvoiceUrl: string | null
      status: string
    }
    expect(values.stripeHostedInvoiceUrl).toBe(STRIPE_INVOICE.hosted_invoice_url)
    // 'open' in Stripe is a bill the client owes, so it lands in the portal.
    expect(values.status).toBe('sent')
  })

  it('stores null when Stripe has no hosted page yet', async () => {
    const { handle, queries } = makeDb([[], [{ id: 'org-a', stripeCustomerId: 'cus_1' }]])

    await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'draft', hosted_invoice_url: null },
    )

    const values = argOf(byEntry(queries, 'insert')[0], 'values') as { stripeHostedInvoiceUrl: string | null }
    expect(values.stripeHostedInvoiceUrl).toBeNull()
  })

  it('refreshes the pay link when re-importing an existing invoice', async () => {
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a' }]])

    const res = await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_2' },
    )
    expect(res).toMatchObject({ created: false })

    const set = argOf(byEntry(queries, 'update')[0], 'set') as { stripeHostedInvoiceUrl?: string }
    expect(set.stripeHostedInvoiceUrl).toBe('https://invoice.stripe.com/i/acct_1/test_2')
  })

  it('never clobbers a stored pay link with a payload that omits one', async () => {
    // The invoice.paid webhook self-heal can arrive without the hosted URL;
    // wiping the column there would take the Pay CTA off an unpaid sibling.
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a' }]])

    await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'paid', hosted_invoice_url: null },
    )

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).not.toHaveProperty('stripeHostedInvoiceUrl')
    expect(set.status).toBe('paid')
  })

  it('never demotes a written-off invoice back to sent (the write-off re-import bug)', async () => {
    // The dummy Stripe invoice: written off locally, still 'open' in Stripe.
    // A daily sync must not flip it back onto the daily brief.
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'written_off' }]])

    const res = await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'open' },
    )
    expect(res).toMatchObject({ created: false })

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).not.toHaveProperty('status')
  })

  it('never demotes a paid invoice back to sent', async () => {
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'paid' }]])

    await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'open' },
    )

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).not.toHaveProperty('status')
  })

  it('still refreshes the pay link and paid date on a row whose status write is blocked', async () => {
    // Amounts and dates still refresh even though the status write is
    // skipped, so a stale pay link on a write-off does not linger forever.
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'written_off' }]])

    await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/refreshed' },
    )

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).not.toHaveProperty('status')
    expect(set.stripeHostedInvoiceUrl).toBe('https://invoice.stripe.com/i/acct_1/refreshed')
  })

  it('still lets a Stripe paid promote a local sent to paid', async () => {
    const { handle, queries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'sent' }]])

    await importStripeInvoice(
      handle as unknown as Db,
      { ...STRIPE_INVOICE, status: 'paid', status_transitions: { paid_at: 1_760_000_500 } },
    )

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('paid')
    expect(set.paidAt).toBe(new Date(1_760_000_500 * 1000).toISOString())
  })

  it('still maps a Stripe void or uncollectible invoice to written_off', async () => {
    const { handle: voidHandle, queries: voidQueries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'sent' }]])
    await importStripeInvoice(voidHandle as unknown as Db, { ...STRIPE_INVOICE, status: 'void' })
    expect((argOf(byEntry(voidQueries, 'update')[0], 'set') as Record<string, unknown>).status).toBe('written_off')

    const { handle: uncHandle, queries: uncQueries } = makeDb([[{ id: 'inv-local', orgId: 'org-a', status: 'sent' }]])
    await importStripeInvoice(uncHandle as unknown as Db, { ...STRIPE_INVOICE, status: 'uncollectible' })
    expect((argOf(byEntry(uncQueries, 'update')[0], 'set') as Record<string, unknown>).status).toBe('written_off')
  })
})
