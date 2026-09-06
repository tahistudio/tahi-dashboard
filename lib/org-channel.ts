/**
 * lib/org-channel.ts
 *
 * The two rooms the Messages inbox resolves lazily, and nothing else.
 *
 *   resolveOrgChannel   the standing line between a client and the studio:
 *                       one `conversations` row per org, type 'org_channel',
 *                       always external, participants = every contact at the
 *                       org plus the team members assigned to it.
 *
 *   resolveRequestThread  the room identity behind a request. The MESSAGES do
 *                       not live in it (they are keyed on messages.request_id
 *                       and always have been), so nothing reads it to build a
 *                       thread. It exists so the room has a name and a
 *                       participant list, and so a message posted from the
 *                       Messages page carries the same conversation_id an
 *                       admin reply from the request detail does.
 *
 * BOTH ARE FIND-OR-CREATE, AND CREATE ONLY EVER HAPPENS ON A WRITE. A portal
 * GET calls these with `create: false` and renders a synthetic empty channel
 * instead: a client opening a page must not write a row, and a studio that has
 * never messaged them must not acquire one just because somebody looked.
 *
 * Idempotence is enforced by the database, not by hope. Migration 0092 adds
 *   UNIQUE (request_id) WHERE type = 'request_thread'
 *   UNIQUE (org_id)     WHERE type = 'org_channel'
 * so two tabs posting in the same second cannot mint two rooms: the loser of
 * the race catches the constraint error and re-reads the winner's row. That
 * re-read is why every create below is wrapped rather than fired and forgotten.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { schema } from '@/db/d1'
import {
  REQUEST_THREAD_CONVERSATION_TYPE,
  REQUEST_THREAD_CONVERSATION_VISIBILITY,
  pickThreadConversationId,
} from '@/lib/request-thread'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const ORG_CHANNEL_TYPE = 'org_channel'
export const ORG_CHANNEL_VISIBILITY = 'external'

export interface ResolveOptions {
  /** Create the room when it does not exist. False on every GET. */
  create: boolean
  /** conversations.created_by_id. The Clerk user id of whoever forced it. */
  createdById: string
}

// ── The org channel ──────────────────────────────────────────────────────────

