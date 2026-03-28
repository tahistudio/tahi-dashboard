import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// ── GET /api/admin/team-members ──────────────────────────────────────────────
// Returns all team members (lightweight, for dropdowns and selectors).
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const items = await drizzle
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      title: schema.teamMembers.title,
      role: schema.teamMembers.role,
      avatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.teamMembers)

  return NextResponse.json({ items })
}
