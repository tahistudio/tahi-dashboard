/**
 * POST /api/admin/integrations/google/sync-calendar
 *
 * Pulls events from the connected Google Calendar (past 14 days + next
 * 30 days), matches attendees against leads / contacts in the CRM, and
 * auto-creates discovery_call rows on the matching parent.
 *
 * Idempotency: each event has a stable `google_calendar_event_id`. We
 * upsert by that — a re-sync of an existing event updates the existing
 * call row instead of duplicating.
 *
 * Match precedence (most specific first):
 *   1. Any attendee email matches an existing deal contact   → attach to that deal
 *   2. Any attendee email matches an existing client contact → attach to that org
 *   3. Any attendee email matches a lead                     → attach to that lead
 *   4. No match                                              → skip (no parent)
 *
 * Returns a summary { fetched, created, updated, skipped, matched }.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import { getGoogleAccessToken, listCalendarEvents, GoogleNotConnectedError } from '@/lib/google'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()

  // 1. Get a live access token (refreshes if stale).
  let tokens
  try {
    tokens = await getGoogleAccessToken(database)
  } catch (err) {
    const status = err instanceof GoogleNotConnectedError ? 412 : 500
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status })
  }

  // 2. Fetch events for [now - 14d, now + 30d].
  const now = new Date()
  const timeMin = new Date(now.getTime() - 14 * 86400_000).toISOString()
  const timeMax = new Date(now.getTime() + 30 * 86400_000).toISOString()

  let events
  try {
    events = await listCalendarEvents(tokens.accessToken, timeMin, timeMax)
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  // Filter out cancelled events + events with no attendees (likely
  // personal blocks). Keep the user's own email out of the attendee
  // match set so a 1:1 with yourself doesn't count.
  const myEmail = (tokens.email ?? '').toLowerCase()
  const usable = events.filter(e =>
    e.status !== 'cancelled'
    && (e.attendees?.length ?? 0) > 0
    && e.start?.dateTime  // skip all-day events
  )

  // 3. Pre-fetch CRM rows that COULD match any attendee — single query
  // each for leads / contacts. Cheaper than a per-event lookup.
  const allAttendeeEmails = new Set<string>()
  for (const e of usable) {
    for (const a of (e.attendees ?? [])) {
      const email = a.email?.toLowerCase().trim()
      if (email && email !== myEmail) allAttendeeEmails.add(email)
    }
  }
  const emails = Array.from(allAttendeeEmails)

  // Lead lookup (by lead.email)
  const leadRows = emails.length > 0 ? await database
    .select({ id: schema.leads.id, email: schema.leads.email, status: schema.leads.status })
    .from(schema.leads)
    .where(inArray(schema.leads.email, emails)) : []
  const leadByEmail = new Map<string, { id: string; status: string }>()
  for (const r of leadRows) {
    if (r.email) leadByEmail.set(r.email.toLowerCase(), { id: r.id, status: r.status })
  }

  // Contact lookup (by contact.email) — gives us org + active deals
  const contactRows = emails.length > 0 ? await database
    .select({
      id: schema.contacts.id,
      email: schema.contacts.email,
      orgId: schema.contacts.orgId,
    })
    .from(schema.contacts)
    .where(inArray(schema.contacts.email, emails)) : []
  const contactByEmail = new Map<string, { contactId: string; orgId: string | null }>()
  for (const r of contactRows) {
    if (r.email) contactByEmail.set(r.email.toLowerCase(), { contactId: r.id, orgId: r.orgId ?? null })
  }

  // Deal contacts: who's on what deal?
  const contactIds = Array.from(new Set(contactRows.map(r => r.id)))
  const dealContactRows = contactIds.length > 0 ? await database
    .select({ contactId: schema.dealContacts.contactId, dealId: schema.dealContacts.dealId })
    .from(schema.dealContacts)
    .where(inArray(schema.dealContacts.contactId, contactIds)) : []
  const dealIdsByContact = new Map<string, string[]>()
  for (const r of dealContactRows) {
    const arr = dealIdsByContact.get(r.contactId) ?? []
    arr.push(r.dealId)
    dealIdsByContact.set(r.contactId, arr)
  }
  // Filter to active deals (not closed-lost / closed-won would be a
  // future refinement; for now any deal counts)
  const allDealIds = Array.from(new Set(dealContactRows.map(r => r.dealId)))
  const dealRows = allDealIds.length > 0 ? await database
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(inArray(schema.deals.id, allDealIds)) : []
  const activeDealIds = new Set(dealRows.map(d => d.id))

  // 4. Pre-fetch existing discovery_calls keyed by google_calendar_event_id
  const eventIds = usable.map(e => e.id)
  const existingCalls = eventIds.length > 0 ? await database
    .select()
    .from(schema.discoveryCalls)
    .where(inArray(schema.discoveryCalls.googleCalendarEventId, eventIds)) : []
  const callByEventId = new Map(existingCalls.map(c => [c.googleCalendarEventId, c]))

  // 5. Loop + upsert.
  let created = 0
  let updated = 0
  let skipped = 0
  let matched = 0
  const results: Array<{ eventId: string; action: string; reason?: string; parent?: string }> = []

  for (const ev of usable) {
    const summary = ev.summary?.trim() || 'Untitled meeting'
    const startIso = ev.start?.dateTime
    if (!startIso) { skipped++; results.push({ eventId: ev.id, action: 'skipped', reason: 'no start time' }); continue }
    const startMs = new Date(startIso).getTime()
    const endMs = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : startMs + 30 * 60_000
    const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000))

    const meetUrl = ev.hangoutLink
      ?? ev.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri
      ?? null

    // Match: deal > org > lead > skip
    let parentType: 'deal' | 'org' | 'lead' | null = null
    let parentId: string | null = null

    outer: for (const a of (ev.attendees ?? [])) {
      const email = a.email?.toLowerCase().trim()
      if (!email || email === myEmail) continue
      const contact = contactByEmail.get(email)
      if (contact) {
        // Prefer attaching to a deal this contact is on
        const dealCandidates = (dealIdsByContact.get(contact.contactId) ?? []).filter(d => activeDealIds.has(d))
        if (dealCandidates.length > 0) {
          parentType = 'deal'; parentId = dealCandidates[0]; break outer
        }
        if (contact.orgId) {
          parentType = 'org'; parentId = contact.orgId
          // keep looking in case a later attendee unlocks a deal match
          continue
        }
      }
      const lead = leadByEmail.get(email)
      if (lead && !parentType) {
        parentType = 'lead'; parentId = lead.id
        // keep looking in case a later attendee unlocks a deal/org
      }
    }

    if (!parentType || !parentId) {
      skipped++
      results.push({ eventId: ev.id, action: 'skipped', reason: 'no CRM match' })
      continue
    }
    matched++

    const attendeesJson = JSON.stringify((ev.attendees ?? []).map(a => ({
      name: a.displayName ?? null,
      email: a.email ?? null,
      role: a.organizer ? 'host' : 'guest',
    })))

    const existing = callByEventId.get(ev.id)
    const nowIso = new Date().toISOString()

    if (existing) {
      // Update title / scheduledAt / status if changed
      const changed =
        existing.title !== summary
        || existing.scheduledAt !== startIso
        || existing.durationMinutes !== durationMinutes
        || existing.googleMeetUrl !== meetUrl
      if (changed) {
        await database
          .update(schema.discoveryCalls)
          .set({
            title: summary,
            scheduledAt: startIso,
            durationMinutes,
            googleMeetUrl: meetUrl,
            attendees: attendeesJson,
            updatedAt: nowIso,
          })
          .where(eq(schema.discoveryCalls.id, existing.id))
        updated++
        results.push({ eventId: ev.id, action: 'updated', parent: `${parentType}:${parentId}` })
      } else {
        results.push({ eventId: ev.id, action: 'unchanged' })
      }
    } else {
      const callId = crypto.randomUUID()
      const insertVals: Record<string, unknown> = {
        id: callId,
        title: summary,
        scheduledAt: startIso,
        durationMinutes,
        googleMeetUrl: meetUrl,
        googleCalendarEventId: ev.id,
        attendees: attendeesJson,
        status: 'scheduled',
        createdById: userId,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      if (parentType === 'lead') insertVals.leadId = parentId
      if (parentType === 'deal') insertVals.dealId = parentId
      if (parentType === 'org') insertVals.orgId = parentId

      await database.insert(schema.discoveryCalls).values(insertVals as typeof schema.discoveryCalls.$inferInsert)

      // Activity stamp (lead / deal / org only — request/task skip)
      if (parentType === 'lead' || parentType === 'deal' || parentType === 'org') {
        const activityCol = parentType === 'lead' ? 'leadId'
          : parentType === 'deal' ? 'dealId'
          : 'orgId'
        await database.insert(schema.activities).values({
          id: crypto.randomUUID(),
          type: `${parentType}_call_scheduled`,
          title: `Call scheduled (Calendar sync): ${summary}`,
          description: `For ${startIso}`,
          [activityCol]: parentId,
          createdById: userId,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as typeof schema.activities.$inferInsert)
      }

      created++
      results.push({ eventId: ev.id, action: 'created', parent: `${parentType}:${parentId}` })
    }
  }

  // Stamp lastSyncedAt
  await database
    .update(schema.integrations)
    .set({ lastSyncedAt: new Date().toISOString() })
    .where(eq(schema.integrations.service, 'google_workspace'))

  return NextResponse.json({
    fetched: usable.length,
    matched,
    created,
    updated,
    skipped,
    results: results.slice(0, 20),  // keep response small
  })
}
