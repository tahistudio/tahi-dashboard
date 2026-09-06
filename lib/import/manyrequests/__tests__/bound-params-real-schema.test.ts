/**
 * The parameter budget, against the REAL Drizzle tables.
 *
 * upsert.test.ts proves the arithmetic with a synthetic column map. This proves
 * the arithmetic is reading the actual tables: it imports db/schema.ts
 * unmocked, so if Drizzle ever moves the column map off the symbol this reads,
 * boundParamsPerRow silently falls back to the row width and this file fails
 * rather than the first apply doing so against production D1.
 *
 * The number that matters: D1 caps bound parameters at 100 PER STATEMENT
 * (not SQLite's 999), and a multi-row insert multiplies. lib/blockers-server.ts,
 * lib/delivery-aggregate.ts and lib/request-participants.ts all chunk at 90 for
 * the same reason.
 */
import { describe, it, expect } from 'vitest'
import { schema } from '@/db/d1'
import { boundParamsPerRow, insertBatchSize } from '../upsert'

/** Roughly what planRequests supplies for one request. */
const REQUEST_ROW: Record<string, unknown> = {
  manyrequestsId: '347',
  title: 'Custom Redirects',
  status: 'in_progress',
  priority: 'high',
  assigneeId: null,
  requestNumber: 347,
  dueDate: '2026-09-30',
  deliveredAt: null,
  estimatedHours: 3,
  brandId: null,
  description: 'Redirect map attached',
  formResponses: '{}',
  submittedById: null,
  submittedByType: null,
  orgId: 'org_1',
  type: 'small_task',
  size: 'small',
  isInternal: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
}

const TABLES: Array<[string, object, Record<string, unknown>]> = [
  ['requests', schema.requests, REQUEST_ROW],
  ['organisations', schema.organisations, { name: 'x', status: 'active', manyrequestsId: '3', clerkOrgId: null, createdAt: 'a', updatedAt: 'b' }],
  ['contacts', schema.contacts, { orgId: 'o', name: 'n', email: 'e', isPrimary: true, portalRole: 'member', clerkUserId: null, manyrequestsId: '1', createdAt: 'a', updatedAt: 'b' }],
  ['messages', schema.messages, { requestId: 'r', orgId: 'o', conversationId: null, authorId: 'a', authorType: 'contact', body: 'b', isInternal: false, manyrequestsId: 'k', createdAt: 'a', updatedAt: 'b' }],
  ['invoices', schema.invoices, { orgId: 'o', status: 'paid', currency: 'GBP', amountUsd: 1, totalUsd: 1, taxAmountUsd: 0, discountAmountUsd: 0, paidAt: null, source: 'manyrequests', manyrequestsId: 'INV-1', reconciliationStatus: 'historic', stripeInvoiceId: null, xeroInvoiceId: null, sentAt: null, notes: 'n', createdAt: 'a', updatedAt: 'b' }],
  ['invoice_items', schema.invoiceItems, { invoiceId: 'i', description: 'd', quantity: 1, unitPriceUsd: 1, totalUsd: 1, manyrequestsId: 'INV-1#0' }],
]

describe('every insert this importer makes fits inside D1s parameter cap', () => {
  it('reads the real column map rather than falling back to the row width', () => {
    // A request row supplies 20 columns; the table has many more, several of
    // which carry defaults and therefore still bind a parameter each. If this
    // ever equals 20 exactly, the symbol lookup has stopped working.
    expect(boundParamsPerRow(schema.requests, [REQUEST_ROW])).toBeGreaterThan(Object.keys(REQUEST_ROW).length)
  })

  it('keeps every table under 90 bound values per statement', () => {
    for (const [name, table, row] of TABLES) {
      const rows = Array.from({ length: 40 }, () => ({ ...row }))
      const perRow = boundParamsPerRow(table, rows)
      const batch = insertBatchSize(perRow)
      expect({ name, withinCap: perRow * batch <= 90 }).toEqual({ name, withinCap: true })
      expect({ name, batch: batch >= 1 }).toEqual({ name, batch: true })
    }
  })

  it('would have exceeded the cap at the old fixed batch of 20', () => {
    // The regression this replaces: 20 rows of a request is far past 100.
    expect(boundParamsPerRow(schema.requests, [REQUEST_ROW]) * 20).toBeGreaterThan(100)
  })
})
