import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolvePermissions } from '@/lib/permissions'
import { schema } from '@/db/d1'

/**
 * Client resolver: a person's per-contact feature_visibility overrides layer
 * ON TOP of their org's overrides (most specific wins), exactly like a team
 * member's overrides beat their role's. Covers the client branch added for the
 * Settings > Team & access "people within a client org" surface.
 */

// Minimal awaitable query-builder mock. resolvePermissions calls the drizzle
// instance it is HANDED (not db()), so we script results per table by
// reference identity to the real schema objects.
type Row = Record<string, unknown>

function makeDrizzle(queues: Map<unknown, Row[][]>) {
  const nextFor = (table: unknown): Row[] => {
    const q = queues.get(table)
    return q && q.length ? (q.shift() as Row[]) : []
  }
  const chain = (rows: Row[]) => {
    const p = Promise.resolve(rows)
    const c: Record<string, unknown> = {}
    for (const m of ['where', 'innerJoin', 'leftJoin', 'limit', 'orderBy']) c[m] = () => c
    c.then = (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) => p.then(res, rej)
    return c
  }
  return {
    select: () => ({ from: (table: unknown) => chain(nextFor(table)) }),
  } as unknown as Parameters<typeof resolvePermissions>[0]
}

const CLIENT_ORG = 'org-client-1'
const CLIENT_USER = 'user-client-1'

beforeEach(() => {
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org-tahi-admin'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
})

describe('resolvePermissions — client per-contact overrides', () => {
  it('layers contact overrides over org overrides (contact wins on the same key)', async () => {
    const queues = new Map<unknown, Row[][]>([
      [
        schema.featureVisibility,
        [
          // 1st featureVisibility query = org-level baseline
          [{ featureKey: 'invoices', effect: 'deny' }, { featureKey: 'files', effect: 'deny' }],
          // 2nd featureVisibility query = contact-level refinements
          [{ featureKey: 'invoices', effect: 'allow' }],
        ],
      ],
      [schema.contacts, [[{ id: 'contact-1' }]]],
    ])
    const access = await resolvePermissions(makeDrizzle(queues), {
      userId: CLIENT_USER,
      orgId: CLIENT_ORG,
    })

    expect(access.level).toBe('client')
    expect(access.audience).toBe('client')
    // Contact allow beats org deny on invoices; org deny stands on files.
    expect(access.overrides.get('invoices')).toBe('allow')
    expect(access.overrides.get('files')).toBe('deny')
  })

  it('falls back to the org baseline when the caller has no contact row', async () => {
    const queues = new Map<unknown, Row[][]>([
      [schema.featureVisibility, [[{ featureKey: 'invoices', effect: 'deny' }]]],
      [schema.contacts, [[]]], // no matching contact
    ])
    const access = await resolvePermissions(makeDrizzle(queues), {
      userId: CLIENT_USER,
      orgId: CLIENT_ORG,
    })

    expect(access.overrides.get('invoices')).toBe('deny')
  })

  it('does not resolve a contact for the MCP service token (org baseline only)', async () => {
    const queues = new Map<unknown, Row[][]>([
      [schema.featureVisibility, [[{ featureKey: 'invoices', effect: 'deny' }]]],
      // contacts should never be queried; leave it empty to prove the point.
      [schema.contacts, [[{ id: 'should-not-be-used' }]]],
    ])
    const access = await resolvePermissions(makeDrizzle(queues), {
      userId: 'api-service',
      orgId: CLIENT_ORG,
    })

    expect(access.overrides.get('invoices')).toBe('deny')
    // The contacts queue is untouched because the api-service short-circuits.
    expect(queues.get(schema.contacts)?.length).toBe(1)
  })
})
