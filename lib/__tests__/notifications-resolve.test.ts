import { describe, it, expect } from 'vitest'
import {
  createNotification,
  createNotifications,
  notifyTeamMember,
  resolveOwnerSetting,
  resolveParticipants,
} from '@/lib/notifications'
import { schema } from '@/db/d1'

/**
 * Recipient identity resolution for the notification helpers.
 *
 * The bell and the SSE stream query notifications by CLERK user id, but call
 * sites hold domain row ids (teamMembers.id, contacts.id, conversation
 * participant ids). These tests pin the typed-recipient API: domain ids are
 * resolved to Clerk user ids before insert, unlinked people are skipped (not
 * inserted under an invisible id), and the sender is excluded from
 * participant fan-out.
 */

type Row = Record<string, unknown>

interface InsertCapture {
  table: unknown
  rows: Row[]
}

// Minimal awaitable query-builder mock (same pattern as the permissions
// tests): the helpers use the drizzle instance they are HANDED, so we script
// select results per table by reference identity to the real schema objects
// and capture inserts.
function makeDrizzle(queues: Map<unknown, Row[][]>, inserted: InsertCapture[]) {
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
    insert: (table: unknown) => ({
      values: (rows: Row[] | Row) => {
        inserted.push({ table, rows: Array.isArray(rows) ? rows : [rows] })
        return Promise.resolve()
      },
    }),
  } as unknown as Parameters<typeof createNotifications>[0]
}

const PAYLOAD = {
  type: 'new_message' as const,
  title: 'New message on "Homepage refresh"',
  body: 'Quick question about the hero',
  entityType: 'request' as const,
  entityId: 'req-1',
}

describe('notifyTeamMember', () => {
  it('resolves teamMembers.id to the clerk user id before inserting', async () => {
    const inserted: InsertCapture[] = []
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.teamMembers, [[{ id: 'tm-1', clerkUserId: 'user_tm_1' }]]],
      ]),
      inserted,
    )

    const result = await notifyTeamMember(dbm, 'tm-1', PAYLOAD)

    expect(result).toEqual({ delivered: 1, skipped: 0 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe(schema.notifications)
    expect(inserted[0].rows).toHaveLength(1)
    const row = inserted[0].rows[0]
    expect(row.userId).toBe('user_tm_1')
    expect(row.userType).toBe('team_member')
    expect(row.eventType).toBe(PAYLOAD.type)
    expect(row.title).toBe(PAYLOAD.title)
    expect(row.body).toBe(PAYLOAD.body)
    expect(row.entityType).toBe(PAYLOAD.entityType)
    expect(row.entityId).toBe(PAYLOAD.entityId)
  })

  it('no-ops with a skipped count when the member has no clerk user id', async () => {
    const inserted: InsertCapture[] = []
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.teamMembers, [[{ id: 'tm-1', clerkUserId: null }]]],
      ]),
      inserted,
    )

    const result = await notifyTeamMember(dbm, 'tm-1', PAYLOAD)

    expect(result).toEqual({ delivered: 0, skipped: 1 })
    expect(inserted).toHaveLength(0)
  })
})

describe('createNotification with a contact recipient', () => {
  it('resolves contacts.id to the clerk user id before inserting', async () => {
    const inserted: InsertCapture[] = []
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.contacts, [[{ id: 'ct-1', clerkUserId: 'user_ct_1' }]]],
      ]),
      inserted,
    )

    const result = await createNotification(dbm, {
      recipient: { contactId: 'ct-1' },
      ...PAYLOAD,
    })

    expect(result).toEqual({ delivered: 1, skipped: 0 })
    expect(inserted).toHaveLength(1)
    const row = inserted[0].rows[0]
    expect(row.userId).toBe('user_ct_1')
    expect(row.userType).toBe('contact')
  })
})

