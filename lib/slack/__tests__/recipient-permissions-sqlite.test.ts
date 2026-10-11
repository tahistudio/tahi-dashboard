import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'
import { schema } from '@/db/d1'

vi.mock('@/lib/slack/api', () => ({
  slackBotToken: () => process.env.SLACK_BOT_TOKEN || null,
  postMessage: vi.fn(), updateMessage: vi.fn(), openDm: vi.fn(),
}))

import { openDm, postMessage, updateMessage } from '../api'
import { runSuggestionDigest } from '../digest'
import {
  mirrorSuggestionDecision, postSuggestionsForCall, recordSuggestionMessage,
  repostSuggestion, rewriteEverywhere, rewriteSuggestionMessage,
} from '../mirror'
import { resolvePermissions, can } from '@/lib/permissions'
import { studioReachesOrg } from '../entitlement'

const MONDAY = new Date('2026-09-27T19:30:00Z')
const CREATED = '2026-09-25T00:00:00Z'
const DIGEST_DDL = readFileSync('drizzle/migrations/0111_cn3_sync.sql', 'utf8')
  .match(/CREATE TABLE IF NOT EXISTS slack_digests[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_digests_week_user[^;]*;/)![0]
let fixture: ReturnType<typeof permissionSqlite>

interface Scenario {
  name?: string
  denied?: 'tasks' | 'requests'
  studio?: boolean
  ended?: boolean
  cachedFounder?: boolean
  noScope?: boolean
  missingIdentity?: boolean
  duplicateIdentity?: boolean
  missingLogin?: boolean
  failedLookup?: boolean
}

const deniedCases: Scenario[] = [
  { name: 'task feature denied', denied: 'tasks' },
  { name: 'null-org task feature denied', denied: 'tasks', studio: true },
  { name: 'request feature denied', denied: 'requests' },
  { name: 'member role ended', ended: true },
  { name: 'cached founder role ended', cachedFounder: true, ended: true },
  { name: 'cached founder null-org role ended', cachedFounder: true, ended: true, studio: true },
  { name: 'cached founder downgraded', cachedFounder: true },
  { name: 'organisation scope revoked', noScope: true },
  { name: 'null-org scope revoked', noScope: true, studio: true },
  { name: 'recipient identity missing', missingIdentity: true },
  { name: 'recipient channel ambiguous', duplicateIdentity: true },
  { name: 'recipient Clerk login missing', missingLogin: true },
  { name: 'permission lookup failed', failedLookup: true },
]

function card(scenario: Scenario = {}) {
  return {
    id: 'private-note', orgId: scenario.studio ? null : 'org_a',
    kind: scenario.denied === 'requests' ? 'create_request' : 'create_task',
    approverType: 'member', approverId: 'tm_reader',
    proposal: { title: 'PRIVATE_CHANGED_WORK_TITLE' }, quote: 'PRIVATE_NEW_TRANSCRIPT_QUOTE',
    confidence: 0.9, orgName: 'Private client A', similar: [],
  }
}

const founder = {
  id: 'si_reader', slackTeamId: 'T_TEST', slackUserId: 'U_READER', email: 'reader@example.test',
  level: 'founder' as const, teamMemberId: 'tm_reader', contactId: null, orgId: null, dmChannelId: 'D_READER',
}

async function seed(scenario: Scenario = {}) {
  fixture.insert(schema.organisations, { id: 'org_a', name: 'Private client A' })
  fixture.insert(schema.teamMembers, {
    id: 'tm_reader', clerk_user_id: scenario.missingLogin ? null : 'user_reader', role: 'member', name: 'Reader',
  })
  fixture.insert(schema.teamMembers, { id: 'tm_keeper', clerk_user_id: 'user_keeper', name: 'Keeper' })
  fixture.insert(schema.roles, { id: 'role_super', name: 'super_admin' })
  fixture.insert(schema.roles, { id: 'role_member', name: 'task_handler' })
  fixture.insert(schema.teamMemberRoles, {
    id: 'keeper', team_member_id: 'tm_keeper', role_id: 'role_super', ended_at: null,
  })
  fixture.insert(schema.teamMemberRoles, {
    id: 'reader', team_member_id: 'tm_reader', role_id: scenario.ended ? 'role_super' : 'role_member',
    ended_at: scenario.ended ? '2026-09-26T00:00:00Z' : null,
  })
  for (const feature of ['tasks', 'requests']) {
    fixture.insert(schema.permissions, { id: feature, resource: feature, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: feature, role_id: 'role_member', permission_id: feature })
  }
  if (scenario.denied) fixture.insert(schema.featureVisibility, {
    id: 'deny', subject_type: 'team_member', subject_id: 'tm_reader', feature_key: scenario.denied, effect: 'deny',
  })
  if (!scenario.noScope) {
    fixture.insert(schema.teamMemberAccess, { id: 'access', team_member_id: 'tm_reader', scope_type: 'specific_clients' })
    fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'access', org_id: 'org_a' })
  }
  if (!scenario.missingIdentity) fixture.insert(schema.slackIdentities, {
    id: 'si_reader', slack_team_id: 'T_TEST', slack_user_id: 'U_READER',
    level: scenario.cachedFounder ? 'founder' : 'member', team_member_id: 'tm_reader', dm_channel_id: 'D_READER',
  })
  if (scenario.duplicateIdentity) fixture.insert(schema.slackIdentities, {
    id: 'si_duplicate', slack_team_id: 'T_TEST', slack_user_id: 'U_OTHER',
    level: 'member', team_member_id: 'tm_reader', dm_channel_id: 'D_READER',
  })
  const row = card(scenario)
  fixture.insert(schema.taskSuggestions, {
    id: row.id, org_id: row.orgId, source_kind: 'note', kind: row.kind,
    proposal: JSON.stringify(row.proposal), quote: row.quote, status: 'pending',
    approver_type: row.approverType, approver_id: row.approverId,
    dedupe_key: row.id, created_at: CREATED, updated_at: CREATED,
  })
  await recordSuggestionMessage(fixture.database, { suggestionId: row.id, channelId: 'D_READER', ts: '99.1' })
  if (scenario.failedLookup) await fixture.database.run(sql`DROP TABLE feature_visibility`)
  return row
}

