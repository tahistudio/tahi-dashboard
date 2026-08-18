import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [entry] = await drizzle
    .select({ orgId: schema.timeEntries.orgId })
    .from(schema.timeEntries)
    .where(eq(schema.timeEntries.id, id))
    .limit(1)
  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, entry.orgId)
  if (denied) return denied

  await drizzle.delete(schema.timeEntries).where(eq(schema.timeEntries.id, id))

  return NextResponse.json({ success: true })
}
