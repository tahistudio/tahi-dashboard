import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// -- GET /api/admin/team --
// Full roster for anyone who can see the Team feature.
//
// This endpoint doubles as the roster source for @mentions, message
// participants and the time-entry member picker, so a caller who cannot see
// the Team feature gets the LITE projection instead of a 403: exactly the
// column set that ungated /api/admin/team-members already returns, so this can
// grant nothing extra. Employment detail (capacity, contractor status, skills,
// department, reporting line) and the clerkUserId login link stay behind the
// feature gate.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const fullRosterDenied = await requireFeature(auth, 'team')
  if (fullRosterDenied) {
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

  const items = await drizzle
    .select()
    .from(schema.teamMembers)

  return NextResponse.json({ items })
}

// -- POST /api/admin/team --
// Creates a new team member.
// Body: { name, email, role?, skills?, avatarUrl? }
//
// Manager-gated. Creating a roster row is an access-granting act: the row is
// what a Clerk login later claims by verified email (lib/team-link.ts), so a
// scoped team member must not be able to mint one.
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'team')
  if (featureDenied) return featureDenied

  const body = await req.json() as {
    name?: string
    email?: string
    title?: string
    role?: string
    skills?: string[]
    avatarUrl?: string
    weeklyCapacityHours?: number
    isContractor?: boolean
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.email?.trim()) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await drizzle.insert(schema.teamMembers).values({
    id,
    name: body.name.trim(),
    email: body.email.trim(),
    title: body.title?.trim() ?? null,
    role: body.role ?? 'member',
    skills: body.skills ? JSON.stringify(body.skills) : '[]',
    avatarUrl: body.avatarUrl ?? null,
    weeklyCapacityHours: body.weeklyCapacityHours ?? 40,
    isContractor: body.isContractor ?? false,
    createdAt: now,
    updatedAt: now,
  })

  await logAudit(drizzle as unknown as DB, {
    action: 'team_member.created',
    userId: auth.userId,
    entityType: 'team_member',
    entityId: id,
    metadata: { name: body.name.trim(), email: body.email.trim(), role: body.role ?? 'member' },
  })

  return NextResponse.json({ id }, { status: 201 })
}
