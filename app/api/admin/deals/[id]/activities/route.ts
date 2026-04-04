import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// -- GET /api/admin/deals/[id]/activities ----------------------------------
// List all activities scoped to this deal, ordered newest first.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: dealId } = await ctx.params
  const database = await db() as unknown as D1

  const items = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      dealId: schema.activities.dealId,
      orgId: schema.activities.orgId,
      contactId: schema.activities.contactId,
      createdById: schema.activities.createdById,
      scheduledAt: schema.activities.scheduledAt,
      completedAt: schema.activities.completedAt,
      durationMinutes: schema.activities.durationMinutes,
      outcome: schema.activities.outcome,
      createdAt: schema.activities.createdAt,
      updatedAt: schema.activities.updatedAt,
      createdByName: schema.teamMembers.name,
      contactName: schema.contacts.name,
    })
    .from(schema.activities)
    .leftJoin(schema.teamMembers, eq(schema.activities.createdById, schema.teamMembers.id))
    .leftJoin(schema.contacts, eq(schema.activities.contactId, schema.contacts.id))
    .where(eq(schema.activities.dealId, dealId))
    .orderBy(desc(schema.activities.createdAt))

  return NextResponse.json({ items })
}
