import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// -- GET /api/admin/deals/[id]/contacts ------------------------------------
// List all contacts linked to this deal via dealContacts junction table.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: dealId } = await ctx.params
  const database = await db() as unknown as D1

  const items = await database
    .select({
      id: schema.dealContacts.id,
      dealId: schema.dealContacts.dealId,
      contactId: schema.dealContacts.contactId,
      role: schema.dealContacts.role,
      contactName: schema.contacts.name,
      contactEmail: schema.contacts.email,
      contactRole: schema.contacts.role,
      contactOrgId: schema.contacts.orgId,
    })
    .from(schema.dealContacts)
    .leftJoin(schema.contacts, eq(schema.dealContacts.contactId, schema.contacts.id))
    .where(eq(schema.dealContacts.dealId, dealId))

  return NextResponse.json({ items })
}

// -- POST /api/admin/deals/[id]/contacts -----------------------------------
// Add a contact to this deal. Body: { contactId, role? }
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: dealId } = await ctx.params
  const body = await req.json() as { contactId?: string; role?: string }

  if (!body.contactId?.trim()) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()

  await database.insert(schema.dealContacts).values({
    id,
    dealId,
    contactId: body.contactId.trim(),
    role: body.role?.trim() || null,
  })

  return NextResponse.json({ id }, { status: 201 })
}

// -- DELETE /api/admin/deals/[id]/contacts ---------------------------------
// Remove a contact from this deal. Body: { contactId }
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: dealId } = await ctx.params
  const body = await req.json() as { contactId?: string }

  if (!body.contactId?.trim()) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  await database
    .delete(schema.dealContacts)
    .where(
      and(
        eq(schema.dealContacts.dealId, dealId),
        eq(schema.dealContacts.contactId, body.contactId.trim()),
      )
    )

  return NextResponse.json({ success: true })
}