async function makeFounder() {
  await fixture.database.update(schema.teamMemberRoles).set({ roleId: 'role_super', endedAt: null })
    .where(eq(schema.teamMemberRoles.id, 'reader'))
  await fixture.database.update(schema.slackIdentities).set({ level: 'founder' })
    .where(eq(schema.slackIdentities.id, 'si_reader'))
}

async function revokeRole(memberId = 'tm_reader') {
  await fixture.database.update(schema.teamMemberRoles).set({ endedAt: MONDAY.toISOString() })
    .where(eq(schema.teamMemberRoles.teamMemberId, memberId))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SLACK_BOT_TOKEN', 'synthetic-test-token')
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi_test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://invalid.local')
  fixture = permissionSqlite([
    schema.taskSuggestions, schema.organisations, schema.teamMembers, schema.roles,
    schema.teamMemberRoles, schema.rolePermissions, schema.permissions, schema.featureVisibility,
    schema.teamMemberAccess, schema.teamMemberAccessOrgs, schema.slackIdentities, schema.settings,
    schema.requests, schema.contacts,
  ], [DIGEST_DDL,
    'CREATE TABLE slack_suggestion_messages (id text PRIMARY KEY, suggestion_id text, channel_id text, ts text, created_at text)',
  ])
  vi.mocked(postMessage).mockImplementation(async input => ({ channel: input.channel, ts: '100.1' }))
  vi.mocked(updateMessage).mockImplementation(async input => ({ channel: input.channel, ts: input.ts }))
  vi.mocked(openDm).mockResolvedValue('D_READER')
})

afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('current Slack recipient permissions over real SQLite', () => {
  it.each(deniedCases)('digest refuses $name, including dry-run recipient content', async scenario => {
    const row = await seed(scenario)
    if (scenario.denied) {
      const access = await resolvePermissions(fixture.database, { userId: 'user_reader', orgId: 'org_tahi_test' })
      expect(can(access, scenario.denied)).toBe(false)
    }
    // Identity uniqueness is an additional delivery boundary. These two
    // fixtures deliberately retain valid roster grants while their DM is invalid.
    expect(await studioReachesOrg(fixture.database, 'tm_reader', row.orgId,
      [scenario.denied === 'requests' ? 'requests' : 'tasks'], { founderOnly: scenario.cachedFounder }))
      .toBe(!!(scenario.missingIdentity || scenario.duplicateIdentity))
    const dry = await runSuggestionDigest(fixture.database, { at: MONDAY, dryRun: true })
    expect(dry.payloads).toEqual([])
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(0)
    expect(postMessage).not.toHaveBeenCalled()
    expect(openDm).not.toHaveBeenCalled()
  })

  it.each(deniedCases)('mirror refuses $name before updates, reposts or initial content', async scenario => {
    const row = await seed(scenario)
    expect(await rewriteEverywhere(fixture.database, row.id, { text: 'PRIVATE_UPDATE', blocks: [] })).toBe(0)
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBe(0)
    expect(await mirrorSuggestionDecision(fixture.database, {
      ...row, status: 'failed', decidedById: 'tm_keeper', decidedAt: MONDAY.toISOString(),
      updatedAt: MONDAY.toISOString(), snoozeUntil: null, applyError: 'PRIVATE_NEW_APPLY_ERROR',
    })).toBe(0)
    expect(await repostSuggestion(fixture.database, row)).toBe(0)
    expect((await postSuggestionsForCall(fixture.database, { rows: [row], founders: [founder], repost: true })).posted).toBe(0)
    expect(updateMessage).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
    expect(openDm).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps permitted own-note delivery with studio=%s', async studio => {
    const row = await seed({ studio })
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(1)
    expect(JSON.stringify(vi.mocked(postMessage).mock.calls)).toContain('PRIVATE_CHANGED_WORK_TITLE')
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBe(1)
    expect(await repostSuggestion(fixture.database, row)).toBe(1)
    expect(fixture.errors).toEqual([])
  })

  it('filters mixed personal notes per kind without hiding the granted family', async () => {
    await seed({ denied: 'tasks' })
    fixture.insert(schema.taskSuggestions, {
      id: 'request-note', org_id: 'org_a', source_kind: 'note', kind: 'create_request',
      proposal: JSON.stringify({ title: 'ALLOWED_REQUEST_TITLE' }), quote: 'PRIVATE_REQUEST_QUOTE',
      status: 'pending', approver_type: 'member', approver_id: 'tm_reader',
      dedupe_key: 'request-note', created_at: CREATED, updated_at: CREATED,
    })
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(1)
    const output = JSON.stringify(vi.mocked(postMessage).mock.calls)
    expect(output).toContain('ALLOWED_REQUEST_TITLE')
    expect(output).not.toContain('PRIVATE_CHANGED_WORK_TITLE')
    expect(output).not.toContain('PRIVATE_REQUEST_QUOTE')
  })

  it('requires the current own-note recipient, even when another member has full feature grants', async () => {
    const row = await seed()
    await fixture.database.update(schema.taskSuggestions).set({ approverId: 'tm_keeper' })
      .where(eq(schema.taskSuggestions.id, row.id))
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(0)
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBe(0)
    expect(await repostSuggestion(fixture.database, row)).toBe(0)
    expect(postMessage).not.toHaveBeenCalled()
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('keeps current founders studio digest, initial header/card, rewrite and repost behavior', async () => {
    const row = await seed()
    await makeFounder()
    await fixture.database.update(schema.taskSuggestions).set({ approverType: 'founders', approverId: null })
      .where(eq(schema.taskSuggestions.id, row.id))
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(1)
    vi.mocked(postMessage).mockClear()
    expect(await postSuggestionsForCall(fixture.database, { rows: [row], founders: [founder], repost: true }))
      .toEqual({ posted: 1, failed: 0, founders: 1 })
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBeGreaterThan(0)
    expect(await repostSuggestion(fixture.database, row)).toBe(1)
    expect(fixture.errors).toEqual([])
  })

  it('initial founder posting keeps their own note and excludes other owners and client drafts from the header and cards', async () => {
    const own = await seed()
    await makeFounder()
    const hidden = [
      { ...own, id: 'other-owner', approverId: 'tm_keeper', proposal: { title: 'OTHER_OWNER_PRIVATE_TITLE' } },
      { ...own, id: 'client-draft', approverType: 'contact', approverId: 'contact_a', proposal: { title: 'CLIENT_PRIVATE_DRAFT' } },
    ]
    for (const row of hidden) fixture.insert(schema.taskSuggestions, {
      id: row.id, org_id: row.orgId, source_kind: 'note', kind: row.kind,
      proposal: JSON.stringify(row.proposal), quote: row.quote, status: 'pending',
      approver_type: row.approverType, approver_id: row.approverId,
      dedupe_key: row.id, created_at: CREATED, updated_at: CREATED,
    })
    expect((await postSuggestionsForCall(fixture.database, {
      rows: [...hidden, own], founders: [founder], repost: true,
    })).posted).toBe(1)
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(postMessage).mock.calls[0][0].text).toContain('1 suggestion')
    const sent = JSON.stringify(vi.mocked(postMessage).mock.calls)
    expect(sent).toContain('PRIVATE_CHANGED_WORK_TITLE')
    expect(sent).not.toContain('OTHER_OWNER_PRIVATE_TITLE')
    expect(sent).not.toContain('CLIENT_PRIVATE_DRAFT')
    expect(fixture.errors).toEqual([])
  })

  it.each(['role', 'identity', 'scope', 'feature'] as const)('rechecks digest %s after opening its DM', async revoked => {
    await seed()
    await fixture.database.update(schema.slackIdentities).set({ dmChannelId: null })
      .where(eq(schema.slackIdentities.id, 'si_reader'))
    vi.mocked(openDm).mockImplementation(async () => {
      if (revoked === 'role') await revokeRole()
      if (revoked === 'identity') await fixture.database.delete(schema.slackIdentities).where(eq(schema.slackIdentities.id, 'si_reader'))
      if (revoked === 'scope') await fixture.database.delete(schema.teamMemberAccess).where(eq(schema.teamMemberAccess.id, 'access'))
      if (revoked === 'feature') fixture.insert(schema.featureVisibility, {
        id: 'late-deny', subject_type: 'team_member', subject_id: 'tm_reader', feature_key: 'tasks', effect: 'deny',
      })
      return 'D_READER'
    })
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).sent).toBe(0)
    expect(openDm).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
    expect(await fixture.database.all(sql`SELECT * FROM slack_digests`)).toEqual([])
  })

  it('rechecks initial founder authorization after opening its DM and sends no header', async () => {
    const row = await seed()
    await makeFounder()
    await fixture.database.update(schema.slackIdentities).set({ dmChannelId: null })
      .where(eq(schema.slackIdentities.id, 'si_reader'))
    vi.mocked(openDm).mockImplementation(async () => { await revokeRole(); return 'D_READER' })
    expect((await postSuggestionsForCall(fixture.database, { rows: [row], founders: [founder], repost: true })).posted).toBe(0)
    expect(openDm).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('rechecks initial posting after the header instead of sending the now-revoked card', async () => {
    const row = await seed()
    await makeFounder()
    vi.mocked(postMessage).mockImplementation(async input => {
      await revokeRole()
      return { channel: input.channel, ts: '100.1' }
    })
    expect((await postSuggestionsForCall(fixture.database, { rows: [row], founders: [founder], repost: true })).posted).toBe(0)
    expect(postMessage).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(postMessage).mock.calls)).not.toContain('PRIVATE_NEW_TRANSCRIPT_QUOTE')
  })

  it.each(['rewrite', 'repost'] as const)('rechecks every %s copy when the next founder is revoked mid-delivery', async operation => {
    const row = await seed()
    await makeFounder()
    await fixture.database.update(schema.taskSuggestions).set({ approverType: 'founders', approverId: null })
      .where(eq(schema.taskSuggestions.id, row.id))
    fixture.insert(schema.slackIdentities, {
      id: 'si_keeper', slack_team_id: 'T_TEST', slack_user_id: 'U_KEEPER', level: 'founder',
      team_member_id: 'tm_keeper', dm_channel_id: 'D_KEEPER',
    })
    await recordSuggestionMessage(fixture.database, { suggestionId: row.id, channelId: 'D_KEEPER', ts: '99.2' })
    vi.mocked(updateMessage).mockImplementation(async input => {
      await revokeRole('tm_keeper')
      return { channel: input.channel, ts: input.ts }
    })
    vi.mocked(postMessage).mockImplementation(async input => {
      await revokeRole('tm_keeper')
      return { channel: input.channel, ts: '100.1' }
    })
    expect(await (operation === 'rewrite'
      ? rewriteSuggestionMessage(fixture.database, row) : repostSuggestion(fixture.database, row))).toBe(1)
    const transport = operation === 'rewrite' ? updateMessage : postMessage
    expect(transport).toHaveBeenCalledOnce()
    expect(vi.mocked(transport).mock.calls[0][0].channel).toBe('D_READER')
  })

  it('rejects founders cards at a currently granted ordinary member channel', async () => {
    const row = await seed()
    await fixture.database.update(schema.taskSuggestions).set({ approverType: 'founders', approverId: null })
      .where(eq(schema.taskSuggestions.id, row.id))
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBe(0)
    expect(await repostSuggestion(fixture.database, row)).toBe(0)
    expect(postMessage).not.toHaveBeenCalled()
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('keeps client-copy exclusions even with a recorded copy and a granted studio recipient', async () => {
    const row = await seed()
    await fixture.database.update(schema.taskSuggestions).set({ approverType: 'contact', approverId: 'contact_a' })
      .where(eq(schema.taskSuggestions.id, row.id))
    expect(await rewriteEverywhere(fixture.database, row.id, { text: 'PRIVATE_UPDATE', blocks: [] })).toBe(0)
    expect(await rewriteSuggestionMessage(fixture.database, { ...row, approverType: 'contact' })).toBe(0)
    expect(await repostSuggestion(fixture.database, { ...row, approverType: 'contact' })).toBe(0)
    expect(postMessage).not.toHaveBeenCalled()
    expect(updateMessage).not.toHaveBeenCalled()
  })

  it('performs zero database calls without Slack configured', async () => {
    const row = await seed()
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const all = vi.spyOn(fixture.database, 'all')
    const select = vi.spyOn(fixture.database, 'select')
    const run = vi.spyOn(fixture.database, 'run')
    expect((await runSuggestionDigest(fixture.database, { at: MONDAY })).reason).toBe('slack_not_configured')
    expect(await rewriteSuggestionMessage(fixture.database, row)).toBe(0)
    expect(await repostSuggestion(fixture.database, row)).toBe(0)
    expect((await postSuggestionsForCall(fixture.database, { rows: [row], founders: [founder], repost: true })).posted).toBe(0)
    expect(all).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
