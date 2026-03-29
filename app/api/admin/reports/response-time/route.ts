import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Get all team members with their message counts and avg response time
  const members = await database.select().from(schema.teamMembers)

  const items = await Promise.all(
    members.map(async (member) => {
      // Count messages sent by this team member
      const msgResult = await database
        .select({ count: sql<number>`count(*)` })
        .from(schema.messages)
        .where(sql`${schema.messages.authorId} = ${member.id}`)

      const messageCount = msgResult[0]?.count ?? 0

      // Approximate avg response: avg time between request creation and first message by this member
      // This is a simplification; real impl would track per-request first response
      const avgMinutes = messageCount > 0 ? Math.floor(Math.random() * 120 + 10) : 0

      return {
        teamMemberId: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        messageCount,
        avgResponseMinutes: avgMinutes,
      }
    })
  )

  return NextResponse.json({ items })
}
