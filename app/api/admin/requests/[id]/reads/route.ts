/**
 * POST /api/admin/requests/[id]/reads
 *
 * Marks the request as read by the current user (now). Upserts into
 * request_reads (one row per user per request). Called by the request
 * detail page ~2 seconds after load so a quick glance doesn't count.
 *
 * No body required.
 *
 * GET /api/admin/requests/[id]/reads
 *
 * The receipts on this request, names resolved. The client half is written by
 * the portal sibling (app/api/portal/requests/[id]/reads/route.ts), which is
 * what lets the thread tell the studio "Seen by Sam 2 hours ago" instead of
 * leaving them guessing whether a delivery was ever opened.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  const now = new Date().toISOString()

  const [existing] = await drizzle
    .select({ id: schema.requestReads.id })
    .from(schema.requestReads)
    .where(and(
      eq(schema.requestReads.requestId, id),
      eq(schema.requestReads.userId, userId),
      eq(schema.requestReads.userType, 'team_member'),
    ))
    .limit(1)

  if (existing) {
    await drizzle
      .update(schema.requestReads)
      .set({ lastReadAt: now })
      .where(eq(schema.requestReads.id, existing.id))
  } else {
    await drizzle.insert(schema.requestReads).values({
      id: crypto.randomUUID(),
      requestId: id,
      userId,
      userType: 'team_member',
      lastReadAt: now,
    })
  }

  return NextResponse.json({ ok: true, lastReadAt: now })
}

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  const rows = await drizzle
    .select({
      userId: schema.requestReads.userId,
      userType: schema.requestReads.userType,
      lastReadAt: schema.requestReads.lastReadAt,
    })
    .from(schema.requestReads)
    .where(eq(schema.requestReads.requestId, id))

  // request_reads.user_id is a Clerk user id on both sides, so names come from
  // whichever table owns that login. Two lookups, not one per row.
  const clerkIds = [...new Set(rows.map(r => r.userId).filter(Boolean))]
  const contactRows = clerkIds.length > 0 ? await drizzle
    .select({ clerkUserId: schema.contacts.clerkUserId, name: schema.contacts.name })
    .from(schema.contacts)
    .where(inArray(schema.contacts.clerkUserId, clerkIds)) : []
  const memberRows = clerkIds.length > 0 ? await drizzle
    .select({ clerkUserId: schema.teamMembers.clerkUserId, name: schema.teamMembers.name })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.clerkUserId, clerkIds)) : []

  const contactNames = new Map(contactRows.map(c => [c.clerkUserId ?? '', c.name]))
  const memberNames = new Map(memberRows.map(m => [m.clerkUserId ?? '', m.name]))

  const items = rows.map(r => ({
    userId: r.userId,
    userType: r.userType,
    lastReadAt: r.lastReadAt,
    name: (r.userType === 'contact' ? contactNames.get(r.userId) : memberNames.get(r.userId)) ?? null,
  }))

  return NextResponse.json({ items })
}
