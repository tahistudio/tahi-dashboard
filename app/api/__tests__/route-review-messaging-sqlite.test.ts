import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn(), auth: vi.fn(), currentUser: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/notifications', () => ({
  notifyMentionedPerson: vi.fn(), notifyOrgContacts: vi.fn(), notifyTeamMember: vi.fn(),
}))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireConversationAccess } from '@/app/api/admin/conversations/_access'
import { POST as addFile } from '@/app/api/admin/requests/[id]/files/route'
import { POST as postMessage } from '@/app/api/admin/requests/[id]/messages/route'
import { GET as readReceipts } from '@/app/api/admin/requests/[id]/reads/route'
import { loadInboxThreads, loadThreadMessages } from '@/lib/messages-store'
import * as conversations from '@/app/api/admin/conversations/route'

const TABLES = [
  schema.organisations, schema.contacts, schema.requests, schema.files,
  schema.messages, schema.voiceNotes, schema.conversations, schema.conversationParticipants,
  schema.requestParticipants, schema.requestReads, schema.teamMembers, schema.roles,
  schema.teamMemberRoles, schema.permissions, schema.rolePermissions, schema.featureVisibility,
  schema.teamMemberAccess, schema.teamMemberAccessOrgs,
]
let fixture: ReturnType<typeof permissionSqlite>
const context = { params: Promise.resolve({ id: 'request-a' }) }
function request(method: string, body?: object) {
  return new NextRequest('http://localhost/api/admin/requests/request-a', {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  fixture = permissionSqlite(TABLES)
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'test' })
  for (const [id, role] of [['member', 'project_manager'], ['admin', 'admin'], ['super', 'super_admin']] as const) {
    fixture.insert(schema.roles, { id: `role-${id}`, name: role })
    fixture.insert(schema.teamMembers, { id, clerk_user_id: `user_${id}`, name: id, role: 'member' })
    fixture.insert(schema.teamMemberRoles, { id: `assignment-${id}`, team_member_id: id, role_id: `role-${id}`, ended_at: null })
  }
  fixture.insert(schema.permissions, { id: 'requests-view', resource: 'requests', action: 'view' })
  fixture.insert(schema.rolePermissions, { id: 'member-requests', role_id: 'role-member', permission_id: 'requests-view' })
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'member', role: 'task_handler', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: 'org-a' })
  fixture.insert(schema.organisations, { id: 'org-a', name: 'A' })
  fixture.insert(schema.requests, { id: 'request-a', org_id: 'org-a', title: 'Request', status: 'submitted', is_internal: 1 })
})

afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('review corrections for conversation access', () => {
  it.each(['user_member', 'user_admin', 'user_super', 'api-service'])('keeps an orphaned request conversation available to %s', async userId => {
    fixture.insert(schema.conversations, { id: 'orphan', type: 'request_thread', org_id: 'org-a', request_id: 'deleted-request' })
    fixture.insert(schema.conversationParticipants, { id: 'participant', conversation_id: 'orphan', participant_id: userId === 'api-service' ? userId : userId.replace('user_', ''), participant_type: 'team_member' })
    const access = await requireConversationAccess(fixture.database, { userId, orgId: 'org_tahi' }, 'orphan')
    expect(access.ok).toBe(true)
    expect(fixture.errors).toEqual([])
  })

  it('refuses a request-linked conversation when requests is denied', async () => {
    fixture.insert(schema.conversations, { id: 'thread', type: 'request_thread', org_id: 'org-a', request_id: 'request-a' })
    fixture.insert(schema.conversationParticipants, { id: 'participant', conversation_id: 'thread', participant_id: 'member', participant_type: 'team_member' })
    fixture.insert(schema.featureVisibility, { id: 'deny-requests', subject_type: 'team_member', subject_id: 'member', feature_key: 'requests', effect: 'deny' })
    const access = await requireConversationAccess(fixture.database, { userId: 'user_member', orgId: 'org_tahi' }, 'thread')
    expect(access.ok).toBe(false)
    if (!access.ok) expect(access.response.status).toBe(403)
  })

  it('hides existing request conversations and refuses creating them when requests is denied', async () => {
    fixture.insert(schema.conversations, { id: 'thread', type: 'request_thread', org_id: 'org-a', request_id: 'request-a' })
    fixture.insert(schema.conversationParticipants, { id: 'participant', conversation_id: 'thread', participant_id: 'member', participant_type: 'team_member' })
    fixture.insert(schema.featureVisibility, { id: 'deny-requests', subject_type: 'team_member', subject_id: 'member', feature_key: 'requests', effect: 'deny' })
    expect(await (await conversations.GET(request('GET'))).json()).toEqual({ conversations: [] })
    expect((await conversations.POST(request('POST', { type: 'request_thread', orgId: 'org-a', requestId: 'request-a', visibility: 'internal' }))).status).toBe(403)
    expect(fixture.rows(schema.conversations)).toHaveLength(1)
  })
})

