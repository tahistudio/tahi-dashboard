import { describe, expect, it } from 'vitest'
import { createCallForParent } from './calls'

/**
 * Minimal fake for the one thing createCallForParent needs from a
 * Drizzle D1 handle: `.insert(table).values(row)`. Captures every
 * inserted row in call order so the test can assert on what actually
 * got written, without pulling in a full schema-double harness.
 */
function fakeDatabase() {
  const inserted: Array<{ values: Record<string, unknown> }> = []
  const database = {
    insert() {
      return {
        values(vals: Record<string, unknown>) {
          inserted.push({ values: vals })
          return Promise.resolve()
        },
      }
    },
  }
  return { database: database as unknown as Parameters<typeof createCallForParent>[0], inserted }
}

describe('createCallForParent', () => {
  it('normalises a naive scheduledAt (no offset) to the Pacific/Auckland instant before writing', async () => {
    const { database, inserted } = fakeDatabase()

    await createCallForParent(
      database,
      'lead',
      'lead_1',
      { title: 'Discovery call', scheduledAt: '2026-09-15T10:00:00' },
      'user_1',
    )

    // First insert is the discoveryCalls row.
    expect(inserted[0].values.scheduledAt).toBe('2026-09-14T22:00:00.000Z')
    expect(inserted[0].values.leadId).toBe('lead_1')
    expect(inserted[0].values.title).toBe('Discovery call')

    // Second insert is the activity stamp, whose description should also
    // reflect the real (normalised) instant, not the naive input.
    const activity = inserted[1].values
    expect(activity.description).toBe('For 2026-09-14T22:00:00.000Z')
  })

  it('canonicalises a Google-Calendar-style offset input to the equivalent Z instant', async () => {
    const { database, inserted } = fakeDatabase()

    await createCallForParent(
      database,
      'org',
      'org_1',
      { title: 'Client check-in', scheduledAt: '2026-09-15T10:00:00+12:00' },
      'user_1',
    )

    expect(inserted[0].values.scheduledAt).toBe('2026-09-14T22:00:00.000Z')
  })

  it('leaves an already-UTC scheduledAt alone', async () => {
    const { database, inserted } = fakeDatabase()

    await createCallForParent(
      database,
      'deal',
      'deal_1',
      { title: 'Scope call', scheduledAt: '2026-09-14T22:00:00.000Z' },
      'user_1',
    )

    expect(inserted[0].values.scheduledAt).toBe('2026-09-14T22:00:00.000Z')
  })

  it('rejects an unparseable scheduledAt instead of writing garbage', async () => {
    const { database } = fakeDatabase()

    await expect(
      createCallForParent(database, 'lead', 'lead_1', { title: 'Discovery call', scheduledAt: 'not a date' }, 'user_1'),
    ).rejects.toThrow('scheduledAt is not a valid date')
  })
})
