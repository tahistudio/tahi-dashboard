import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// -- GET /api/admin/team --
// Returns all team members with full details.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const items = await database
    .select()
    .from(schema.teamMembers)

  return NextResponse.json({ items })
}

// -- POST /api/admin/team --
// Creates a new team member.
// Body: { name, email, role?, skills?, avatarUrl? }
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    email?: string
    role?: string
    skills?: string[]
    avatarUrl?: string
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.email?.trim()) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const database = await db()

  await database.insert(schema.teamMembers).values({
    id,
    name: body.name.trim(),
    email: body.email.trim(),
    role: body.role ?? 'member',
    skills: body.skills ? JSON.stringify(body.skills) : '[]',
    avatarUrl: body.avatarUrl ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