describe('review corrections for request file registration', () => {
  it.each(['org-b/request/file.pdf', 'org_tahi/request/file.pdf'])('rejects a key outside the request org: %s', async storageKey => {
    expect((await addFile(request('POST', { fileName: 'file.pdf', storageKey }), context)).status).toBe(403)
    expect(fixture.rows(schema.files)).toEqual([])
  })

  it('refuses duplicate storage keys without changing the existing file', async () => {
    fixture.insert(schema.files, { id: 'existing', org_id: 'org-a', storage_key: 'org-a/request/file.pdf', filename: 'Original' })
    const before = fixture.rows(schema.files)
    expect((await addFile(request('POST', { fileName: 'Replacement', storageKey: 'org-a/request/file.pdf' }), context)).status).toBe(409)
    expect(fixture.rows(schema.files)).toEqual(before)
  })

  it.each(['user_member', 'user_admin', 'user_super', 'api-service'])('keeps valid file registration working for %s', async userId => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
    expect((await addFile(request('POST', { fileName: 'File', storageKey: 'org-a/request/file.pdf' }), context)).status).toBe(201)
    expect(fixture.rows(schema.files)).toMatchObject([{ org_id: 'org-a', request_id: 'request-a' }])
    expect(fixture.errors).toEqual([])
  })
})

describe('review corrections for request message destinations', () => {
  it.each(['direct', 'group'])('rejects a private %s conversation without an org or request link', async type => {
    fixture.insert(schema.conversations, { id: 'private', type, org_id: null, request_id: null })
    fixture.insert(schema.conversationParticipants, { id: 'participant', conversation_id: 'private', participant_id: 'member', participant_type: 'team_member' })
    expect((await postMessage(request('POST', { body: 'Denied', conversationId: 'private' }), context)).status).toBe(400)
    expect(fixture.rows(schema.messages)).toEqual([])
  })

  it('requires participation for a same-org conversation that is not this request thread', async () => {
    fixture.insert(schema.conversations, { id: 'room', type: 'group', org_id: 'org-a' })
    expect((await postMessage(request('POST', { body: 'Denied', conversationId: 'room' }), context)).status).toBe(403)
    expect(fixture.rows(schema.messages)).toEqual([])
    fixture.insert(schema.conversationParticipants, { id: 'participant', conversation_id: 'room', participant_id: 'member', participant_type: 'team_member' })
    expect((await postMessage(request('POST', { body: 'Allowed', conversationId: 'room' }), context)).status).toBe(201)
    expect(fixture.rows(schema.messages)).toMatchObject([{ conversation_id: 'room', request_id: 'request-a' }])
  })

  it.each(['user_member', 'user_admin', 'user_super', 'api-service'])('keeps a linked request thread writable for %s without a participant row', async userId => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
    fixture.insert(schema.conversations, { id: 'thread', type: 'request_thread', org_id: null, request_id: 'request-a' })
    expect((await postMessage(request('POST', { body: 'Allowed', conversationId: 'thread' }), context)).status).toBe(201)
    expect(fixture.rows(schema.messages)).toMatchObject([{ conversation_id: 'thread', request_id: 'request-a' }])
    expect(fixture.errors).toEqual([])
  })
})

