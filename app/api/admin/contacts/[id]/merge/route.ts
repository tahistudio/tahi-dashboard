import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import {
  countContactReferences,
  getContactForAdmin,
  repointContactReferences,
} from '@/lib/contact-references'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Params = { params: Promise<{ id: string }> }

// ── POST /api/admin/contacts/[id]/merge ───────────────────────────────────
// Body: { into: contactId }
//
// Folds [id] (the duplicate) into `into` (the survivor). Both must be at the
// same organisation. Every reference is re-pointed (lib/contact-references),
// the survivor keeps its own fields and only fills what it is missing (phone,
// role, the ManyRequests id, the person link), is_primary survives if either
// had it, and the duplicate row is deleted last.
//
// The login is the truth, on merge as on delete: a duplicate that signs in
// hands its clerk_user_id to a survivor that has none, so nobody loses their
// portal; two rows that sign in as two different people are not duplicates
// and the merge is refused.
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'clients')
  if (featureDenied) return featureDenied

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { into?: unknown }
  const into = typeof body.into === 'string' && body.into.trim() ? body.into.trim() : null
  if (!into) {
    return NextResponse.json({ error: 'into (the contact to keep) is required' }, { status: 400 })
  }
  if (into === id) {
    return NextResponse.json({ error: 'A contact cannot be merged into itself' }, { status: 400 })
  }

  const drizzle = (await db()) as D1
  const [duplicate, survivor] = await Promise.all([
    getContactForAdmin(drizzle, id),
    getContactForAdmin(drizzle, into),
  ])
  if (!duplicate) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  if (!survivor) {
    return NextResponse.json({ error: 'The contact to keep was not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, duplicate.orgId)
  if (denied) return denied

  if (duplicate.orgId !== survivor.orgId) {
    return NextResponse.json({
      error: 'Contacts can only be merged within the same organisation',
      code: 'different_org',
    }, { status: 400 })
  }
  if (duplicate.clerkUserId && survivor.clerkUserId && duplicate.clerkUserId !== survivor.clerkUserId) {
    return NextResponse.json({
      error: `${duplicate.name} and ${survivor.name} both sign in to the portal as different people; they are not duplicates.`,
      code: 'both_linked',
    }, { status: 409 })
  }

  const references = await countContactReferences(drizzle, id)

  // What the survivor gains. Its own values always win; the duplicate only
  // fills a blank. The unique ManyRequests id has to leave the duplicate
  // before it can land on the survivor, hence the two-step below.
  const fills: Record<string, unknown> = {}
  if (!survivor.phone && duplicate.phone) fills.phone = duplicate.phone
  if (!survivor.role && duplicate.role) fills.role = duplicate.role
  if (!survivor.clerkUserId && duplicate.clerkUserId) {
    fills.clerkUserId = duplicate.clerkUserId
    // A login owns its mailbox: the survivor must describe the address the
    // person actually signs in with, which is the state PATCH refuses to
    // create any other way.
    if (duplicate.email && duplicate.email !== survivor.email) fills.email = duplicate.email
  }
  if (!survivor.lastLoginAt && duplicate.lastLoginAt) fills.lastLoginAt = duplicate.lastLoginAt
  if (!survivor.personId && duplicate.personId) fills.personId = duplicate.personId
  if (!survivor.manyrequestsId && duplicate.manyrequestsId) fills.manyrequestsId = duplicate.manyrequestsId
  if (!survivor.isPrimary && duplicate.isPrimary) fills.isPrimary = true

  if (references.total > 0) {
    await repointContactReferences(drizzle, id, into)
  }

  const now = new Date().toISOString()
  if (fills.manyrequestsId) {
    await drizzle
      .update(schema.contacts)
      .set({ manyrequestsId: null, updatedAt: now })
      .where(eq(schema.contacts.id, id))
  }
  if (Object.keys(fills).length > 0) {
    await drizzle
      .update(schema.contacts)
      .set({ ...fills, updatedAt: now })
      .where(eq(schema.contacts.id, into))
  }

  await drizzle.delete(schema.contacts).where(eq(schema.contacts.id, id))

  const moved = Object.fromEntries(references.counts.filter(c => c.count > 0).map(c => [c.key, c.count]))
  await logAudit(drizzle as unknown as DB, {
    action: 'contact.merged',
    userId,
    entityType: 'contact',
    entityId: into,
    metadata: {
      orgId: duplicate.orgId,
      from: { id: duplicate.id, name: duplicate.name, email: duplicate.email },
      into: { id: survivor.id, name: survivor.name, email: survivor.email },
      moved,
      filled: Object.keys(fills),
    },
  })

  return NextResponse.json({
    success: true,
    into,
    moved,
    total: references.total,
    filled: Object.keys(fills),
  })
}
