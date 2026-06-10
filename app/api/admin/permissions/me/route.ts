import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions, featureMap } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/permissions/me
// The caller's resolved access level + feature map. Any authenticated user.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const drizzle = (await db()) as unknown as D1
  const access = await resolvePermissions(drizzle, auth)
  return NextResponse.json({
    level: access.level,
    isAdmin: access.isAdmin,
    isSuperAdmin: access.isSuperAdmin,
    canManagePermissions: access.canManagePermissions,
    features: featureMap(access),
  })
}