async function findOrgChannel(database: DrizzleDB, orgId: string): Promise<string | null> {
  const rows = await database
    .select({ id: schema.conversations.id, createdAt: schema.conversations.createdAt })
    .from(schema.conversations)
    .where(and(
      eq(schema.conversations.orgId, orgId),
      eq(schema.conversations.type, ORG_CHANNEL_TYPE),
    ))
  if (rows.length === 0) return null
  // Oldest wins, matching pickThreadConversationId, so a database that
  // predates the unique index still resolves the same row every time.
  const sorted = [...rows].sort((a, b) => {
    const at = a.createdAt ?? ''
    const bt = b.createdAt ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  return sorted[0].id
}

/**
 * The org channel's id, creating it when asked to.
 *
 * Returns null only when `create` is false and there is none yet, which is the
 * normal state of a client nobody has messaged: the caller renders an empty
 * room rather than an error.
 */
export async function resolveOrgChannel(
  database: DrizzleDB,
  orgId: string,
  opts: ResolveOptions,
): Promise<string | null> {
  const existing = await findOrgChannel(database, orgId)
  if (existing) return existing
  if (!opts.create) return null

  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await database.insert(schema.conversations).values({
      id,
      type: ORG_CHANNEL_TYPE,
      name: org?.name ?? 'Your studio line',
      orgId,
      requestId: null,
      visibility: ORG_CHANNEL_VISIBILITY,
      createdById: opts.createdById,
      createdAt: now,
      updatedAt: now,
    })
  } catch {
    // Lost the race against another tab (or the unique index caught a
    // duplicate this process could not see). The winner's row is the answer.
    const won = await findOrgChannel(database, orgId)
    if (won) return won
    throw new Error('Could not resolve the org channel')
  }
  return id
}

// ── The request thread's room identity ───────────────────────────────────────

/**
 * The request's thread conversation id, creating it when asked to.
 *
 * The read half is `pickThreadConversationId`, the same deterministic choice
 * the request detail already makes, so the Messages page and the detail page
 * can never disagree about which row a request's thread is.
 */
export async function resolveRequestThread(
  database: DrizzleDB,
  input: { requestId: string; orgId: string; title?: string | null },
  opts: ResolveOptions,
): Promise<string | null> {
  const rows = await database
    .select({
      id: schema.conversations.id,
      type: schema.conversations.type,
      visibility: schema.conversations.visibility,
      createdAt: schema.conversations.createdAt,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.requestId, input.requestId))
  const existing = pickThreadConversationId(rows)
  if (existing) return existing
  if (!opts.create) return null

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const name = input.title?.trim()
  try {
    await database.insert(schema.conversations).values({
      id,
      type: REQUEST_THREAD_CONVERSATION_TYPE,
      name: name && name.length > 0 ? name : 'Request thread',
      orgId: input.orgId,
      requestId: input.requestId,
      visibility: REQUEST_THREAD_CONVERSATION_VISIBILITY,
      createdById: opts.createdById,
      createdAt: now,
      updatedAt: now,
    })
  } catch {
    const again = await database
      .select({
        id: schema.conversations.id,
        type: schema.conversations.type,
        visibility: schema.conversations.visibility,
        createdAt: schema.conversations.createdAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.requestId, input.requestId))
    const won = pickThreadConversationId(again)
    if (won) return won
    throw new Error('Could not resolve the request thread')
  }
  return id
}

// ── Participants ─────────────────────────────────────────────────────────────

export interface ChannelParticipantSeed {
  participantId: string
  participantType: 'team_member' | 'contact'
}

/**
 * Who belongs in a client's standing room: every contact at the org, plus the
 * team members with a project_manager access rule linked to it, plus anyone
 * already on it.
 *
 * The team half deliberately reuses the SAME join `notifyRequestTeam` reads
 * (lib/notify-request-team.ts), so the people in the room and the people the
 * bell wakes for it are one list. When nobody is assigned yet, the whole
 * studio is seeded: a two-person studio with an unassigned client would
 * otherwise have a room only the client is standing in.
 */
export async function orgChannelParticipants(
  database: DrizzleDB,
  orgId: string,
): Promise<ChannelParticipantSeed[]> {
  const [contactRows, pmRows] = await Promise.all([
    database
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId)),
    database
      .select({ pmId: schema.teamMemberAccess.teamMemberId })
      .from(schema.teamMemberAccess)
      .innerJoin(
        schema.teamMemberAccessOrgs,
        eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id),
      )
      // The ROLE filter is the half that makes this the same list
      // notifyRequestTeam builds. Without it every rule scoped to the org
      // counted, so a `viewer` was seeded into the room, shown in the people
      // stack and woken by every client post: the two audiences the comment
      // above calls one list were genuinely different.
      .where(and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, orgId),
      )),
  ])

  let teamIds = [...new Set(pmRows.map(r => r.pmId).filter((x): x is string => !!x))]
  if (teamIds.length === 0) {
    const all = await database.select({ id: schema.teamMembers.id }).from(schema.teamMembers)
    teamIds = all.map(r => r.id).filter((x): x is string => !!x)
  }

  return [
    ...contactRows.filter(c => !!c.id).map(c => ({ participantId: c.id, participantType: 'contact' as const })),
    ...teamIds.map(id => ({ participantId: id, participantType: 'team_member' as const })),
  ]
}

/**
 * Add whoever is missing from a room. Never removes anyone: leaving a stale
 * participant row behind is harmless (both admin routes re-check org scope on
 * top of participation, see app/api/admin/conversations/_access.ts), whereas
 * removing one would silently drop a reader's unread cursor.
 *
 * Best effort. A room the studio can post into is worth more than a perfect
 * participant list, so a failure here is swallowed rather than failing the
 * send that triggered it.
 */
export async function syncConversationParticipants(
  database: DrizzleDB,
  conversationId: string,
  seeds: readonly ChannelParticipantSeed[],
): Promise<void> {
  if (seeds.length === 0) return
  try {
    const existing = await database
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, conversationId))
    const have = new Set(existing.map(r => r.participantId))
    const now = new Date().toISOString()
    for (const seed of seeds) {
      if (have.has(seed.participantId)) continue
      have.add(seed.participantId)
      try {
        await database.insert(schema.conversationParticipants).values({
          id: crypto.randomUUID(),
          conversationId,
          participantId: seed.participantId,
          participantType: seed.participantType,
          role: 'member',
          joinedAt: now,
        })
      } catch {
        // The unique index caught a concurrent insert of the same person.
        // They are in the room either way, which is the whole point.
      }
    }
  } catch {
    // Participants unreadable. The room still works: reads are keyed on
    // request_id / conversation_id, not on membership.
  }
}

