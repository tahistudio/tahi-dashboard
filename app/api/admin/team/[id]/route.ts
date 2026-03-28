import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Delete access rules first, then the team member
  const accessRules = await drizzle
    .select({ id: schema.teamMemberAccess.id })
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  for (const rule of accessRules) {
    await drizzle.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))
  }
  await drizzle.delete(schema.teamMemberAccess).where(eq(schema.teamMemberAccess.teamMemberId, id))
  await drizzle.delete(schema.teamMembers).where(eq(schema.teamMembers.id, id))

  return NextResponse.json({ success: true })
}