describe('resolveParticipants', () => {
  it('maps a participant mix to clerk-resolved recipients, dropping unlinked people', async () => {
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.teamMembers, [[{ id: 'tm-1', clerkUserId: 'user_tm_1' }]]],
        [
          schema.contacts,
          [[
            { id: 'ct-1', clerkUserId: 'user_ct_1' },
            { id: 'ct-2', clerkUserId: null },
          ]],
        ],
      ]),
      [],
    )

    const recipients = await resolveParticipants(dbm, [
      { participantId: 'tm-1', participantType: 'team_member' },
      { participantId: 'ct-1', participantType: 'contact' },
      { participantId: 'ct-2', participantType: 'contact' },
    ])

    expect(recipients).toEqual([
      { clerkUserId: 'user_tm_1', userType: 'team_member' },
      { clerkUserId: 'user_ct_1', userType: 'contact' },
    ])
  })

  it('excludes the sender via excludeParticipantId', async () => {
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.contacts, [[{ id: 'ct-1', clerkUserId: 'user_ct_1' }]]],
      ]),
      [],
    )

    const recipients = await resolveParticipants(
      dbm,
      [
        { participantId: 'tm-sender', participantType: 'team_member' },
        { participantId: 'ct-1', participantType: 'contact' },
      ],
      { excludeParticipantId: 'tm-sender' },
    )

    expect(recipients).toEqual([{ clerkUserId: 'user_ct_1', userType: 'contact' }])
  })
})

describe('owner setting resolution (tolerant)', () => {
  it("passes 'user_' values through as pre-resolved clerk ids, no lookup", async () => {
    const inserted: InsertCapture[] = []
    // Empty queues: any table lookup would resolve to zero rows and the
    // recipient would be skipped, so a delivered row proves pass-through.
    const dbm = makeDrizzle(new Map(), inserted)

    const result = await createNotification(dbm, {
      recipient: { ownerSettingValue: 'user_liam' },
      ...PAYLOAD,
    })

    expect(result).toEqual({ delivered: 1, skipped: 0 })
    expect(inserted).toHaveLength(1)
    const row = inserted[0].rows[0]
    expect(row.userId).toBe('user_liam')
    expect(row.userType).toBe('team_member')
  })

  it('resolves a teamMembers UUID to the clerk user id', async () => {
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([
        [schema.teamMembers, [[{ id: 'tm-uuid-1', clerkUserId: 'user_resolved' }]]],
      ]),
      [],
    )

    const owner = await resolveOwnerSetting(dbm, 'tm-uuid-1')

    expect(owner).toEqual({ clerkUserId: 'user_resolved', userType: 'team_member' })
  })

  it('returns null for an unknown UUID and skips the recipient on send', async () => {
    const inserted: InsertCapture[] = []
    const dbm = makeDrizzle(
      new Map<unknown, Row[][]>([[schema.teamMembers, [[], []]]]),
      inserted,
    )

    const owner = await resolveOwnerSetting(dbm, 'tm-unknown')
    expect(owner).toBeNull()

    const result = await createNotification(dbm, {
      recipient: { ownerSettingValue: 'tm-unknown' },
      ...PAYLOAD,
    })
    expect(result).toEqual({ delivered: 0, skipped: 1 })
    expect(inserted).toHaveLength(0)
  })

  it('returns null for empty or whitespace setting values', async () => {
    const dbm = makeDrizzle(new Map(), [])

    expect(await resolveOwnerSetting(dbm, null)).toBeNull()
    expect(await resolveOwnerSetting(dbm, undefined)).toBeNull()
    expect(await resolveOwnerSetting(dbm, '   ')).toBeNull()
  })
})

describe('createNotifications with pre-resolved clerk recipients', () => {
  it('inserts clerkUserId recipients as-is, with no table lookups', async () => {
    const inserted: InsertCapture[] = []
    const dbm = makeDrizzle(new Map(), inserted)

    const result = await createNotifications(
      dbm,
      [
        { clerkUserId: 'user_a', userType: 'team_member' },
        { clerkUserId: 'user_b', userType: 'contact' },
      ],
      PAYLOAD,
    )

    expect(result).toEqual({ delivered: 2, skipped: 0 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].rows.map((r) => r.userId)).toEqual(['user_a', 'user_b'])
  })
})
