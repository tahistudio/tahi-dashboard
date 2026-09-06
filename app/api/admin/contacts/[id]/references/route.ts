import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import {
  countContactReferences,
  getContactForAdmin,
  isOnlyPrimary,
  listSiblingContacts,
} from '@/lib/contact-references'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/contacts/[id]/references ───────────────────────────────
// What deleting or merging this contact would move: every referencing column
// counted and named, the two blockers DELETE enforces (a portal login, the
// only primary), and the other contacts at the organisation a reassign or a
// merge could name. One read so the People tab can say exactly what a
// destructive action will do before it is confirmed.
export async function GET(req: NextRequest, { params }: Params) {
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

  const drizzle = (await db()) as D1
  const contact = await getContactForAdmin(drizzle, id)
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, contact.orgId)
  if (denied) return denied

  const [siblings, references] = await Promise.all([
    listSiblingContacts(drizzle, contact),
    countContactReferences(drizzle, id),
  ])

  return NextResponse.json({
    contact: {
      id: contact.id,
      orgId: contact.orgId,
      name: contact.name,
      email: contact.email,
      isPrimary: Boolean(contact.isPrimary),
      clerkLinked: Boolean(contact.clerkUserId),
    },
    references: references.counts,
    total: references.total,
    summary: references.summary,
    blockers: {
      clerkLinked: Boolean(contact.clerkUserId),
      onlyPrimary: isOnlyPrimary(contact, siblings),
    },
    candidates: siblings.map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      isPrimary: Boolean(s.isPrimary),
      clerkLinked: Boolean(s.clerkUserId),
    })),
  })
}
