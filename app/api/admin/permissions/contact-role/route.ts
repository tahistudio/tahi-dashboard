import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const PORTAL_ROLES = new Set(['admin', 'member'])

// POST /api/admin/permissions/contact-role  { contactId, portalRole }
// Set a client contact's portal role: 'admin' (administers the org's portal -
// contacts, billing visibility) or 'member' (their own scoped view). This is
// an access change, so it lives on the permissions surface, is admin+ only,
// gated on the permissions feature, and audit-logged into the change history.
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'settings.permissions')
  if (featureDenied) return featureDenied

  const body = (await req.json()) as { contactId?: string; portalRole?: string }
  const { contactId, portalRole } = body
  if (!contactId || !portalRole || !PORTAL_ROLES.has(portalRole)) {
    return NextResponse.json({ error: 'contactId and portalRole (admin | member) required' }, { status: 400 })
  }

  const [contact] = await drizzle
    .select({ id: schema.contacts.id, name: schema.contacts.name, portalRole: schema.contacts.portalRole })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .limit(1)
  if (!contact) {
    return NextResponse.json({ error: 'Unknown contact' }, { status: 404 })
  }

  const now = new Date().toISOString()
  await drizzle
    .update(schema.contacts)
    .set({ portalRole, updatedAt: now })
    .where(eq(schema.contacts.id, contactId))

  await logAudit(drizzle as unknown as DB, {
    action: 'permission.portal_role_changed',
    userId: auth.userId,
    entityType: 'contact',
    entityId: contactId,
    metadata: {
      before: { portalRole: contact.portalRole },
      after: { portalRole },
    },
  })

  return NextResponse.json({ ok: true, portalRole })
}
