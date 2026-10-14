import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Param, is } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { SuggestionRow } from '@/lib/task-suggestions'
import type { SlackIdentity } from '../identity'
import { SLACK_DENIED_LINE } from '../identity'

let row: SuggestionRow
const choices = [{ id: 'one', name: 'Client One' }, { id: 'two', name: 'Client Two' }]
const reachable = new Set<string>()
const orgs = new Map<string, { id: string; name: string }>()
const writes: Array<{ table: unknown; values: Record<string, unknown>; condition: unknown }> = []
let raceLost = false
const updateMessage = vi.fn()
const decideSuggestion = vi.fn()
const scopeChecks: Array<{ actorId: string; orgId: string | null; features: readonly string[] }> = []

vi.mock('../api', () => ({ updateMessage: (...args: unknown[]) => updateMessage(...args) }))
vi.mock('../entitlement', () => ({
  studioReachesOrg: async (_database: unknown, actorId: string, orgId: string | null, features: readonly string[]) => {
    scopeChecks.push({ actorId, orgId, features })
    return !!orgId && reachable.has(orgId)
  },
  clientMayFileRequests: async () => false,
}))
vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  return { ...actual, loadSuggestion: async () => row, decideSuggestion: (...args: unknown[]) => decideSuggestion(...args) }
})

const { handleSuggestionAction } = await import('../dispatch-actions')

const member: SlackIdentity = { id: 'identity', slackTeamId: 'T1', slackUserId: 'U1', email: 'member@tahi.studio',
  level: 'member', teamMemberId: 'member', contactId: null, orgId: null, dmChannelId: 'D1' }

function valuesIn(condition: unknown): unknown[] {
  if (is(condition, Param)) return [(condition as Param).value]
  const chunks = (condition as { queryChunks?: unknown[] } | null)?.queryChunks ?? []
  return chunks.flatMap(valuesIn)
}

function database() {
  return {
    select: () => ({ from: () => ({ where: (condition: unknown) => ({ limit: async () => {
      const [id] = valuesIn(condition)
      const org = typeof id === 'string' ? orgs.get(id) : undefined
      return org ? [org] : []
    } }) }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (condition: unknown) => {
      writes.push({ table, values, condition })
      return { returning: async () => raceLost ? [] : [{ id: row.id }] }
    } }) }),
  } as unknown as Parameters<typeof handleSuggestionAction>[0]['drizzle']
}

function click(action: 'tweak' | 'choose_client', value: string, identity = member, channelId = 'D1') {
  return handleSuggestionAction({ drizzle: database(), identity, payload: { actionId: `sugg:${action}:s1`, value,
    slackUserId: identity.slackUserId, slackTeamId: identity.slackTeamId, channelId, messageTs: '100.1' } })
}

beforeEach(() => {
  row = { id: 's1', kind: 'create_task', sourceKind: 'note', approverType: 'member', approverId: 'member',
    orgId: null, status: 'pending', quote: 'Send Elevate invoice by Friday',
    proposal: JSON.stringify({ title: 'Send Elevate invoice', type: 'tahi_internal', dueDate: '2026-10-16', slackClientChoices: choices }),
  } as SuggestionRow
  reachable.clear()
  choices.forEach(choice => reachable.add(choice.id))
  orgs.clear()
  choices.forEach(choice => orgs.set(choice.id, choice))
  writes.length = 0
  scopeChecks.length = 0
  raceLost = false
  vi.clearAllMocks()
})

describe('Tweak client choices on the sender private card', () => {
  it('requires confirmation for a single contact-only client candidate', async () => {
    row.proposal = JSON.stringify({ title: 'Review homepage', type: 'tahi_internal', slackClientChoices: choices.slice(0, 1) })
    expect(await click('tweak', 'choose_client')).toMatchObject({ reply: null })
    expect(writes).toHaveLength(0)
    expect(JSON.stringify(updateMessage.mock.calls)).toContain('Client?')
    expect(await click('choose_client', 'one')).toMatchObject({ reply: null })
    expect(writes).toHaveLength(1)
    expect(writes[0].values.orgId).toBe('one')
    expect(valuesIn(writes[0].condition)).toContain(row.proposal)
    expect(decideSuggestion).not.toHaveBeenCalled()
  })

  it('shows current client names only after rechecking each candidate scope, with no item writes', async () => {
    orgs.set('one', { id: 'one', name: 'Renamed Client One' })
    expect(await click('tweak', 'choose_client')).toMatchObject({ reply: null })
    expect(JSON.stringify(updateMessage.mock.calls)).toContain('Renamed Client One')
    expect(scopeChecks).toEqual(choices.map(choice => ({ actorId: 'member', orgId: choice.id, features: ['tasks', 'requests'] })))
    expect(writes).toHaveLength(0)
    expect(decideSuggestion).not.toHaveBeenCalled()
  })

  it('updates only the pending suggestion client and preserves the due date for a subsequent Approve', async () => {
    expect(await click('choose_client', 'two')).toMatchObject({ reply: null })
    expect(writes).toHaveLength(1)
    expect(writes[0].table).toBe(schema.taskSuggestions)
    expect(writes[0].values.orgId).toBe('two')
    const proposal = JSON.parse(String(writes[0].values.proposal)) as Record<string, unknown>
    expect(proposal).toMatchObject({ orgId: 'two', type: 'internal_client_task', dueDate: '2026-10-16' })
    expect(proposal.slackClientChoices).toBeUndefined()
    expect(valuesIn(writes[0].condition)).toContain('pending')
    expect(valuesIn(writes[0].condition)).toContain(row.proposal)
    expect(valuesIn(writes[0].condition)).toContain('member')
    expect(JSON.stringify(updateMessage.mock.calls)).toContain('Approve')
    expect(decideSuggestion).not.toHaveBeenCalled()
  })

  it('refuses a candidate id that was not stored on the proposal', async () => {
    expect((await click('choose_client', 'other')).reply).toBe(SLACK_DENIED_LINE)
    expect(writes).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it.each(['applied', 'rejected', 'snoozed'])('refuses a stale %s card', async status => {
    row.status = status
    await click('choose_client', 'one')
    expect(writes).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('refuses another member, another founder, a client, and a non-private channel', async () => {
    for (const identity of [
      { ...member, teamMemberId: 'other' },
      { ...member, level: 'founder' as const, teamMemberId: 'founder' },
      { ...member, level: 'client' as const, teamMemberId: null, contactId: 'contact', orgId: 'one' },
    ]) await click('choose_client', 'one', identity)
    await click('tweak', 'choose_client', member, 'C_SHARED')
    expect(writes).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('refuses a deleted candidate or access removed since the draft', async () => {
    reachable.delete('two')
    await click('tweak', 'choose_client')
    await click('choose_client', 'one')
    reachable.add('two')
    orgs.delete('two')
    await click('choose_client', 'one')
    expect(writes).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('refuses resolving a call suggestion, a resolved client, or non-create work', async () => {
    row.sourceKind = 'call'
    await click('choose_client', 'one')
    row.sourceKind = 'note'
    row.orgId = 'one'
    await click('choose_client', 'one')
    row.orgId = null
    row.kind = 'update_task'
    await click('choose_client', 'one')
    expect(writes).toHaveLength(0)
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('does not overwrite a suggestion changed between read and selection', async () => {
    raceLost = true
    expect((await click('choose_client', 'one')).reply).toBe('That one was already decided.')
    expect(updateMessage).not.toHaveBeenCalled()
    expect(decideSuggestion).not.toHaveBeenCalled()
  })
})
