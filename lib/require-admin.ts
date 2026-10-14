import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'

/** Full-workspace operations cannot be delegated through a feature grant alone. */
export async function requireAdmin(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
): Promise<NextResponse | null> {
  if (auth.userId === 'api-service') return null
  const database = await db()
  const access = await resolvePermissions(database, auth)
  if (access.isAdmin) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
