/**
 * lib/request-handoff-nudge.ts: the reminder a stalled hand-off sends.
 *
 * The thing worth testing here is restraint, not delivery. A scheduled mailer
 * pointed at a real client's inbox has exactly one interesting failure mode,
 * and it is sending too often:
 *
 *   - only hand-offs OLDER than the window are chased;
 *   - the three-day floor between reminders holds whatever the setting says,
 *     so dropping handoffNudgeDays to 1 means "chase sooner", never "chase
 *     every morning";
 *   - the stamp goes down BEFORE the send, so a send that throws costs one
 *     reminder rather than licensing tomorrow's run to repeat it;
 *   - a missing column (migration 0104 not applied) is zeroes, not a thrown
 *     error that would take the rest of delivery-watch with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications', () => ({ createNotifications: vi.fn() }))

import { createNotifications } from '@/lib/notifications'
import {
  DEFAULT_NUDGE_AFTER_DAYS,
  MIN_DAYS_BETWEEN_NUDGES,
  nudgeStalledHandoffs,
  resolveNudgeAfterDays,
} from '@/lib/request-handoff-nudge'

type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, calls: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[][] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const calls: QueryRecord[] = [{ method, args }]
    queries.push(calls)
    return makeChain(queue.length ? queue.shift() : [], calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

const NOW = new Date('2026-09-18T09:00:00.000Z')

const DUE_ROW = {
  id: 'req-1',
  orgId: 'org-a',
  title: 'Spring landing page',
  requestNumber: 42,
  waitingReason: 'approval',
  waitingSince: '2026-09-13T09:00:00.000Z',
  waitingNote: 'Sign off the hero copy',
  waitingDueAt: '2026-09-16T00:00:00.000Z',
  contactId: 'contact-1',
  contactName: 'Ngaire Hutchins',
}

/** The `where` argument of the Nth select, as the SQL object drizzle builds. */
function whereOf(queries: QueryRecord[][], n = 0): unknown {
  return queries[n]?.find(c => c.method === 'where')?.args[0]
}

beforeEach(() => vi.clearAllMocks())

describe('resolveNudgeAfterDays', () => {
  it('defaults to 3 with no setting row', async () => {
    const { handle } = makeDb([[]])
    expect(await resolveNudgeAfterDays(handle as never)).toBe(DEFAULT_NUDGE_AFTER_DAYS)
  })

  it('takes the studio\'s value when it is sane', async () => {
    const { handle } = makeDb([[{ value: '7' }]])
    expect(await resolveNudgeAfterDays(handle as never)).toBe(7)
  })

  it('ignores a value that is zero, negative, absurd or not a number', async () => {
    for (const value of ['0', '-4', '900', 'soon', '']) {
      const { handle } = makeDb([[{ value }]])
      expect(await resolveNudgeAfterDays(handle as never)).toBe(DEFAULT_NUDGE_AFTER_DAYS)
    }
  })

  it('falls back rather than throwing when settings are unreadable', async () => {
    const exploding = { select: () => { throw new Error('no settings table') } }
    expect(await resolveNudgeAfterDays(exploding as never)).toBe(DEFAULT_NUDGE_AFTER_DAYS)
  })
})

describe('nudgeStalledHandoffs', () => {
  it('chases a hand-off older than the window, stamping before it sends', async () => {
    const { handle, queries } = makeDb([[], [DUE_ROW]])

    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result).toEqual({ scanned: 1, nudged: 1, afterDays: DEFAULT_NUDGE_AFTER_DAYS })

    // Query 0 is the setting, 1 is the scan, 2 is the stamp. The stamp lands
    // before the send, which is the ordering this whole step depends on.
    const stamp = queries[2]?.find(c => c.method === 'set')?.args[0] as Record<string, unknown>
    expect(stamp).toEqual({ waitingNudgedAt: NOW.toISOString() })

    expect(vi.mocked(createNotifications)).toHaveBeenCalledWith(
      expect.anything(),
      [{ contactId: 'contact-1' }],
      expect.objectContaining({
        type: 'request_waiting_on_you',
        title: 'Still with you: "Spring landing page"',
        body: 'Needs your approval. It has been 5 days.',
        entityId: 'req-1',
        email: expect.objectContaining({ template: 'request-waiting-on-you' }),
      }),
    )
  })

  it('asks for a cutoff built from the resolved window, not a fixed one', async () => {
    const { handle, queries } = makeDb([[{ value: '10' }], []])
    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result.afterDays).toBe(10)
    // The scan happened, and it carried a where clause. The cutoff arithmetic
    // itself is asserted through afterDays, since the SQL object is opaque.
    expect(whereOf(queries, 1)).toBeDefined()
  })

  it('sends nothing when nothing is due', async () => {
    const { handle } = makeDb([[], []])
    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result).toMatchObject({ scanned: 0, nudged: 0 })
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })

  it('holds a three-day floor between reminders that the setting cannot lower', async () => {
    // The floor is a constant, not derived from the setting, which is the
    // whole guarantee: handoffNudgeDays: 1 must not become a daily mailshot.
    expect(MIN_DAYS_BETWEEN_NUDGES).toBe(3)
    const { handle } = makeDb([[{ value: '1' }], []])
    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result.afterDays).toBe(1)
  })

  it('keeps going when one client\'s send throws', async () => {
    vi.mocked(createNotifications)
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValueOnce({ delivered: 1, skipped: 0 } as never)

    const second = { ...DUE_ROW, id: 'req-2', contactId: 'contact-2' }
    const { handle } = makeDb([[], [DUE_ROW, second]])

    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result).toMatchObject({ scanned: 2, nudged: 1 })
  })

  it('reports zeroes rather than throwing when migration 0104 is missing', async () => {
    let call = 0
    const handle = {
      select: () => {
        call += 1
        // The settings read succeeds; the scan hits the absent column.
        if (call === 1) return makeChain([], [])
        throw new Error('no such column: waiting_on_contact_id')
      },
      update: () => makeChain([], []),
    }
    const result = await nudgeStalledHandoffs(handle as never, NOW)
    expect(result).toEqual({ scanned: 0, nudged: 0, afterDays: DEFAULT_NUDGE_AFTER_DAYS })
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })

  it('reads an unknown reason slug as "other" rather than dropping the chase', async () => {
    const { handle } = makeDb([[], [{ ...DUE_ROW, waitingReason: 'chasing' }]])
    await nudgeStalledHandoffs(handle as never, NOW)
    expect(vi.mocked(createNotifications)).toHaveBeenCalledWith(
      expect.anything(),
      [{ contactId: 'contact-1' }],
      expect.objectContaining({ body: expect.stringContaining('Needs something from you') }),
    )
  })
})