describe('review corrections for existing message and contact metadata', () => {
  it.each(['studio', 'client'] as const)('keeps message author names after a contact moves orgs for %s readers', async audience => {
    await fixture.database.update(schema.requests).set({ isInternal: false, updatedAt: '2026-10-14T00:00:00Z' }).where(eq(schema.requests.id, 'request-a'))
    fixture.insert(schema.organisations, { id: 'org-b', name: 'B' })
    fixture.insert(schema.contacts, { id: 'moved-author', org_id: 'org-a', name: 'Moved author' })
    fixture.insert(schema.contacts, { id: 'foreign-author', org_id: 'org-b', name: 'Outside author' })
    fixture.insert(schema.requests, { id: 'request-b', org_id: 'org-b', title: 'Outside request', status: 'submitted', is_internal: 0, updated_at: '2026-10-14T00:00:00Z' })
    fixture.insert(schema.conversations, { id: 'channel-a', type: 'org_channel', org_id: 'org-a' })
    fixture.insert(schema.conversations, { id: 'channel-b', type: 'org_channel', org_id: 'org-b' })
    for (const [id, orgId, requestId, conversationId, authorId] of [
      ['request-message', 'org-a', 'request-a', null, 'moved-author'],
      ['channel-message', 'org-a', null, 'channel-a', 'moved-author'],
      ['foreign-request-message', 'org-b', 'request-b', null, 'foreign-author'],
      ['foreign-channel-message', 'org-b', null, 'channel-b', 'foreign-author'],
    ] as const) {
      fixture.insert(schema.messages, { id, org_id: orgId, request_id: requestId, conversation_id: conversationId, author_id: authorId, author_type: 'contact', body: id, is_internal: 0, created_at: '2026-10-14T00:00:00Z' })
    }
    if (audience === 'studio') {
      for (const [id, requestId, conversationId] of [['wrong-org-request', 'request-a', null], ['wrong-org-channel', null, 'channel-a']] as const) {
        fixture.insert(schema.messages, { id, org_id: 'org-b', request_id: requestId, conversation_id: conversationId, author_id: 'foreign-author', author_type: 'contact', body: 'Outside message', is_internal: 0, created_at: '2026-10-14T01:00:00Z' })
      }
    }
    await fixture.database.update(schema.contacts).set({ orgId: 'org-b' }).where(eq(schema.contacts.id, 'moved-author'))

    const viewer = audience === 'studio'
      ? { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' as const }
      : { clerkUserId: 'client-user', domainId: null, userType: 'contact' as const }
    const orgScope = { kind: 'some' as const, orgIds: ['org-a'] }
    const inbox = await loadInboxThreads(fixture.database, {
      viewer, scope: { orgIds: ['org-a'], brandIds: null, audience, orgScope },
      channelsByOrg: new Map([['org-a', 'channel-a']]), orgNames: new Map(), now: new Date('2026-10-14T00:00:00Z'),
    })
    expect(inbox.threads.map(item => item.id).sort()).toEqual(['channel-a', 'request-a'])
    expect(inbox.threads.map(item => item.lastMessage?.authorName)).toEqual(['Moved author', 'Moved author'])
    for (const [source, id, messageId] of [['request', 'request-a', 'request-message'], ['channel', 'channel-a', 'channel-message']] as const) {
      const thread = await loadThreadMessages(fixture.database, { source, id, orgId: 'org-a', viewer, audience, orgScope })
      expect(thread.map(message => ({ id: message.id, authorName: message.authorName }))).toEqual([{ id: messageId, authorName: 'Moved author' }])
    }
    expect(fixture.errors).toEqual([])
  })

  it('keeps names on existing read receipts when the contact now belongs to another org', async () => {
    fixture.insert(schema.contacts, { id: 'moved', clerk_user_id: 'client-user', org_id: 'org-b', name: 'Existing reader' })
    fixture.insert(schema.requestReads, { id: 'read', request_id: 'request-a', user_id: 'client-user', user_type: 'contact', last_read_at: '2026-10-14T00:00:00Z' })
    const response = await readReceipts(request('GET'), context)
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).toContain('Existing reader')
  })

  it('keeps legacy client message rows in the permitted request and channel', async () => {
    await fixture.database.update(schema.requests).set({ isInternal: false, updatedAt: '2026-10-14T00:00:00Z' }).where(eq(schema.requests.id, 'request-a'))
    fixture.insert(schema.conversations, { id: 'channel', type: 'org_channel', org_id: 'org-a' })
    for (const [id, requestId, conversationId] of [['request-message', 'request-a', null], ['channel-message', null, 'channel']] as const) {
      fixture.insert(schema.messages, { id, org_id: 'legacy-org', request_id: requestId, conversation_id: conversationId, author_id: 'member', author_type: 'team_member', body: 'Legacy reply', is_internal: 0, created_at: '2026-10-14T00:00:00Z' })
    }
    const viewer = { clerkUserId: 'client-user', domainId: null, userType: 'contact' as const }
    const thread = await loadThreadMessages(fixture.database, { source: 'request', id: 'request-a', orgId: 'org-a', viewer, audience: 'client' })
    expect(thread.map(message => message.id)).toEqual(['request-message'])
    const inbox = await loadInboxThreads(fixture.database, { viewer, scope: { orgIds: ['org-a'], brandIds: null, audience: 'client' }, channelsByOrg: new Map([['org-a', 'channel']]), orgNames: new Map(), now: new Date('2026-10-14T00:00:00Z') })
    expect(inbox.threads.map(item => item.source).sort()).toEqual(['channel', 'request'])
    expect(inbox.threads.map(item => item.lastMessage?.snippet)).toEqual(['Legacy reply', 'Legacy reply'])
    const studioInbox = await loadInboxThreads(fixture.database, { viewer: { clerkUserId: 'user_member', domainId: 'member', userType: 'team_member' }, scope: { orgIds: ['org-a'], brandIds: null, audience: 'studio', requestsEnabled: false }, channelsByOrg: new Map([['org-a', 'channel']]), orgNames: new Map(), now: new Date('2026-10-14T00:00:00Z') })
    expect(studioInbox.threads.every(item => item.source === 'channel')).toBe(true)
    expect(fixture.errors).toEqual([])
  })
})
