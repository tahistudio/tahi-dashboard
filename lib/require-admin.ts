import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'

/** Full-workspace operations cannot be delegated through a feature grant alone. */
export async function requireAdmin(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  preparedAccess?: ResolvedAccess,
): Promise<NextResponse | null> {
  if (auth.userId === 'api-service') return null
  const access = preparedAccess ?? await resolvePermissions(await db(), auth)
  if (access.isAdmin) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
