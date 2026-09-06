/**
 * GET    /api/admin/email-suppressions   the last 100 withheld recipients
 * DELETE /api/admin/email-suppressions   empty the log (super admin)
 *
 * The readable half of the email delivery allowlist. lib/email-delivery.ts is
 * the one door out of this platform; every recipient it refuses to mail lands
 * in `email_suppressions`, and this is how the Studio details settings card
 * and the MCP tool read them back.
 *
 * GET is admin-and-settings-gated like the rest of the settings surface. The
 * rows carry addresses and subject lines, which is exactly the kind of thing a
 * scoped teammate has no business browsing, but nothing here is a secret the
 * way an integration token is.
 *
 * DELETE is SUPER ADMIN ONLY, resolved through lib/permissions the same way
 * /api/admin/danger/export does. Clearing the log destroys the only evidence
 * that a send was withheld, so it is the one destructive action on this
 * surface and it is gated like one. The MCP service token resolves to `admin`
 * rather than `super_admin` and so cannot fire it, which is deliberate: an
 * assistant may read the log and may not erase it.
 */

import { NextRequest, NextResponse } from 'next/server'

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import { clearEmailSuppressions, listEmailSuppressions } from '@/lib/email-delivery'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How many rows the log card shows. One screenful of recent history. */
const LIMIT = 100

export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  // A database that has not had migration 0094 applied yet answers "no such
  // table". That is a settings card showing an empty log, not a 500 on a page
  // whose other half (the mode and the domains) is the thing worth reading.
  try {
    const items = await listEmailSuppressions(LIMIT)
    return NextResponse.json({ items, limit: LIMIT })
  } catch {
    return NextResponse.json({ items: [], limit: LIMIT, unavailable: true })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  const drizzle = (await db()) as unknown as D1
  const access = await resolvePermissions(drizzle, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await clearEmailSuppressions()
  } catch {
    return NextResponse.json({ error: 'Could not clear the suppression log.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
