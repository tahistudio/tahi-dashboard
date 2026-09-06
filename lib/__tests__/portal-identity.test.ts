/**
 * lib/portal-identity.ts: the seat a portal READ answers as.
 *
 * Two rules, and the whole preview rests on them:
 *   1. the org filter is on BOTH branches, always, so a person who is a contact
 *      at two client orgs on one Clerk account can never be resolved out of the
 *      wrong workspace (CLAUDE.md rule 12);
 *   2. a preview seat matches by contacts.id, and its ABSENCE falls back to the
 *      caller's own login, byte for byte the predicate the routes carried
 *      before. A real client read must be unchanged by this file existing.
 */
import { describe, it, expect, vi } from 'vitest'

interface Op { op: string; col?: unknown; val?: unknown; parts?: unknown[] }

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      id: 'contacts.id',
      orgId: 'contacts.orgId',
      clerkUserId: 'contacts.clerkUserId',
      isPrimary: 'contacts.isPrimary',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ op: 'eq', col, val }),
  desc: (col: unknown): Op => ({ op: 'desc', col }),
  and: (...parts: unknown[]): Op => ({ op: 'and', parts }),
}))

import { contactIdentityWhere, resolvePreviewContactId } from '@/lib/portal-identity'

type Drizzle = Parameters<typeof resolvePreviewContactId>[0]

/** The `.select().from().where().orderBy().limit()` shape, with the calls kept. */
function fakeDb(rows: Record<string, unknown>[] | Error) {
  const calls: { where?: unknown; orderBy?: unknown } = {}
  const chain = {
    from: () => chain,
    where: (w: unknown) => {
      calls.where = w
      return chain
    },
    orderBy: (o: unknown) => {
      calls.orderBy = o
      return chain
    },
    limit: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
  }
  return { database: { select: () => chain } as unknown as Drizzle, calls }
}

function parts(where: unknown): Op[] {
  return ((where as Op).parts ?? []) as Op[]
}

describe('contactIdentityWhere', () => {
  it('matches the caller by login when there is no preview seat', () => {
    for (const seat of [undefined, null, '']) {
      const where = contactIdentityWhere('org_acme', 'user_bob', seat)
      expect(parts(where)).toEqual([
        { op: 'eq', col: 'contacts.orgId', val: 'org_acme' },
        { op: 'eq', col: 'contacts.clerkUserId', val: 'user_bob' },
      ])
    }
  })

  it('matches the seat by id when a preview named one', () => {
    // The operator's own Clerk id is still on the session and is deliberately
    // NOT part of the predicate: no client org holds a row for it, which is
    // exactly why the preview used to resolve to nobody.
    const where = contactIdentityWhere('org_acme', 'user_liam', 'contact_primary')
    expect(parts(where)).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: 'org_acme' },
      { op: 'eq', col: 'contacts.id', val: 'contact_primary' },
    ])
  })

  it('keeps the org filter on both branches', () => {
    // Tenancy is not the preview's to relax. A seat id is opaque, so without
    // this the predicate would be a bare primary-key lookup.
    for (const seat of [null, 'contact_primary']) {
      const first = parts(contactIdentityWhere('org_acme', 'user_bob', seat))[0]
      expect(first).toEqual({ op: 'eq', col: 'contacts.orgId', val: 'org_acme' })
    }
  })
})

describe('resolvePreviewContactId', () => {
  it('picks the org primary seat, scoped to that org', async () => {
    const { database, calls } = fakeDb([{ id: 'contact_primary' }])
    expect(await resolvePreviewContactId(database, 'org_acme')).toBe('contact_primary')
    expect(calls.where).toEqual({ op: 'eq', col: 'contacts.orgId', val: 'org_acme' })
    // Primary FIRST, because that person is a workspace admin by definition
    // (lib/portal-access.ts), so the preview shows the owner's full surface
    // rather than a member's subset of it.
    expect(calls.orderBy).toEqual({ op: 'desc', col: 'contacts.isPrimary' })
  })

  it('answers null for an org with nobody in it', async () => {
    // A legitimate answer, not an error: a client workspace can exist before
    // anyone is invited into it.
    const { database } = fakeDb([])
    expect(await resolvePreviewContactId(database, 'org_empty')).toBeNull()
  })

  it('answers null rather than throwing when D1 fails', async () => {
    // This runs inside getPortalAuth on every previewed request. A hiccup must
    // degrade the preview to one with no resolved seat, never break the read
    // it was only decorating.
    const { database } = fakeDb(new Error('D1 unavailable'))
    expect(await resolvePreviewContactId(database, 'org_acme')).toBeNull()
  })
})
