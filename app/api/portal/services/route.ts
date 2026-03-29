import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET /api/portal/services - list services visible in catalog
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()
  const items = await database
    .select()
    .from(schema.services)
    .where(eq(schema.services.showInCatalog, 1))
    .orderBy(desc(schema.services.createdAt))

  return NextResponse.json({ items })
}
