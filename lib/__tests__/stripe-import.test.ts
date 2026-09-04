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
})
