/**
 * lib/request-handoff.ts: the reason vocabulary, the payload builder and the
 * auto hand-back.
 *
 * The three things this file is actually guarding:
 *
 *   1. One reason maps to exactly one sentence, one verb and one participant
 *      role, everywhere. The client reads the sentence, presses the verb, and
 *      the studio's People panel shows the role; three surfaces off one slug.
 *   2. daysWaiting is what the chip and the nudge both count, so it has to be
 *      whole days elapsed and never negative.
 *   3. The auto hand-back only fires for the person the request is actually
 *      with. A different contact at the same client acting on the request must
 *      not clear somebody else's hand-off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notify-request-team', () => ({ notifyRequestTeam: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), logSystemAudit: vi.fn() }))

import { notifyRequestTeam } from '@/lib/notify-request-team'
import { logAudit } from '@/lib/audit'
import {
  HANDOFF_REASONS,
  HANDOFF_REASON_SENTENCE,
  HANDOFF_ACTION_VERB,
  HANDOFF_CLEARED_COLUMNS,
  buildWaitingOn,
  daysWaiting,
  handBackOnClientAction,
  handoffParticipantRole,
  isHandoffReason,
  waitingChipLabel,
} from '@/lib/request-handoff'

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

beforeEach(() => vi.clearAllMocks())

describe('the reason vocabulary', () => {
  it('gives every reason a sentence written to the client', () => {
    expect(HANDOFF_REASON_SENTENCE).toEqual({
      approval: 'Needs your approval',
      content: 'Needs content from you',
      access: 'Needs access from you',
      decision: 'Needs a decision from you',
      file: 'Needs a file from you',
      other: 'Needs something from you',
    })
  })

  it('gives every reason exactly one action verb', () => {
    expect(HANDOFF_ACTION_VERB.approval).toBe('Approve')
    expect(HANDOFF_ACTION_VERB.content).toBe('Upload or reply')
    expect(HANDOFF_ACTION_VERB.file).toBe('Upload or reply')
    expect(HANDOFF_ACTION_VERB.access).toBe('Reply')
    expect(HANDOFF_ACTION_VERB.decision).toBe('Reply')
    expect(HANDOFF_ACTION_VERB.other).toBe('Reply')
  })

  it('covers every reason in every map, with no extras', () => {
    for (const map of [HANDOFF_REASON_SENTENCE, HANDOFF_ACTION_VERB]) {
      expect(Object.keys(map).sort()).toEqual([...HANDOFF_REASONS].sort())
    }
  })

  it('writes an approver row for approval and a contributor row for the rest', () => {
    expect(handoffParticipantRole('approval')).toBe('approver')
    for (const reason of HANDOFF_REASONS.filter(r => r !== 'approval')) {
      expect(handoffParticipantRole(reason)).toBe('contributor')
    }
  })

  it('refuses a reason outside the closed set', () => {
    expect(isHandoffReason('approval')).toBe(true)
    expect(isHandoffReason('Approval')).toBe(false)
    expect(isHandoffReason('blocked')).toBe(false)
    expect(isHandoffReason(null)).toBe(false)
    expect(isHandoffReason(3)).toBe(false)
  })
})

describe('daysWaiting', () => {
  const now = new Date('2026-09-18T09:00:00.000Z')

  it('counts whole elapsed days', () => {
    expect(daysWaiting('2026-09-15T09:00:00.000Z', now)).toBe(3)
    expect(daysWaiting('2026-09-15T23:59:00.000Z', now)).toBe(2)
  })

  it('is 0 for today, never negative for a future stamp', () => {
    expect(daysWaiting('2026-09-18T08:00:00.000Z', now)).toBe(0)
    expect(daysWaiting('2026-09-20T08:00:00.000Z', now)).toBe(0)
  })

  it('is 0 for a missing or unparseable stamp rather than NaN', () => {
    expect(daysWaiting(null, now)).toBe(0)
    expect(daysWaiting('not a date', now)).toBe(0)
  })
})

describe('buildWaitingOn', () => {
  const now = new Date('2026-09-18T09:00:00.000Z')

  it('returns null when the request is with the studio', () => {
    expect(buildWaitingOn({
      waitingOnContactId: null,
      waitingReason: null,
      waitingSince: null,
      waitingDueAt: null,
      waitingNote: null,
    }, null, now)).toBeNull()
  })

  it('builds the whole payload, label and day count included', () => {
    expect(buildWaitingOn({
      waitingOnContactId: 'contact-1',
      waitingReason: 'approval',
      waitingSince: '2026-09-15T09:00:00.000Z',
      waitingDueAt: '2026-09-19T00:00:00.000Z',
      waitingNote: 'Sign off the hero copy',
    }, 'Ngaire Hutchins', now)).toEqual({
      contactId: 'contact-1',
      contactName: 'Ngaire Hutchins',
      reason: 'approval',
      reasonLabel: 'Needs your approval',
      since: '2026-09-15T09:00:00.000Z',
      dueAt: '2026-09-19T00:00:00.000Z',
      note: 'Sign off the hero copy',
      daysWaiting: 3,
    })
  })

  it('falls back to "other" for a reason it does not know', () => {
    const built = buildWaitingOn({
      waitingOnContactId: 'contact-1',
      waitingReason: 'chasing',
      waitingSince: '2026-09-17T09:00:00.000Z',
      waitingDueAt: null,
      waitingNote: null,
    }, null, now)
    expect(built?.reason).toBe('other')
    expect(built?.reasonLabel).toBe('Needs something from you')
    expect(built?.contactName).toBeNull()
  })
})

describe('waitingChipLabel', () => {
  it('reads "Waiting on <first name> . <reason> . <n>d"', () => {
    expect(waitingChipLabel('Ngaire Hutchins', 'approval', 3))
      .toBe('Waiting on Ngaire · approval · 3d')
    expect(waitingChipLabel('Ngaire Hutchins', 'decision', 0))
      .toBe('Waiting on Ngaire · a decision · 0d')
  })

  it('falls back to "a client" with no name', () => {
    expect(waitingChipLabel(null, 'file', 1)).toBe('Waiting on a client · a file · 1d')
  })
})

describe('handBackOnClientAction', () => {
  const request = {
    id: 'req-1',
    orgId: 'org-a',
    title: 'Spring landing page',
    assigneeId: 'tm-1',
    waitingOnContactId: 'contact-1',
    waitingReason: 'approval',
    waitingSince: '2026-09-15T09:00:00.000Z',
  }

  it('clears the pointer, audits and tells the studio when the named person acts', async () => {
    const { handle, queries } = makeDb([[request], []])
    const cleared = await handBackOnClientAction(handle as never, {
      requestId: 'req-1',
      contactId: 'contact-1',
      contactName: 'Ngaire Hutchins',
      trigger: 'review_approved',
    })

    expect(cleared).toBe(true)
    const setCall = queries[1].find(c => c.method === 'set')
    expect(setCall?.args[0]).toMatchObject(HANDOFF_CLEARED_COLUMNS)
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'request.handed_back',
        entityId: 'req-1',
        metadata: expect.objectContaining({ reason: 'client_acted', trigger: 'review_approved' }),
      }),
    )
    expect(vi.mocked(notifyRequestTeam)).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the request is not waiting on anyone', async () => {
    const { handle, queries } = makeDb([[{ ...request, waitingOnContactId: null }]])
    const cleared = await handBackOnClientAction(handle as never, {
      requestId: 'req-1',
      contactId: 'contact-1',
      contactName: null,
      trigger: 'thread_message',
    })
    expect(cleared).toBe(false)
    expect(queries).toHaveLength(1)
    expect(vi.mocked(notifyRequestTeam)).not.toHaveBeenCalled()
  })

  it('does nothing when a DIFFERENT contact at the same client acts', async () => {
    const { handle, queries } = makeDb([[request]])
    const cleared = await handBackOnClientAction(handle as never, {
      requestId: 'req-1',
      contactId: 'contact-2',
      contactName: 'Someone Else',
      trigger: 'file_uploaded',
    })
    expect(cleared).toBe(false)
    expect(queries).toHaveLength(1)
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled()
  })

  it('does nothing without a contact id at all', async () => {
    const { handle, queries } = makeDb([[request]])
    const cleared = await handBackOnClientAction(handle as never, {
      requestId: 'req-1',
      contactId: null,
      contactName: null,
      trigger: 'file_uploaded',
    })
    expect(cleared).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('swallows a database failure rather than failing the write it rides on', async () => {
    const exploding = {
      select: () => { throw new Error('no such column: waiting_on_contact_id') },
    }
    await expect(handBackOnClientAction(exploding as never, {
      requestId: 'req-1',
      contactId: 'contact-1',
      contactName: null,
      trigger: 'thread_message',
    })).resolves.toBe(false)
  })
})