/**
 * Narrow a set of contacts to the ones who can see this brand's work.
 *
 * The same rule as `contactsForBrand` in lib/notifications.ts and as the portal
 * request list: no brand links at all means no scoping, so an ordinary single
 * brand client is unaffected. It is reimplemented here rather than imported
 * because lib/notifications.ts drags @react-email/render and every email
 * template in with it, and this module is read by list routes.
 */
async function contactsOnBrand(
  database: DrizzleDB,
  contactIds: readonly string[],
  brandId: string | null,
): Promise<string[]> {
  const ids = [...contactIds]
  if (ids.length === 0) return ids
  const links = await database
    .select({
      contactId: schema.brandContacts.contactId,
      brandId: schema.brandContacts.brandId,
    })
    .from(schema.brandContacts)
    .where(inArray(schema.brandContacts.contactId, ids))
  if (links.length === 0) return ids

  const brandsByContact = new Map<string, Set<string>>()
  for (const link of links) {
    if (!link.contactId || !link.brandId) continue
    const set = brandsByContact.get(link.contactId) ?? new Set<string>()
    set.add(link.brandId)
    brandsByContact.set(link.contactId, set)
  }
  return ids.filter(id => {
    const brands = brandsByContact.get(id)
    if (!brands || brands.size === 0) return true
    return brandId !== null && brands.has(brandId)
  })
}

/**
 * The people the thread head shows, for either store.
 *
 * A request thread has no participant rows of its own to read (its messages
 * never needed any), so its people are the studio side of the request plus the
 * client's contacts, resolved the same way the channel's are.
 *
 * BRAND IS A CONFIDENTIALITY BOUNDARY ON A REQUEST, and this list is returned
 * to the client, so the org contacts swept in on the 'request' source are held
 * to the request's brand: the same narrowing the portal request list, the inbox
 * list and the studio's email audience already apply. The CHANNEL source stays
 * org wide, which is correct: a standing line belongs to the whole client.
 */
export async function threadPeople(
  database: DrizzleDB,
  input:
    | { source: 'channel'; conversationId: string; orgId: string }
    | { source: 'request'; requestId: string; orgId: string; assigneeId: string | null; brandId: string | null },
): Promise<Array<{ id: string; name: string; avatarUrl: string | null; side: 'team' | 'client' }>> {
  const teamIds = new Set<string>()
  const contactIds = new Set<string>()

  if (input.source === 'channel') {
    const rows = await database
      .select({
        participantId: schema.conversationParticipants.participantId,
        participantType: schema.conversationParticipants.participantType,
      })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, input.conversationId))
    for (const r of rows) {
      if (!r.participantId) continue
      if (r.participantType === 'team_member') teamIds.add(r.participantId)
      else contactIds.add(r.participantId)
    }
  } else {
    if (input.assigneeId) teamIds.add(input.assigneeId)
    const participants = await database
      .select({
        participantId: schema.requestParticipants.participantId,
        participantType: schema.requestParticipants.participantType,
      })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.requestId, input.requestId),
        isNull(schema.requestParticipants.removedAt),
      ))
    for (const p of participants) {
      if (!p.participantId) continue
      if (p.participantType === 'team_member') teamIds.add(p.participantId)
      else contactIds.add(p.participantId)
    }
    const orgContacts = await database
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, input.orgId))
    const onBrand = await contactsOnBrand(
      database,
      orgContacts.map(c => c.id).filter((id): id is string => !!id),
      input.brandId,
    )
    for (const id of onBrand) contactIds.add(id)
  }

  const [teamRows, contactRows] = await Promise.all([
    teamIds.size > 0
      ? database
          .select({ id: schema.teamMembers.id, name: schema.teamMembers.name, avatarUrl: schema.teamMembers.avatarUrl })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.id, [...teamIds]))
      : Promise.resolve([] as Array<{ id: string; name: string; avatarUrl: string | null }>),
    contactIds.size > 0
      ? database
          .select({ id: schema.contacts.id, name: schema.contacts.name })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, [...contactIds]))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])

  return [
    ...teamRows.map(r => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl ?? null, side: 'team' as const })),
    ...contactRows.map(r => ({ id: r.id, name: r.name, avatarUrl: null, side: 'client' as const })),
  ]
}
