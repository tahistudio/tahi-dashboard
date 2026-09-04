import { describe, it, expect } from 'vitest'
import {
  isGeneralTimer,
  generalTimerNotes,
  resolveTimerOrgId,
  timerLogFailureMessage,
  GENERAL_KINDS,
} from './timer-helpers'
import { INTERNAL_ORG_ID } from './internal-org'
import { schema } from '@/db/d1'

describe('generalTimerNotes', () => {
  it('labels each general kind in plain words', () => {
    expect(generalTimerNotes('request')).toBe('General requests time')
    expect(generalTimerNotes('task')).toBe('General tasks time')
    expect(generalTimerNotes('client')).toBe('General client time')
  })
  it('lists exactly the three kinds the picker offers', () => {
    expect(GENERAL_KINDS).toEqual(['request', 'task', 'client'])
  })
})

describe('isGeneralTimer', () => {
  it('is true only when the timer points at the internal org and nothing else', () => {
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: INTERNAL_ORG_ID })).toBe(true)
    expect(isGeneralTimer({ requestId: 'r1', taskId: null, orgId: INTERNAL_ORG_ID })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: 'some-client' })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Which client a stopped timer's hours belong to (Tier 1 item 12).
// ---------------------------------------------------------------------------
// Task timers used to persist no org at all, so stopping one found nothing to
// file the hours against, skipped the time entry, deleted the timer anyway and
// let the UI toast success. The derivation now comes off the timer's own
// target row, never off the caller.

type FakeRow = Record<string, unknown>
type FakeTables = { requests?: FakeRow[]; tasks?: FakeRow[]; organisations?: FakeRow[] }
type FakeDrizzle = Parameters<typeof resolveTimerOrgId>[0]

function fakeDrizzle(tables: FakeTables) {
  const inserted: FakeRow[] = []

  function chain(rows: FakeRow[]) {
    const promise = Promise.resolve(rows) as Promise<FakeRow[]> & {
      where: () => typeof promise
      limit: () => typeof promise
    }
    promise.where = () => promise
    promise.limit = () => promise
    return promise
  }

  const api = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.requests) return chain(tables.requests ?? [])
        if (table === schema.tasks) return chain(tables.tasks ?? [])
        if (table === schema.organisations) return chain(tables.organisations ?? [])
        return chain([])
      },
    }),
    insert: () => ({
      values: (values: FakeRow) => {
        inserted.push(values)
        return Promise.resolve(undefined)
      },
    }),
  }

  return { drizzle: api as unknown as FakeDrizzle, inserted }
}

describe('resolveTimerOrgId', () => {
  it('takes a request timer to the request owner', async () => {
    const { drizzle } = fakeDrizzle({ requests: [{ orgId: 'org_client_a' }] })
    const orgId = await resolveTimerOrgId(drizzle, { requestId: 'req1', taskId: null, orgId: null })
    expect(orgId).toBe('org_client_a')
  })

  it('takes a task timer to the task owner', async () => {
    const { drizzle } = fakeDrizzle({ tasks: [{ orgId: 'org_client_b', requestId: null }] })
    const orgId = await resolveTimerOrgId(drizzle, { requestId: null, taskId: 'task1', orgId: null })
    expect(orgId).toBe('org_client_b')
  })

  it('falls back to the linked request when the task carries no client', async () => {
    const { drizzle } = fakeDrizzle({
      tasks: [{ orgId: null, requestId: 'req9' }],
      requests: [{ orgId: 'org_client_c' }],
    })
    const orgId = await resolveTimerOrgId(drizzle, { requestId: null, taskId: 'task1', orgId: null })
    expect(orgId).toBe('org_client_c')
  })

  it('books a tahi_internal task against the hidden studio org rather than losing it', async () => {
    const { drizzle, inserted } = fakeDrizzle({ tasks: [{ orgId: null, requestId: null }] })
    const orgId = await resolveTimerOrgId(drizzle, { requestId: null, taskId: 'task1', orgId: null })
    expect(orgId).toBe(INTERNAL_ORG_ID)
    expect(inserted[0]?.id).toBe(INTERNAL_ORG_ID)
  })

  it('keeps a client timer on its own client', async () => {
    const { drizzle } = fakeDrizzle({})
    const orgId = await resolveTimerOrgId(drizzle, { requestId: null, taskId: null, orgId: 'org_client_d' })
    expect(orgId).toBe('org_client_d')
  })

  it('returns null when there is genuinely nothing to attribute to', async () => {
    const { drizzle } = fakeDrizzle({})
    const orgId = await resolveTimerOrgId(drizzle, { requestId: null, taskId: null, orgId: null })
    expect(orgId).toBeNull()
  })

  it('falls back to the timer row when the target request is gone', async () => {
    const { drizzle } = fakeDrizzle({ requests: [] })
    const orgId = await resolveTimerOrgId(drizzle, { requestId: 'req_gone', taskId: null, orgId: 'org_client_e' })
    expect(orgId).toBe('org_client_e')
  })
})

describe('timerLogFailureMessage', () => {
  it('says what went wrong in plain words', () => {
    expect(timerLogFailureMessage('no_client')).toContain('not attached to a request, task or client')
    expect(timerLogFailureMessage('no_team_member_row_for_user')).toContain('not linked to a team member')
    expect(timerLogFailureMessage('insert_failed')).toContain('saving the time entry failed')
  })

  it('stays honest about an unknown or missing reason', () => {
    expect(timerLogFailureMessage(undefined)).toBe('The hours were not logged.')
    expect(timerLogFailureMessage('something_new')).toBe('The hours were not logged.')
  })

  it('never claims the hours landed', () => {
    for (const reason of ['no_client', 'no_team_member_row_for_user', 'insert_failed', undefined]) {
      expect(timerLogFailureMessage(reason)).toContain('not logged')
    }
  })
})
