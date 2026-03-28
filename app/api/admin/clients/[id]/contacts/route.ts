import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// -- GET /api/admin/clients/[id]/contacts ------------------------------------
// Returns all contacts for the given org.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const contacts = await drizzle
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, id))

  return NextResponse.json({ contacts })
}

// -- POST /api/admin/clients/[id]/contacts -----------------------------------
// Creates a new contact for the given org.
// Body: { name, email, role?, phone? }
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json() as {
    name?: string
    email?: string
    role?: string
    isPrimary?: boolean
  }

  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.email || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  // Verify org exists
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [org] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  const contactId = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.insert(schema.contacts).values({
    id: contactId,
    orgId: id,
    name: body.name.trim(),
    email: body.email.trim(),
    role: body.role?.trim() || null,
    isPrimary: body.isPrimary ?? false,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id: contactId })
}
