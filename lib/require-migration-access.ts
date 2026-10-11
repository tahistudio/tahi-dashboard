import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions } from '@/lib/permissions'
import { isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'
import { SERVICE_USER_ID } from '@/lib/team-identity'

/** Migration SQL and its catalogue require a current studio super admin or
 * the service identity minted by getRequestAuth for a verified API token. */
export async function requireMigrationAccess(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
): Promise<NextResponse | null> {
  if (!isTahiAdmin(auth.orgId) || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Keep the migration API contract independent of role tables. The Tahi
  // org check above still applies to this authenticated service identity.
  if (auth.userId === SERVICE_USER_ID) return null

  try {
    const database = await db()
    const access = await resolvePermissions(database as ReturnType<typeof import('drizzle-orm/d1').drizzle>, auth)
    if (access.isSuperAdmin) return null
  } catch {
    // A failed lookup grants neither the catalogue nor migration execution.
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
