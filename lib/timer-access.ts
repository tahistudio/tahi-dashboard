import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { INTERNAL_ORG_ID } from '@/lib/internal-org'
import { requireAccessToOrg } from '@/lib/require-access'
import { guardTask } from '@/lib/task-access'
import { resolvePermissions } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Ownership does not preserve client access after a seat's scope is narrowed. */
export async function requireTimerAccess(
  database: D1,
  auth: { userId: string | null; orgId: string | null },
  target: { requestId?: string | null; taskId?: string | null; orgId?: string | null },
): Promise<NextResponse | null> {
  const { userId } = auth
  if (userId === 'api-service') return null
  if ((await resolvePermissions(database, auth)).isAdmin) return null
  if (target.requestId) {
    const [request] = await database.select({ orgId: schema.requests.orgId }).from(schema.requests)
      .where(eq(schema.requests.id, target.requestId)).limit(1)
    if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    const denied = await requireAccessToOrg(database, userId, request.orgId)
    if (denied) return denied
  }
  if (target.taskId) {
    const denied = await guardTask(database, userId, target.taskId)
    if (denied) return denied
  }
  if (target.orgId && target.orgId !== INTERNAL_ORG_ID) {
    return requireAccessToOrg(database, userId, target.orgId)
  }
  return null
}
